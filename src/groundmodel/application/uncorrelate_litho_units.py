"""Uncorrelate-litho-units use case — Phase-2 Slice 1.

Deletes a correlation edge between two lithostratigraphic formation rows
and re-runs the ordinal resolver across all formations in the model to
renumber any components that were split.

This use case is MODEL-level only.  It does NOT touch cross-section
rows, seeded_formation_contact_ids, or any section-level state.  This
structural boundary is the reason the #57/applyUpdatedSection trap
cannot recur here: there is no section entity in scope at all.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.correlate_litho_units import CorrelateLithoUnits
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_correlation_edge_orm import (
    LithoCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class UncorrelateLithoUnits(GroundModelLogger):
    """Delete a correlation edge and re-run ordinal resolution."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        formation_a_id: UUID,
        formation_b_id: UUID,
    ) -> bool:
        """Delete the canonical edge and resolve ordinals for all model formations.

        Idempotent: returns ``False`` when the edge does not exist (no
        error, no DB change).

        After deletion the resolver is re-run across ALL formations in the
        model — a disconnected component that was previously one body may
        now be two bodies, both needing new ordinals.

        Parameters
        ----------
        project_id : UUID
            The owning project.  Passed through to the resolver helper so
            we only load formations that belong to this project.
        model_id : UUID
            The lithostratigraphic model the edge belongs to.
        formation_a_id : UUID
            One endpoint of the undirected edge (either order).
        formation_b_id : UUID
            The other endpoint.

        Returns
        -------
        bool
            ``True`` when an edge was deleted; ``False`` when no matching
            edge was found (idempotent non-error).

        Notes
        -----
        This use case is MODEL-level only.  It never modifies
        ``seeded_formation_contact_ids`` on any cross-section — the #57
        trap structurally cannot recur here.
        """
        self.info(f"UncorrelateLithoUnits: model={model_id} a={formation_a_id} b={formation_b_id}")

        # ------------------------------------------------------------------ #
        # 0. Defence-in-depth: verify the model belongs to project_id.         #
        #    The router already guards with get_in_project_or_404 (VULN-12);   #
        #    this check mirrors CorrelateLithoUnits for parity so a non-API    #
        #    caller can't skip the scope check.                                #
        # ------------------------------------------------------------------ #
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Model {model_id} not found in project {project_id}")

        # ------------------------------------------------------------------ #
        # 1. Canonical ordering — identical to the insert path.               #
        # ------------------------------------------------------------------ #
        a_id = min(formation_a_id, formation_b_id)
        b_id = max(formation_a_id, formation_b_id)

        # ------------------------------------------------------------------ #
        # 2. Find and delete the edge.                                         #
        # ------------------------------------------------------------------ #
        stmt = select(LithoCorrelationEdgeOrm).where(
            LithoCorrelationEdgeOrm.model_id == model_id,
            LithoCorrelationEdgeOrm.formation_a_id == a_id,
            LithoCorrelationEdgeOrm.formation_b_id == b_id,
        )
        edge = (await self._session.execute(stmt)).scalar_one_or_none()
        if edge is None:
            self.info(
                f"UncorrelateLithoUnits: no edge found for "
                f"({a_id}, {b_id}) in model {model_id} — idempotent no-op"
            )
            return False

        edge_id = edge.id
        await self._session.delete(edge)
        await self._session.flush()
        self.debug(f"UncorrelateLithoUnits: edge {edge_id} deleted")

        # ------------------------------------------------------------------ #
        # 3. Re-run the resolver.                                              #
        # A previously-connected component may have split into two; both      #
        # halves need new ordinals (e.g. the body that was ordinal 1 may now  #
        # become bodies 1 and 2, each numbered by earliest depth).            #
        # ------------------------------------------------------------------ #
        # The model-scoped resolver (formation-load + edge-load +
        # write-back + stale-marking) lives as a PUBLIC method on
        # CorrelateLithoUnits; reuse it directly — no cross-class private
        # access (review C1). It also marks changed surfaces stale, so
        # uncorrelate now gets that cue too (review S1).
        helper = CorrelateLithoUnits(self._session)
        updated = await helper.run_resolver(model_id)

        # ------------------------------------------------------------------ #
        # 4. Commit.                                                            #
        # ------------------------------------------------------------------ #
        await self._session.commit()
        self.success(
            f"UncorrelateLithoUnits: edge {edge_id} removed; "
            f"{len(updated)} formation ordinal(s) updated"
        )
        return True
