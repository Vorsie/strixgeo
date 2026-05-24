"""Use case — re-run the inference engine for all sections that contain a formation.

Position 4 architecture (#101 R7).  Called after every correlation-edge
mutation (correlate / uncorrelate) and after accepting litho suggestions,
to ensure the ``formation_absence`` table reflects the current state of
the correlation graph and observation data.

This is the **formation-level trigger**: it discovers every cross-section
whose corridor contains at least one contact for the given formation, then
calls :class:`RecomputeFormationAbsencesForBody` for each section in the
same session.  A single ``session.commit()`` at the end makes the whole
delta atomic — either every section's inferred absences are updated, or
none are (the correlation mutation rolls back with them).

Wedge-tip materialisation
-------------------------
``MaterializeWedgeTipsForFormation`` was listed as an R3 deliverable but
was not shipped.  R7 wires the inference trigger only.  Wedge-tip
re-materialisation after absence delta will land in the follow-up pass
when that use case exists.  This is a known gap — see docs/debt.md #101.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.recompute_formation_absences_for_body import (
    RecomputeFormationAbsencesForBody,
    RecomputeFormationAbsencesResult,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class FormationAbsencesForFormationResult:
    """Return value of :meth:`RecomputeFormationAbsencesForFormation.execute`.

    Attributes
    ----------
    sections_processed : int
        Number of cross-sections whose absence set was re-evaluated.
    total_written : int
        Total absence rows inserted or updated across all sections.
    total_retracted : int
        Total stale ``'inferred'`` rows deleted across all sections.
    total_skipped_no_data : int
        Total absent investigations with no overlapping observation layer.
    """

    sections_processed: int
    total_written: int
    total_retracted: int
    total_skipped_no_data: int


class RecomputeFormationAbsencesForFormation(GroundModelLogger):
    """Formation-level trigger for the Position 4 inference engine.

    Discovers every cross-section whose corridor contains at least one
    contact for the given formation in the given model, then runs the
    inference engine for each section within a single transaction.

    Parameters
    ----------
    session : AsyncSession
        Active database session.  The caller must NOT commit the session
        before this use case runs; this use case commits once at the end.
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
        formation_id: UUID,
        commit: bool = True,
    ) -> FormationAbsencesForFormationResult:
        """Re-run the inference engine for all sections relevant to this formation.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Lithostratigraphic model that owns the correlation graph.
        formation_id : UUID
            The geological formation whose absence inferences must be
            refreshed.
        commit : bool
            When ``True`` (the default) the session is committed after
            applying all section deltas.  Pass ``False`` when the caller
            owns the transaction (e.g. inside ``CorrelateLithoUnits`` or
            ``UncorrelateLithoUnits`` where the edge mutation and the
            inference delta must be atomic).

        Returns
        -------
        FormationAbsencesForFormationResult
            Aggregate counts across all processed sections.

        Raises
        ------
        ValueError
            When the model is not found or does not belong to
            ``project_id``.
        """
        self.info(
            f"RecomputeFormationAbsencesForFormation.execute: "
            f"project={project_id} model={model_id} formation={formation_id}"
        )

        # ------------------------------------------------------------------
        # 1. Scope guard.
        # ------------------------------------------------------------------
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        # ------------------------------------------------------------------
        # 2. Find all cross-sections for this project that have at least one
        #    contact for this formation in this model.
        #
        #    A section is "relevant" when its corridor overlaps with at least
        #    one investigation that carries a contact for the formation.  The
        #    cheapest proxy: find investigations that have a contact for this
        #    (model, formation), then load all project sections (there are
        #    typically 1–5 per project) and consider each a candidate.
        #    The inference engine itself computes the corridor membership —
        #    so we load all project sections and let the per-body use case
        #    handle filtering.  For v1.0 the number of sections is tiny
        #    (5–20 at most) so the O(sections) scan is negligible.
        # ------------------------------------------------------------------
        sections = await self._load_project_sections(project_id=project_id)
        self.debug(
            f"Found {len(sections)} section(s) in project {project_id} for absence recompute"
        )

        if not sections:
            self.info(
                f"RecomputeFormationAbsencesForFormation: no sections in project {project_id} — "
                "nothing to recompute"
            )
            return FormationAbsencesForFormationResult(
                sections_processed=0,
                total_written=0,
                total_retracted=0,
                total_skipped_no_data=0,
            )

        # ------------------------------------------------------------------
        # 3. Run inference for each section WITHOUT committing (commit=False).
        #    All section deltas accumulate in the same session; a single
        #    commit at the end makes the whole update atomic.
        # ------------------------------------------------------------------
        body_uc = RecomputeFormationAbsencesForBody(self._session)

        total_written = 0
        total_retracted = 0
        total_skipped_no_data = 0
        sections_processed = 0

        for i, section in enumerate(sections, start=1):
            self.debug(f"[{i}/{len(sections)}] section={section.id} name={section.name!r}")
            try:
                result: RecomputeFormationAbsencesResult = await body_uc.execute(
                    project_id=project_id,
                    model_id=model_id,
                    formation_id=formation_id,
                    body_ordinal=0,
                    section_id=section.id,
                    commit=False,
                )
                total_written += result.written_count
                total_retracted += result.retracted_count
                total_skipped_no_data += result.skipped_no_data_count
                sections_processed += 1
                self.debug(
                    f"[{i}/{len(sections)}] section={section.id}: "
                    f"written={result.written_count} "
                    f"retracted={result.retracted_count} "
                    f"skipped={result.skipped_no_data_count}"
                )
            except ValueError as exc:
                # Section or formation scoping issue — log and skip rather
                # than aborting all sections.  An individual section failure
                # (e.g. section deleted mid-flight) should not prevent other
                # sections from being updated.
                self.warning(
                    f"[{i}/{len(sections)}] section={section.id}: skipping due to ValueError: {exc}"
                )

        # ------------------------------------------------------------------
        # 4. Single commit for all section deltas (when the caller doesn't
        #    own the transaction).
        # ------------------------------------------------------------------
        if commit:
            await self._session.commit()

        self.success(
            f"RecomputeFormationAbsencesForFormation done: "
            f"formation={formation_id} "
            f"sections_processed={sections_processed} "
            f"total_written={total_written} "
            f"total_retracted={total_retracted} "
            f"total_skipped_no_data={total_skipped_no_data}"
        )
        return FormationAbsencesForFormationResult(
            sections_processed=sections_processed,
            total_written=total_written,
            total_retracted=total_retracted,
            total_skipped_no_data=total_skipped_no_data,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_project_sections(
        self,
        *,
        project_id: UUID,
    ) -> list[CrossSectionOrm]:
        """Return all cross-sections that belong to ``project_id``.

        For v1.0 the typical project has 1–5 sections.  Loading all of them
        and letting the per-body use case handle corridor membership is
        simpler and correct; the per-section inference engine call is cheap
        (it returns immediately when the corridor has no relevant contacts).

        Parameters
        ----------
        project_id : UUID
            Project scope.

        Returns
        -------
        list[CrossSectionOrm]
            All sections for the project, ordered by display_order.
        """
        stmt = (
            select(CrossSectionOrm)
            .where(CrossSectionOrm.app_project_id == project_id)
            .order_by(CrossSectionOrm.display_order)
        )
        rows = list((await self._session.execute(stmt)).scalars().all())
        return rows
