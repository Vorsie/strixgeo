"""Accept-contact-correlations use case — #133 Phase 2+3.

Flips ``user_approved=False → True`` in scope, then runs the resolver +
lens detection in the same transaction.

Scope rules
-----------
* **Section-scoped** (``section_id`` supplied): edges where BOTH
  ``contact_a_id`` and ``contact_b_id`` are in the section's
  ``seeded_formation_contact_ids`` list AND ``user_approved=False``.
* **Model-scoped** (``section_id=None``): all edges in the model with
  ``user_approved=False``.

The use case owns the commit boundary — ``ResolveLithoInstances`` and
``DetectLithoLenses`` are called with ``commit=False`` / flush-only so
all mutations land in one atomic transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.detect_litho_lenses import DetectLithoLenses
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class AcceptResult:
    """Outcome counts for the accept pass.

    Attributes
    ----------
    edges_accepted : int
        Number of edge rows whose ``user_approved`` flipped from False to True.
    lenses_created : int
        ``LithoLensOrm`` rows inserted this pass (from ``DetectLithoLenses``).
    lenses_removed : int
        Stale ``LithoLensOrm`` rows deleted this pass (from ``DetectLithoLenses``).
    ordinals_changed : int
        Number of formations whose ``instance_ordinal`` changed during the
        resolver step (from ``ResolveLithoInstances``).
    """

    edges_accepted: int
    lenses_created: int
    lenses_removed: int
    ordinals_changed: int


class AcceptContactCorrelations(GroundModelLogger):
    """Approve unapproved contact-correlation edges in scope.

    Scope is section-local when ``section_id`` is supplied (both endpoints
    must be in the section's ``seeded_formation_contact_ids``); model-wide
    otherwise.

    After flipping approval, runs ``ResolveLithoInstances`` (to refresh
    ``instance_ordinal`` values) and ``DetectLithoLenses`` (to reconcile
    ``LithoLensOrm`` rows) in the same transaction before committing.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        section_id: UUID | None = None,
    ) -> AcceptResult:
        """Run the accept flow.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model whose edges are being accepted.
        section_id : UUID | None
            When supplied, limits acceptance to edges whose both endpoints
            are in the section's ``seeded_formation_contact_ids``.
            When ``None``, every unapproved edge in the model is accepted.

        Returns
        -------
        AcceptResult
            Counts of edges accepted and downstream lens + ordinal deltas.

        Raises
        ------
        ValueError
            If the model or (when supplied) the section is not found in the
            given project.
        """
        self.info(
            f"AcceptContactCorrelations.execute: project={project_id} "
            f"model={model_id} section={section_id}"
        )

        # ------------------------------------------------------------------ #
        # 1. Scope guard — verify model belongs to project.                  #
        # ------------------------------------------------------------------ #
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")
        self.debug(f"AcceptContactCorrelations: model scope guard passed for {model_id}")

        # ------------------------------------------------------------------ #
        # 2. Build the in-scope edge id set.                                 #
        # ------------------------------------------------------------------ #
        if section_id is not None:
            sec = await self._session.get(CrossSectionOrm, section_id)
            if sec is None or sec.app_project_id != project_id:
                raise ValueError(f"Cross-section {section_id} not found in project {project_id}")
            section_contact_ids: set[UUID] = set(sec.seeded_formation_contact_ids or [])
            self.debug(
                f"AcceptContactCorrelations: section {section_id} has "
                f"{len(section_contact_ids)} seeded contact(s)"
            )
            in_scope_stmt = select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
                LithoContactCorrelationEdgeOrm.contact_a_id.in_(section_contact_ids),
                LithoContactCorrelationEdgeOrm.contact_b_id.in_(section_contact_ids),
            )
        else:
            self.debug("AcceptContactCorrelations: model-scoped accept (no section filter)")
            in_scope_stmt = select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
            )

        edge_ids = [r[0] for r in (await self._session.execute(in_scope_stmt)).all()]
        self.debug(f"AcceptContactCorrelations: {len(edge_ids)} unapproved edge(s) in scope")

        # ------------------------------------------------------------------ #
        # 3. Flip approval for all in-scope edges.                           #
        # ------------------------------------------------------------------ #
        if edge_ids:
            await self._session.execute(
                update(LithoContactCorrelationEdgeOrm)
                .where(LithoContactCorrelationEdgeOrm.id.in_(edge_ids))
                .values(user_approved=True)
            )
            await self._session.flush()
            self.debug(f"AcceptContactCorrelations: flipped {len(edge_ids)} edge(s) to approved")
        edges_accepted = len(edge_ids)

        # ------------------------------------------------------------------ #
        # 4. Re-run the resolver so instance_ordinal values are current.     #
        # ------------------------------------------------------------------ #
        resolve_result = await ResolveLithoInstances(self._session).execute(
            model_id=model_id,
            commit=False,  # caller owns the commit boundary
        )
        ordinals_changed = len(resolve_result.updated)
        self.debug(f"AcceptContactCorrelations: resolver changed {ordinals_changed} ordinal(s)")

        # ------------------------------------------------------------------ #
        # 5. Reconcile LithoLensOrm rows.                                    #
        # ------------------------------------------------------------------ #
        detect_result = await DetectLithoLenses(self._session).execute(
            project_id=project_id,
            model_id=model_id,
            prefer_section_id=section_id,
        )

        # ------------------------------------------------------------------ #
        # 6. Commit the whole transaction atomically.                        #
        # ------------------------------------------------------------------ #
        await self._session.commit()

        self.success(
            f"AcceptContactCorrelations: accepted={edges_accepted} "
            f"ordinals_changed={ordinals_changed} "
            f"lenses_created={detect_result.lenses_created} "
            f"lenses_removed={detect_result.lenses_removed}"
        )
        return AcceptResult(
            edges_accepted=edges_accepted,
            lenses_created=detect_result.lenses_created,
            lenses_removed=detect_result.lenses_removed,
            ordinals_changed=ordinals_changed,
        )
