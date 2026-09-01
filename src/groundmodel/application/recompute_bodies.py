"""Recompute geometric body identity for one model — stage-3 persistence.

Owner ruling 2026-08-12: *"The ties stay ground truth for fill bands … But
every same litho that is connected should get the same body id. how else are
we going to extract qc or sample data by body."* The per-section merge
(frontend ``mergeTouchingBodies``) and the cross-section merge
(``plan_body_aliases``) existed as unpersisted alias maps; this use case
persists their union as ``body_geometry_fact`` rows and re-runs the resolver,
so the database's ``litho_layer.body_id`` finally agrees with the screen.

The flow, one transaction:

1. Refuse an empty payload — the replace is wholesale, and an empty payload is
   a frontend that fired before its data loaded, not a statement.
2. Take the per-model body-partition advisory lock: two concurrent writers
   would interleave their full-replaces and the stale one could land last.
   The lock is shared with every other body-partition writer, not private to
   recompute — see ``body_partition_lock``.
3. All evidence in LAYER-id space: the frontend's per-section connectivity
   groups plus ``plan_layer_groups`` over the payload sections (the stage-2
   geometric tests — shared columns and fence crossings — keyed on region
   identity). Layer ids never change, so the recompute is idempotent by
   construction. The first design used BODY ids and oscillated in production:
   a merge erased its own evidence on the next payload (facts 74 → 3 → 69,
   dogfeed 2026-08-12 evening).
4. Facts referencing layers the model no longer holds are dropped and counted
   (a stale snapshot degrades to slightly-old facts, never to a 500).
5. Full replace of the model's facts, then ``ResolveLithoInstances`` stamps
   ``body_id``.
6. The diff is computed from the LAYER-stamp pre/post-image, not from body-row
   churn — ordinal renumbering recycles rows for components whose membership
   never changed, and that is noise, not a merge.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.body_fact_translation import plan_geometry_facts
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (
    plan_layer_groups,
)
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.exceptions import (
    EmptyRecomputePayloadError,
    IncompleteRecomputeCoverageError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class RecomputeBodiesResult:
    """What one recompute did, for the diff toast.

    Attributes
    ----------
    facts_written : int
        Fact rows persisted (after the stale filter).
    facts_dropped_stale : int
        Planned facts dropped because an endpoint layer is no longer an
        accepted row of this model — the payload snapshot was older than the
        database. Self-heals at the next recompute.
    bodies_merged : int
        How many previously-distinct bodies fused into survivors, counted
        from the layer stamps (per surviving body: distinct prior bodies
        among its members, minus one).
    bodies_split : int
        The mirror: per prior body, distinct surviving bodies among its
        members, minus one.
    renamed : tuple[str, ...]
        Names displaced by a merge (oldest name wins). Filled by the
        lineage-adoption step; empty until then.
    """

    facts_written: int
    facts_dropped_stale: int
    bodies_merged: int
    bodies_split: int
    renamed: tuple[str, ...] = ()


class RecomputeBodies(GroundModelLogger):
    """Persist the geometric body merge for one litho or geotech model.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session. This use case commits once, at the
        end.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        model_id: UUID,
        sections: list[SectionPartitionInput],
        section_layer_groups: list[list[list[str]]],
        section_ids: list[UUID] | None = None,
    ) -> RecomputeBodiesResult:
        """Replace the model's geometry facts and re-stamp body ids.

        Parameters
        ----------
        model_id : UUID
            The litho or geotech model being recomputed. The router has
            already verified project scope and model kind.
        sections : list[SectionPartitionInput]
            Every section's partition, as the frontend renders it (fallback
            regions already omitted — the owner's rule: fallback paint never
            defines identity).
        section_layer_groups : list[list[list[str]]]
            Per section (parallel to ``sections``), the frontend's fill
            connectivity groups of LAYER ids — label-independent evidence
            (body-labelled evidence oscillated: a merge erased its own
            grounds on the next payload).

        Returns
        -------
        RecomputeBodiesResult
            The diff for the toast.

        Raises
        ------
        EmptyRecomputePayloadError
            When the payload carries no sections or no regions at all.
        """
        self.info(
            f"RecomputeBodies: model={model_id} sections={len(sections)} "
            f"layer_groups={sum(len(g) for g in section_layer_groups)}"
        )
        if not sections or all(len(s.regions) == 0 for s in sections):
            raise EmptyRecomputePayloadError(
                "Recompute rejected: the payload carries no partition content. "
                "A wholesale fact replace from an empty payload would split "
                "every geometrically-merged body in the model."
            )

        # Concurrent writes to one model's body partition would interleave
        # their full-replaces; the advisory lock queues them and releases at
        # COMMIT. The key is the model-wide one every body-partition writer
        # takes, NOT a recompute-private one: a recompute-only key left this
        # wholesale replace racing a concurrent correlate, which is how a
        # correlate click 500'd mid-recompute (owner dogfeed 2026-08-15).
        # Taken here rather than at the resolver call so the fact replace is
        # inside the same serialised unit as the resolve that reads it.
        # Coverage gate (audit P1-3): the replace below is MODEL-WIDE, so the
        # payload must speak for every section of the project. A partially
        # loaded client used to silently erase the omitted sections'
        # connectivity evidence; now it is refused before anything is touched.
        project_id = (
            await self._session.execute(
                select(GeologicalModelOrm.app_project_id).where(GeologicalModelOrm.id == model_id)
            )
        ).scalar_one()
        project_section_ids = set(
            (
                await self._session.execute(
                    select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
                )
            ).scalars()
        )
        submitted = set(section_ids or [])
        if submitted != project_section_ids:
            missing = sorted(str(i) for i in project_section_ids - submitted)
            unknown = sorted(str(i) for i in submitted - project_section_ids)
            raise IncompleteRecomputeCoverageError(
                "Recompute refused: the payload must cover every section of the "
                f"project exactly (missing: {missing or 'none'}; "
                f"unknown: {unknown or 'none'}). A partial replace would erase "
                "the omitted sections' body-connectivity evidence."
            )

        await lock_body_partition(self._session, model_id=model_id, operation="bodies/recompute")

        # Granular body identity (owner 2026-09-01: "start totally granular —
        # small disconnected bodies of litho and packing; the user lumps them
        # into groups"). This REVERSES the debt-#278 class-collapse for the
        # IDENTITY path: ``plan_layer_groups`` keys on the raw formation ROW, so
        # two masses of the same soil+NAD-class under DIFFERENT formation rows
        # are NOT fused on contact — each geometrically-connected mass is its
        # own body, and the user joins them by hand. Connectivity is unchanged
        # (shared column + elevation overlap, or a real fence crossing); only
        # the identity a connection is allowed to bridge is now the row, not the
        # class. NOTE the 3-D voxel PAINT path (``plan_body_aliases`` in
        # ``build_voxel_litho_model``) deliberately KEEPS the class collapse to
        # avoid the invented-lithology pinch — a decided divergence, not a miss.
        planned = plan_geometry_facts(
            section_layer_groups=section_layer_groups,
            cross_section_layer_groups=plan_layer_groups(sections),
        )

        # Pre-image: the layer→body partition BEFORE the resolve, and the set
        # of live layer ids the stale filter checks against.
        pre_rows = (
            await self._session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
        pre_body_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in pre_rows}
        live_layer_ids = {str(lid) for lid in pre_body_by_layer}

        kept: list[tuple[str, str]] = []
        dropped = 0
        for a, b in planned.facts:
            if a in live_layer_ids and b in live_layer_ids:
                kept.append((a, b))
            else:
                dropped += 1
        if dropped:
            self.warning(
                f"RecomputeBodies: dropped {dropped} fact(s) whose layer left the model "
                "since the payload snapshot — stale, self-heals next recompute"
            )

        await self._session.execute(
            delete(BodyGeometryFactOrm).where(BodyGeometryFactOrm.model_id == model_id)
        )
        for a, b in kept:
            # ``plan_geometry_facts`` already canonicalises by string order,
            # which for hex UUIDs equals PostgreSQL's byte order — the CHECK
            # constraint agrees.
            self._session.add(
                BodyGeometryFactOrm(
                    id=uuid7(),
                    model_id=model_id,
                    layer_a_id=UUID(a),
                    layer_b_id=UUID(b),
                )
            )
        await self._session.flush()

        resolve_result = await ResolveLithoInstances(self._session).execute(
            model_id=model_id, commit=False
        )

        post_rows = (
            await self._session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
        post_body_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in post_rows}
        merged, split = _partition_diff(pre_body_by_layer, post_body_by_layer)

        await self._session.commit()
        self.success(
            f"RecomputeBodies: model={model_id} facts={len(kept)} (+{dropped} stale) "
            f"merged={merged} split={split}"
        )
        return RecomputeBodiesResult(
            facts_written=len(kept),
            facts_dropped_stale=dropped,
            bodies_merged=merged,
            bodies_split=split,
            renamed=resolve_result.renamed,
        )


def _partition_diff(
    pre: dict[UUID, UUID | None],
    post: dict[UUID, UUID | None],
) -> tuple[int, int]:
    """Count merges and splits between two layer→body partitions.

    A merge is a surviving body whose members carried N>1 distinct prior
    bodies (counts N-1); a split is the mirror. Layers present on only one
    side (accepted/rejected flips inside the same transaction) are ignored —
    they belong to neither partition comparison.

    Parameters
    ----------
    pre, post : dict[UUID, UUID | None]
        Layer id → body id before and after the resolve.

    Returns
    -------
    tuple[int, int]
        ``(bodies_merged, bodies_split)``.
    """
    shared = [lid for lid in pre if lid in post]
    members_by_post: dict[UUID | None, set[UUID | None]] = {}
    members_by_pre: dict[UUID | None, set[UUID | None]] = {}
    for lid in shared:
        if pre[lid] is not None and post[lid] is not None:
            members_by_post.setdefault(post[lid], set()).add(pre[lid])
            members_by_pre.setdefault(pre[lid], set()).add(post[lid])
    merged = sum(len(pre_bodies) - 1 for pre_bodies in members_by_post.values())
    split = sum(len(post_bodies) - 1 for post_bodies in members_by_pre.values())
    return merged, split
