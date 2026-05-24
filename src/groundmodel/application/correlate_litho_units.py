"""Correlate-litho-units use case — Phase-2 Slice 1.

Records that two lithostratigraphic formation rows belong to the same
stratigraphic body (instance) within a model, then re-runs the ordinal
resolver across all formations in the model and writes the result back.

This use case is MODEL-level only.  It does NOT touch cross-section
rows, seeded_formation_contact_ids, or any section-level state.  This
structural boundary is the reason the #57/applyUpdatedSection trap
cannot recur here: there is no section entity in scope at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_formation_absences_for_formation import (
    RecomputeFormationAbsencesForFormation,
)
from groundmodel.domain.services.resolve_litho_instances import (
    CorrelationEdge,
    FormationNode,
    resolve_litho_instances,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_correlation_edge_orm import (
    LithoCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class CorrelateResult:
    """Output of ``CorrelateLithoUnits.execute``.

    Attributes
    ----------
    edge : LithoCorrelationEdgeOrm
        The canonical edge row (freshly inserted or pre-existing).
    was_created : bool
        ``True`` when a new row was inserted; ``False`` when the edge
        already existed (idempotent re-call).
    instance_ordinals_updated : list[dict]
        One entry per formation whose ``instance_ordinal`` was changed
        by the resolver.  Each entry is
        ``{"formation_id": str, "new_ordinal": int}``.
    """

    edge: LithoCorrelationEdgeOrm
    was_created: bool
    instance_ordinals_updated: list[dict]


class CorrelateLithoUnits(GroundModelLogger):
    """Create (or confirm) a correlation edge and re-run ordinal resolution."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = GeologyRepository(session)

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        formation_a_id: UUID,
        formation_b_id: UUID,
        source: str = "manual",
    ) -> CorrelateResult:
        """Insert an edge between two formations and resolve instance ordinals.

        Parameters
        ----------
        project_id : UUID
            The owning project.  Used to scope the validation query.
        model_id : UUID
            The lithostratigraphic model the edge belongs to.
        formation_a_id : UUID
            One endpoint of the undirected edge.
        formation_b_id : UUID
            The other endpoint.  May be supplied in either order — the
            use case normalises to canonical ordering (min, max) before
            insert, matching the DB CHECK constraint.
        source : str
            Provenance token.  Defaults to 'manual'.

        Returns
        -------
        CorrelateResult
            Contains the edge row, a ``was_created`` flag, and the list
            of formation ordinals updated by the resolver.

        Raises
        ------
        ValueError
            When either formation does not belong to ``model_id`` /
            ``project_id``, when the two formations share the same id,
            or when the formations are in different naming groups
            (different parent_formation_id or litho_main_soil_code).
        """
        self.info(f"CorrelateLithoUnits: model={model_id} a={formation_a_id} b={formation_b_id}")

        # ------------------------------------------------------------------ #
        # 1. Self-loop guard.                                                  #
        # ------------------------------------------------------------------ #
        if formation_a_id == formation_b_id:
            raise ValueError(f"Cannot correlate a formation with itself: {formation_a_id}")

        # ------------------------------------------------------------------ #
        # 2. Validate both formations belong to this model + project.          #
        # ------------------------------------------------------------------ #
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Model {model_id} not found in project {project_id}")

        fa = await self._session.get(GeologicalFormationOrm, formation_a_id)
        fb = await self._session.get(GeologicalFormationOrm, formation_b_id)
        for label, f in (("formation_a", fa), ("formation_b", fb)):
            if f is None or f.app_project_id != project_id:
                raise ValueError(
                    f"{label} {formation_a_id if label == 'formation_a' else formation_b_id} "
                    f"not found in project {project_id}"
                )

        # ------------------------------------------------------------------ #
        # 3. Same naming-group check.                                          #
        # The architect decision: edges only exist between formations in the   #
        # same (parent_formation_id, litho_main_soil_code) group.              #
        # ------------------------------------------------------------------ #
        assert fa is not None and fb is not None  # narrowed above
        if fa.parent_formation_id != fb.parent_formation_id:
            raise ValueError(
                f"Formations have different parent_formation_id: "
                f"{fa.parent_formation_id} vs {fb.parent_formation_id}"
            )
        if fa.litho_main_soil_code != fb.litho_main_soil_code:
            raise ValueError(
                f"Formations have different litho_main_soil_code: "
                f"{fa.litho_main_soil_code!r} vs {fb.litho_main_soil_code!r}"
            )

        # ------------------------------------------------------------------ #
        # 4. Canonical ordering: (min, max).                                   #
        # ------------------------------------------------------------------ #
        a_id = min(formation_a_id, formation_b_id)
        b_id = max(formation_a_id, formation_b_id)

        # ------------------------------------------------------------------ #
        # 5. Idempotent upsert — check for an existing edge.                  #
        # ------------------------------------------------------------------ #
        existing_stmt = select(LithoCorrelationEdgeOrm).where(
            LithoCorrelationEdgeOrm.model_id == model_id,
            LithoCorrelationEdgeOrm.formation_a_id == a_id,
            LithoCorrelationEdgeOrm.formation_b_id == b_id,
        )
        existing = (await self._session.execute(existing_stmt)).scalar_one_or_none()
        if existing is not None:
            self.info(
                f"CorrelateLithoUnits: edge already exists ({existing.id}) — "
                f"returning idempotent result"
            )
            # Still run the resolver so ordinals are always fresh (a
            # prior run may have failed to write ordinals back).
            updated = await self.run_resolver(model_id)
            return CorrelateResult(
                edge=existing,
                was_created=False,
                instance_ordinals_updated=updated,
            )

        # ------------------------------------------------------------------ #
        # 6. Insert the new edge.                                              #
        # ------------------------------------------------------------------ #
        edge = LithoCorrelationEdgeOrm(
            id=uuid7(),
            model_id=model_id,
            formation_a_id=a_id,
            formation_b_id=b_id,
            source=source,
        )
        self._session.add(edge)
        await self._session.flush()
        self.debug(f"CorrelateLithoUnits: edge inserted {edge.id}")

        # ------------------------------------------------------------------ #
        # 7. Re-run the resolver across all formations in this model.          #
        # ------------------------------------------------------------------ #
        # run_resolver marks the changed formations' surfaces stale
        # internally (review S1) so this path and uncorrelate behave
        # identically — no separate step here.
        updated = await self.run_resolver(model_id)

        # ------------------------------------------------------------------ #
        # 8. Trigger inference engine for both correlated formations.           #
        #    The edge insert + resolver + absence delta all commit atomically   #
        #    in step 9.  commit=False defers the session.commit() to step 9.   #
        # ------------------------------------------------------------------ #
        inference_uc = RecomputeFormationAbsencesForFormation(self._session)
        for fid in (formation_a_id, formation_b_id):
            self.debug(f"CorrelateLithoUnits: triggering absence inference for formation {fid}")
            await inference_uc.execute(
                project_id=project_id,
                model_id=model_id,
                formation_id=fid,
                commit=False,
            )

        # ------------------------------------------------------------------ #
        # 9. Commit (edge + resolver ordinals + absence delta).                #
        # ------------------------------------------------------------------ #
        await self._session.commit()
        await self._session.refresh(edge)
        self.success(
            f"CorrelateLithoUnits: committed edge {edge.id}; "
            f"{len(updated)} formation ordinal(s) updated"
        )
        return CorrelateResult(
            edge=edge,
            was_created=True,
            instance_ordinals_updated=updated,
        )

    async def run_resolver(self, model_id: UUID) -> list[dict]:
        """Run the pure resolver and write instance_ordinal back to changed rows.

        Returns a list of ``{"formation_id": str, "new_ordinal": int}`` dicts
        for every formation whose ordinal was changed.

        Parameters
        ----------
        model_id : UUID
            The model whose formations and edges are resolved.

        Returns
        -------
        list[dict]
            One entry per formation whose ordinal changed.
        """
        self.debug(f"run_resolver: loading formations + edges for model {model_id}")

        # Scope formations to THIS model, NOT the whole project (review
        # B1): a project may hold sibling litho models, and resolving one
        # must never read or renumber another's formations. "In this
        # model" = anchors a contact in this model OR is an endpoint of
        # an edge in this model. parent_formation_id is_not None keeps it
        # to litho-level units.
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            self.warning(f"run_resolver: model {model_id} gone — skipping")
            return []

        contacted = select(FormationContactOrm.formation_id).where(
            FormationContactOrm.model_id == model_id
        )
        edge_a = select(LithoCorrelationEdgeOrm.formation_a_id).where(
            LithoCorrelationEdgeOrm.model_id == model_id
        )
        edge_b = select(LithoCorrelationEdgeOrm.formation_b_id).where(
            LithoCorrelationEdgeOrm.model_id == model_id
        )
        reachable = contacted.union(edge_a, edge_b)
        formations_stmt = select(GeologicalFormationOrm).where(
            GeologicalFormationOrm.app_project_id == model.app_project_id,
            GeologicalFormationOrm.parent_formation_id.is_not(None),
            GeologicalFormationOrm.id.in_(reachable),
        )
        formations_rows = list((await self._session.execute(formations_stmt)).scalars().all())

        # Earliest depth per formation — ONE GROUP BY, not an N+1 of
        # per-formation SELECTs (review S2). Formations with no contacts
        # in this model are absent → earliest.get(id) yields None.
        depth_rows = (
            await self._session.execute(
                select(
                    FormationContactOrm.formation_id,
                    func.min(FormationContactOrm.depth_top_m),
                )
                .where(FormationContactOrm.model_id == model_id)
                .group_by(FormationContactOrm.formation_id)
            )
        ).all()
        earliest: dict[UUID, float | None] = {fid: d for fid, d in depth_rows}

        nodes: list[FormationNode] = [
            FormationNode(
                formation_id=f.id,
                parent_formation_id=f.parent_formation_id,
                litho_main_soil_code=f.litho_main_soil_code,
                earliest_contact_depth_m=earliest.get(f.id),
                instance_ordinal=f.instance_ordinal,
                instance_ordinal_locked=f.instance_ordinal_locked,
            )
            for f in formations_rows
        ]

        edges_stmt = select(LithoCorrelationEdgeOrm).where(
            LithoCorrelationEdgeOrm.model_id == model_id
        )
        edge_rows = list((await self._session.execute(edges_stmt)).scalars().all())
        edges: list[CorrelationEdge] = [
            CorrelationEdge(
                formation_a_id=e.formation_a_id,
                formation_b_id=e.formation_b_id,
            )
            for e in edge_rows
        ]

        self.debug(f"run_resolver: {len(nodes)} formation node(s), {len(edges)} edge(s)")

        result = resolve_litho_instances(formations=nodes, edges=edges)

        if result.lock_conflicts:
            for conflict in result.lock_conflicts:
                self.warning(
                    f"run_resolver: lock conflict — "
                    f"winner={conflict.winner_formation_id} "
                    f"loser={conflict.loser_formation_id} "
                    f"ordinal={conflict.contested_ordinal}"
                )

        # Write back ordinals to non-locked formations that changed.
        updated: list[dict] = []
        orm_by_id: dict[UUID, GeologicalFormationOrm] = {f.id: f for f in formations_rows}
        loser_ids = {c.loser_formation_id for c in result.lock_conflicts}
        for fid, new_ordinal in result.ordinals.items():
            f_orm = orm_by_id.get(fid)
            if f_orm is None:
                continue
            # Never write back to locked formations (unless they are a
            # conflict loser, in which case the resolver already
            # overrode them — but the loser's row is skipped here;
            # the winner's ordinal is written as the component value).
            if f_orm.instance_ordinal_locked and fid not in loser_ids:
                continue
            if f_orm.instance_ordinal != new_ordinal:
                # Capture BEFORE the mutation — reading f_orm.instance_ordinal
                # after the assignment logs "X → X" and is useless for
                # tracing ordinal drift (review B2).
                old_ordinal = f_orm.instance_ordinal
                f_orm.instance_ordinal = new_ordinal
                updated.append({"formation_id": str(fid), "new_ordinal": new_ordinal})
                self.debug(f"run_resolver: formation {fid} ordinal {old_ordinal} → {new_ordinal}")

        if updated:
            await self._session.flush()
            # Ordinal/label changed → the inspector grouping changed, so the
            # section view's stale-surface cue must fire even though no
            # geometry moved. Done HERE (not in execute) so uncorrelate gets
            # it too (review S1) — both callers route through run_resolver.
            pairs = [(model_id, UUID(e["formation_id"])) for e in updated]
            await self._repo.mark_surfaces_stale(pairs)
            self.info(
                f"run_resolver: wrote back {len(updated)} ordinal change(s) "
                f"+ marked surfaces stale for model {model_id}"
            )
        else:
            self.debug(f"run_resolver: no ordinal changes for model {model_id}")

        return updated
