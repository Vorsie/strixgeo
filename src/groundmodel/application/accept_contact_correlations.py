"""Accept-contact-correlations use case — #133 Phase 2+3.

Flips ``user_approved=False → True`` in scope, then runs the resolver +
lens detection in the same transaction.

Scope rules
-----------
* **Edge-scoped** (``edge_id`` supplied): the single edge with that id,
  if it belongs to the model and is currently unapproved.  ``section_id``
  is ignored when ``edge_id`` is set.  Surfaced via the right-click menu
  on a single correlation edge (dogfeed 2026-05-31).
* **Section-scoped** (``section_id`` supplied, ``edge_id=None``): edges
  where BOTH ``contact_a_id`` and ``contact_b_id`` are in the section's
  ``seeded_formation_contact_ids`` list AND ``user_approved=False``.
* **Model-scoped** (both ``None``): all edges in the model with
  ``user_approved=False``.

The use case owns the commit boundary — ``ResolveLithoInstances`` is
called with ``commit=False`` so the resolver result lands in the same
atomic transaction as the approval flip.

Lens detection is NOT fired here (owner directive 2026-05-31): the
explicit ``POST .../lenses/detect`` verb is the only entry point that
materialises or reconciles ``LithoLensOrm`` rows.  The ``bodies_created``
and ``bodies_removed`` fields on :class:`AcceptResult` stay on the
response shape for client compatibility but are always ``0`` from this
flow.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.scope_guard import load_scoped_or_raise
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
    bodies_created : int
        Always ``0`` — kept on the response for client compatibility.
        Body materialisation now runs only on the explicit
        ``POST .../bodies/detect`` verb (owner directive 2026-05-31).
        Renamed from ``lenses_created`` in Slice 3.3 (2026-06-01).
    bodies_removed : int
        Always ``0`` — see ``bodies_created`` above.
        Renamed from ``lenses_removed`` in Slice 3.3 (2026-06-01).
    ordinals_changed : int
        Number of formations whose ``instance_ordinal`` changed during the
        resolver step (from ``ResolveLithoInstances``).
    """

    edges_accepted: int
    bodies_created: int
    bodies_removed: int
    ordinals_changed: int


class AcceptContactCorrelations(GroundModelLogger):
    """Approve unapproved contact-correlation edges in scope.

    Scope is section-local when ``section_id`` is supplied (both endpoints
    must be in the section's ``seeded_formation_contact_ids``); model-wide
    otherwise.

    After flipping approval, runs ``ResolveLithoInstances`` (to refresh
    ``instance_ordinal`` values) in the same transaction before committing.
    Lens detection is intentionally omitted — see module docstring.
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
        edge_id: UUID | None = None,
    ) -> AcceptResult:
        """Run the accept flow.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model whose edges are being accepted.
        section_id : UUID | None
            When supplied (and ``edge_id`` is ``None``), limits acceptance
            to edges whose both endpoints are in the section's
            ``seeded_formation_contact_ids``.
        edge_id : UUID | None
            When supplied, accepts just that one edge (provided it belongs
            to the model and is unapproved). Takes precedence over
            ``section_id``. When both ``edge_id`` and ``section_id`` are
            ``None``, every unapproved edge in the model is accepted.

        Returns
        -------
        AcceptResult
            Counts of edges accepted and downstream lens + ordinal deltas.

        Raises
        ------
        ValueError
            If the model or (when supplied) the section is not found in the
            given project, or if ``edge_id`` is supplied but does not belong
            to the model.
        """
        self.info(
            f"AcceptContactCorrelations.execute: project={project_id} "
            f"model={model_id} section={section_id} edge={edge_id}"
        )

        # ------------------------------------------------------------------ #
        # 1. Scope guard — verify model belongs to project.                  #
        # ------------------------------------------------------------------ #
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Geological model"
        )
        self.debug(f"AcceptContactCorrelations: model scope guard passed for {model_id}")

        # ------------------------------------------------------------------ #
        # 2. Build the in-scope edge id set.                                 #
        # ------------------------------------------------------------------ #
        if edge_id is not None:
            # Edge-scoped: scope-check the edge belongs to this model. The
            # query against the unapproved filter handles the
            # already-approved no-op case (it returns 0 edges, the rest of
            # the flow short-circuits to a zero-result).
            scope_row = (
                await self._session.execute(
                    select(LithoContactCorrelationEdgeOrm.model_id).where(
                        LithoContactCorrelationEdgeOrm.id == edge_id
                    )
                )
            ).first()
            if scope_row is None:
                raise ValueError(f"Contact correlation edge {edge_id} not found.")
            if scope_row[0] != model_id:
                raise ValueError(
                    f"Contact correlation edge {edge_id} does not belong to model {model_id}."
                )
            self.debug(
                f"AcceptContactCorrelations: edge {edge_id} scope guard passed for {model_id}"
            )
            in_scope_stmt = select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.id == edge_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
            )
        elif section_id is not None:
            sec = await load_scoped_or_raise(
                self._session, CrossSectionOrm, section_id, project_id, label="Cross-section"
            )
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
        # 5. Commit the whole transaction atomically.                        #
        #    Lens detection is NOT fired here — see module docstring.       #
        # ------------------------------------------------------------------ #
        await self._session.commit()

        self.success(
            f"AcceptContactCorrelations: accepted={edges_accepted} "
            f"ordinals_changed={ordinals_changed} "
            f"bodies_created=0 bodies_removed=0"
        )
        return AcceptResult(
            edges_accepted=edges_accepted,
            bodies_created=0,
            bodies_removed=0,
            ordinals_changed=ordinals_changed,
        )
