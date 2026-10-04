"""Merge-enclosed-lens-bodies use case — the Fill-bands sand-merge.

A lithology split on one column only by a LOCAL lens should read as ONE body
(owner directive 2026-06-05: "the big sand is one body"). This use case plans the
merge edges with :func:`plan_enclosed_lens_merges`, creates them as user-approved
``manual`` correlation edges, and re-resolves so the split halves join into one
body. Two cases:

* **Different-lithology lens** (e.g. clay between two sands): the planner fires
  only when the lens lithology is absent on a section-adjacent neighbour (a true
  pinch); the bracketing host halves join the neighbour's continuous host into
  one body, and the lens keeps its own body (rendered as a wedge cut out of the
  merged matrix).
* **Same-lithology lens** (owner ruling 2026-07-13): a lens of the SAME
  lithology as its enclosing matrix merges INTO that matrix body — the enclosed
  unit and its bracketing hosts become one body_id.

Idempotent: existing edges are skipped (``ON CONFLICT DO NOTHING`` on the
canonical triple). Section-scoped via ``project_investigations_onto_section`` —
only the columns the user sees on the active section participate.

Flush / commit boundary: this use case OWNS its commit. It creates edges, runs
the resolver (``commit=False``), then commits once so the edge writes + body
re-stamps land atomically.

⚠ Since owner 2026-10-04 (*"identity follows the drawing"*) the ties this use
case writes NO LONGER join bodies by themselves: only the geometry facts the
renderer posts at ``bodies/recompute`` union. The step-7 re-resolve keeps the
body stamps coherent; the host halves join only once the fill paints them as
one mass and the next recompute posts that fact. And since 2026-10-03 (never
weld) two litho units never share a body, so a lens on its own formation row
stays its own body whatever the ties say.

⚠ NOTHING CALLS THIS TODAY — see ``docs/debt.md`` #243.
------------------------------------------------------------
``POST .../bodies/merge-enclosed-lenses`` is reachable, and the planner is
correct (verified 2026-07-27 against the real S4/B4 pair: it returns both host
halves → the neighbour's continuous sand). But no client invokes the endpoint —
not the desktop app, not the integration suite, not e2e — so the merge has never
run on any model and every enclosed-lens host is still split into two bodies.

This docstring previously said the use case "is the top of the Fill-bands
request". That request does not exist: "Fill bands" is a client-side view toggle
(``bandFillStore.toggleBandFill``) that flips whether ``PartitionFillOverlay``
renders and makes no network call at all. The wording is corrected here because
it is what made two separate investigations assume the merge had already run.

When wiring a trigger, the ORDER matters and is not negotiable: the merge
re-stamps ``body_id`` in the DB, while the voxel build takes body identity from
the FRONTEND payload (see ``build_voxel_litho_model`` — "the frontend is the
single source of body identity here"). So a caller must merge, then RELOAD the
litho layers, then recompute the partition, then build. Calling this from inside
the build endpoint would leave the payload's split body ids disagreeing with the
re-stamped picks, and the mesher would emit a merged island inside two unmerged
hosts — strictly worse than not merging at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.domain.services.plan_enclosed_lens_merges import (
    MergeLayer,
    plan_enclosed_lens_merges,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

#: Merge edges are a committed, user-triggered interpretation (Fill bands), so
#: they are ``manual`` + ``user_approved`` — the resolver groups them and an
#: ``auto`` cleanup never sweeps them.
_MERGE_SOURCE = "manual"


@dataclass
class MergeEnclosedLensResult:
    """Outcome of the merge pass.

    Attributes
    ----------
    edges_created : int
        Net-new correlation edges inserted (host half ↔ neighbour host).
    edges_skipped_existing : int
        Planned edges that already existed (idempotent re-run).
    """

    edges_created: int
    edges_skipped_existing: int


class MergeEnclosedLensBodies(GroundModelLogger):
    """Merge same-lithology host halves split by a local lens into one body."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        section_id: UUID,
    ) -> MergeEnclosedLensResult:
        """Plan + create merge edges for the active section, then re-resolve.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model.
        section_id : UUID
            The active cross-section — defines column adjacency (the merge is
            section-scoped: only columns the user sees participate).

        Returns
        -------
        MergeEnclosedLensResult
            Counts of created + skipped edges.

        Raises
        ------
        ValueError
            When the model does not exist in ``project_id``.
        """
        self.info(
            f"MergeEnclosedLensBodies.execute: model={model_id} section={section_id} "
            f"project={project_id}"
        )
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )
        # TAKE THE PARTITION LOCK BEFORE THE FIRST WRITE, not after it. The
        # resolver at step 7 takes this same lock, but by then this transaction
        # has already INSERTed the merge edges — writes that raced the debounced
        # background ``bodies/recompute``, which re-stamps ``litho_layer.body_id``
        # across the same model in a different lock order (owner dogfeed
        # 2026-08-23: that overlap 500'd with DeadlockDetectedError). Taken after
        # the scope guard, so a rejected request never locks on the model's
        # behalf; re-entrant per session, so the resolver's later take is free.
        await lock_body_partition(
            self._session, model_id=model_id, operation="merge-enclosed-lens-bodies"
        )

        # 1. Accepted layers + their lithology.
        layer_rows = (
            await self._session.execute(
                select(
                    LithoLayerOrm.id,
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.borehole_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.litho_main_soil_code,
                )
                .join(
                    GeologicalFormationOrm,
                    GeologicalFormationOrm.id == LithoLayerOrm.formation_id,
                )
                .where(
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()

        # 2. Surface elevations (cross-column depth is compared in mTAW).
        surf: dict[UUID, float | None] = {}
        for r in (
            await self._session.execute(
                select(CptOrm.id, CptOrm.elevation_m).where(CptOrm.app_project_id == project_id)
            )
        ).all():
            surf[r.id] = r.elevation_m
        for r in (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.elevation_m).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all():
            surf[r.id] = r.elevation_m

        # 3. Section along-order — the column adjacency the user sees.
        along = await project_investigations_onto_section(
            self._session, project_id=project_id, section_id=section_id
        )

        # 4. Build per-column elevation stacks.
        stacks: dict[UUID, list[MergeLayer]] = {}
        for r in layer_rows:
            inv = r.cpt_id if r.cpt_id is not None else r.borehole_id
            if inv is None:
                continue
            s = surf.get(inv)
            if s is None:
                continue
            stacks.setdefault(inv, []).append(
                MergeLayer(
                    layer_id=r.id,
                    inv_id=inv,
                    top_elev=s - r.depth_top_m,
                    base_elev=s - r.depth_base_m,
                    soil=r.litho_main_soil_code or "",
                )
            )
        for entries in stacks.values():
            entries.sort(key=lambda u: -u.top_elev)

        # 5. Plan the merge edges.
        plan = plan_enclosed_lens_merges(stacks, along)
        if not plan:
            await self._session.commit()
            self.success("MergeEnclosedLensBodies: no enclosed-lens merges to apply")
            return MergeEnclosedLensResult(edges_created=0, edges_skipped_existing=0)

        # 6. Insert as user-approved manual edges (canonical a < b; idempotent).
        values = []
        for e in plan:
            a, b = sorted((e.host_layer_id, e.neighbour_layer_id))
            values.append(
                {
                    "id": uuid7(),
                    "model_id": model_id,
                    # section_id is NOT NULL — a merge is always triggered on a
                    # specific section (Fill bands is a section verb).  Omitting
                    # this caused IntegrityError whenever a merge edge was created.
                    "section_id": section_id,
                    "layer_a_id": a,
                    "layer_b_id": b,
                    "source": _MERGE_SOURCE,
                    "user_approved": True,
                }
            )
        stmt = (
            insert(LithoContactCorrelationEdgeOrm)
            .values(values)
            .on_conflict_do_nothing(constraint="uq_litho_contact_corr_triple")
        )
        result = await self._session.execute(stmt)
        edges_created = result.rowcount or 0
        edges_skipped = len(values) - edges_created

        # 7. Re-resolve to keep the stamps coherent. The new ties do not union on
        #    their own (identity follows the drawing, 2026-10-04): the host halves
        #    join once the fill paints them as one mass and the recompute posts it.
        await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=False)

        await self._session.commit()
        self.success(
            f"MergeEnclosedLensBodies: created={edges_created} "
            f"skipped_existing={edges_skipped} (re-resolved)"
        )
        return MergeEnclosedLensResult(
            edges_created=edges_created,
            edges_skipped_existing=edges_skipped,
        )
