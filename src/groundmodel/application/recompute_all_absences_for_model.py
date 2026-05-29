"""Use case — re-run absence inference for every formation in a lithostratigraphic model.

Designed as the one-shot "recompute all" companion to bulk-accept flows.  When
the frontend accepts N anchors with ``defer_inference=True`` it avoids running
the R7 inference hook per-anchor (which would multiply to ~N × formations ×
sections inference passes).  Instead it calls this use case ONCE after all N
accepts, which runs a single inference pass per formation — O(formations ×
sections) regardless of N.

Architecture
------------
Delegates per-formation work to :class:`RecomputeFormationAbsencesForFormation`
and :class:`MaterializeWedgeTipsForFormation` (same as the per-accept R7 hook),
so the inference semantics are identical — just batched into one transaction.

Atomicity
---------
All formation deltas accumulate in a single session and are committed once at
the end.  Either every formation is updated or none is (rollback on exception).

Guards
------
* Model must exist in the project (scope guard).
* Model kind must be ``'lithostratigraphic'`` (422 from the router; use case
  raises ``ValueError`` so callers in tests can inspect the message).
* Only formations that have at least one contact in the model are processed —
  formations with no contacts have no inference to run.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.materialize_wedge_tips_for_formation import (
    MaterializeWedgeTipsForFormation,
)
from groundmodel.application.recompute_formation_absences_for_body import (
    load_corridor_investigations,
    load_observation_layers,
)
from groundmodel.application.recompute_formation_absences_for_formation import (
    RecomputeFormationAbsencesForFormation,
    SectionInferenceData,
)
from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class RecomputeAllAbsencesResult:
    """Return value of :meth:`RecomputeAllAbsencesForModel.execute`.

    Attributes
    ----------
    formations_processed : int
        Number of formations that had at least one contact and received a
        full inference + wedge-tip pass.
    total_written : int
        Total ``formation_absence`` rows written (inserted or updated)
        across all formations and sections.
    total_retracted : int
        Total stale ``'inferred'`` absence rows deleted.
    total_wedge_tips_created : int
        Total synthetic wedge-tip contacts created across all formations.
    total_wedge_tips_deleted : int
        Total stale synthetic contacts deleted before re-materialisation.
    """

    formations_processed: int
    total_written: int
    total_retracted: int
    total_wedge_tips_created: int
    total_wedge_tips_deleted: int


class RecomputeAllAbsencesForModel(GroundModelLogger):
    """Bulk inference recompute for all formations in a lithostratigraphic model.

    Iterates every formation that has at least one committed contact in the
    model, runs :class:`RecomputeFormationAbsencesForFormation` then
    :class:`MaterializeWedgeTipsForFormation` for each, accumulates the deltas
    in one transaction, and commits once at the end.

    Intended as the final step in a ``defer_inference=True`` bulk-accept flow:
    the caller skips per-accept inference (fast) and calls this once after all
    accepts (single pass).

    Parameters
    ----------
    session : AsyncSession
        Active database session.  The caller must NOT commit before this use
        case runs — this use case commits once at the end.
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
        only_formation_ids: list[UUID] | None = None,
    ) -> RecomputeAllAbsencesResult:
        """Re-run inference for every formation with contacts in ``model_id``.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — model must belong to this project.
        model_id : UUID
            The lithostratigraphic model to recompute.  Must be
            ``kind='lithostratigraphic'`` (``ValueError`` raised otherwise).
        only_formation_ids : list[UUID] | None
            Incremental recompute (#155): when given, only these formations are
            re-inferred (intersected with the formations that actually have
            contacts in the model), instead of the whole model.  A bulk accept
            touches only the formations it created/found, so recomputing just
            those — not every formation × every section — turns the per-accept
            inference from O(model size) into O(accepted).  ``None`` (default)
            recomputes every formation with contacts (full model).

        Returns
        -------
        RecomputeAllAbsencesResult
            Aggregate counts across all processed formations.

        Raises
        ------
        ValueError
            When the model is not found, does not belong to ``project_id``,
            or is not a lithostratigraphic model.
        """
        self.info(f"RecomputeAllAbsencesForModel.execute: project={project_id} model={model_id}")

        # ------------------------------------------------------------------
        # 1. Scope guard + kind guard.
        # ------------------------------------------------------------------
        model = await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Geological model"
        )

        if model.kind != MODEL_KIND_LITHOSTRATIGRAPHIC:
            raise ValueError(
                f"Model {model_id} has kind='{model.kind}'; "
                f"recompute-all-absences requires kind='{MODEL_KIND_LITHOSTRATIGRAPHIC}'"
            )

        # ------------------------------------------------------------------
        # 2. Discover the unique formation ids that have contacts in this model.
        #    Only these formations can have inferred absences.  When the caller
        #    passes ``only_formation_ids`` (incremental recompute, #155) the
        #    discovery is restricted to that set so a bulk accept re-infers only
        #    the formations it touched, not the whole model.
        # ------------------------------------------------------------------
        discover_stmt = (
            select(FormationContactOrm.formation_id)
            .where(FormationContactOrm.model_id == model_id)
            .distinct()
        )
        if only_formation_ids is not None:
            discover_stmt = discover_stmt.where(
                FormationContactOrm.formation_id.in_(only_formation_ids)
            )
        formation_id_rows = (await self._session.execute(discover_stmt)).scalars().all()
        formation_ids: list[UUID] = list(formation_id_rows)
        total = len(formation_ids)

        self.info(
            f"RecomputeAllAbsencesForModel: {total} formation(s) with contacts in model {model_id}"
            + (f" (filtered to {len(only_formation_ids)} requested)" if only_formation_ids else "")
        )

        if total == 0:
            self.info(
                "RecomputeAllAbsencesForModel: no formations with contacts — nothing to recompute"
            )
            return RecomputeAllAbsencesResult(
                formations_processed=0,
                total_written=0,
                total_retracted=0,
                total_wedge_tips_created=0,
                total_wedge_tips_deleted=0,
            )

        # ------------------------------------------------------------------
        # 2b. Build the per-section inference cache ONCE (#153 hoist).
        #     Corridor membership + observation layers are identical across
        #     every formation for a given section, so computing them once here
        #     and reusing across all F formations removes the O(F × sections)
        #     redundant corridor/observation scans the per-formation path would
        #     otherwise issue.
        # ------------------------------------------------------------------
        section_rows = list(
            (
                await self._session.execute(
                    select(CrossSectionOrm)
                    .where(CrossSectionOrm.app_project_id == project_id)
                    .order_by(CrossSectionOrm.display_order)
                )
            )
            .scalars()
            .all()
        )
        section_cache: dict[UUID, SectionInferenceData] = {}
        for section in section_rows:
            corridor = await load_corridor_investigations(
                self._session, project_id=project_id, section=section
            )
            obs_layers = await load_observation_layers(
                self._session, corridor_investigations=corridor
            )
            section_cache[section.id] = (section, corridor, obs_layers)
        self.info(
            f"RecomputeAllAbsencesForModel: built section cache for {len(section_cache)} "
            f"section(s) — reused across {total} formation(s)"
        )

        # ------------------------------------------------------------------
        # 3. Run per-formation inference + wedge-tip materialisation, all in
        #    the same session (commit=False defers to the single commit below).
        # ------------------------------------------------------------------
        inference_uc = RecomputeFormationAbsencesForFormation(self._session)
        materialize_uc = MaterializeWedgeTipsForFormation(self._session)

        formations_processed = 0
        total_written = 0
        total_retracted = 0
        total_wedge_tips_created = 0
        total_wedge_tips_deleted = 0

        for i, fid in enumerate(sorted(formation_ids), start=1):
            self.debug(
                f"[{i}/{total}] RecomputeAllAbsencesForModel: formation {fid} — inference pass"
            )
            try:
                inf_result = await inference_uc.execute(
                    project_id=project_id,
                    model_id=model_id,
                    formation_id=fid,
                    commit=False,
                    section_cache=section_cache,
                )
                total_written += inf_result.total_written
                total_retracted += inf_result.total_retracted

                self.debug(
                    f"[{i}/{total}] RecomputeAllAbsencesForModel: "
                    f"formation {fid} — wedge-tip materialisation"
                )
                mat_result = await materialize_uc.execute(
                    project_id=project_id,
                    model_id=model_id,
                    formation_id=fid,
                    commit=False,
                )
                total_wedge_tips_created += mat_result.new_contacts_created
                total_wedge_tips_deleted += mat_result.old_contacts_deleted
                formations_processed += 1
            except (ValueError, Exception) as exc:
                # Log and skip so one broken formation does not abort the
                # entire batch.  The session is not rolled back here — all
                # prior formations in this iteration remain staged.
                self.warning(
                    f"[{i}/{total}] RecomputeAllAbsencesForModel: "
                    f"formation {fid} failed — skipping: {exc}"
                )

        # ------------------------------------------------------------------
        # 4. Single commit for the full batch.
        # ------------------------------------------------------------------
        await self._session.commit()

        self.success(
            f"RecomputeAllAbsencesForModel done: model={model_id} "
            f"formations_processed={formations_processed}/{total} "
            f"written={total_written} retracted={total_retracted} "
            f"wedge_tips_created={total_wedge_tips_created} "
            f"wedge_tips_deleted={total_wedge_tips_deleted}"
        )
        return RecomputeAllAbsencesResult(
            formations_processed=formations_processed,
            total_written=total_written,
            total_retracted=total_retracted,
            total_wedge_tips_created=total_wedge_tips_created,
            total_wedge_tips_deleted=total_wedge_tips_deleted,
        )
