"""Use case — run the inference engine for one formation body and apply the delta.

Position 4 architecture (#101 R3).  Called after every correlation-edge
mutation and observation-data mutation that affects a formation.

Atomically:
1. Load all contacts for ``(model_id, formation_id)`` that belong to the
   target body (``body_ordinal``).
2. Load all in-corridor investigations for the given section.
3. Load all observation layers for those investigations.
4. Load existing absence rows for this formation + corridor.
5. Run ``infer_formation_absences`` (pure domain, no I/O).
6. Write the delta: INSERT/UPSERT ``to_write`` rows; DELETE ``to_retract`` rows.
7. Commit.

Idempotency: calling this twice with unchanged inputs produces the same DB
state.  The write step uses ON CONFLICT DO UPDATE so repeated calls are
no-ops at the constraint level.

Positive-evidence guard is enforced by the domain engine: investigations with
no observation layer overlapping the body's depth band are skipped
(UNKNOWN, not ABSENT).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.lens_inference import (
    BodyContactRecord,
    FormationAbsenceRecord,
    ObservationLayerRecord,
    infer_formation_absences,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class RecomputeFormationAbsencesResult:
    """Return value of :meth:`RecomputeFormationAbsencesForBody.execute`.

    Attributes
    ----------
    written_count : int
        Number of absence rows inserted or updated.
    retracted_count : int
        Number of stale ``'inferred'`` rows deleted.
    skipped_no_data_count : int
        Number of absent investigations with no overlapping observation layer.
    """

    written_count: int
    retracted_count: int
    skipped_no_data_count: int


class RecomputeFormationAbsencesForBody(GroundModelLogger):
    """Run the inference engine for one body and apply the delta to the DB.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
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
        body_ordinal: int,
        section_id: UUID,
        commit: bool = True,
    ) -> RecomputeFormationAbsencesResult:
        """Run inference and apply the absence delta.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Lithostratigraphic model that owns the correlation graph.
        formation_id : UUID
            The geological formation whose body is being re-evaluated.
        body_ordinal : int
            Zero-based ordinal identifying which body of this formation to
            process (from the ``ResolveLithoInstances`` resolver).
        section_id : UUID
            The cross-section that defines the corridor of investigations.
        commit : bool
            When ``True`` (the default) the session is committed after
            applying the delta.  Pass ``False`` when the caller owns the
            transaction and will commit after orchestrating multiple
            inference runs in the same session (used by
            ``RecomputeFormationAbsencesForFormation``).

        Returns
        -------
        RecomputeFormationAbsencesResult
            Counts of written, retracted, and skipped rows.

        Raises
        ------
        ValueError
            When the project, model, formation, or section is not found.
        """
        self.info(
            f"RecomputeFormationAbsencesForBody.execute: "
            f"project={project_id} model={model_id} "
            f"formation={formation_id} ordinal={body_ordinal} "
            f"section={section_id}"
        )

        # ------------------------------------------------------------------
        # 1. Scope guards.
        # ------------------------------------------------------------------
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        formation = await self._session.get(GeologicalFormationOrm, formation_id)
        if formation is None or formation.app_project_id != project_id:
            raise ValueError(f"Formation {formation_id} not found in project {project_id}")

        section = await self._session.get(CrossSectionOrm, section_id)
        if section is None or section.app_project_id != project_id:
            raise ValueError(f"Cross-section {section_id} not found in project {project_id}")

        formation_soil_code: str | None = getattr(formation, "litho_main_soil_code", None)
        self.debug(f"Formation soil code: {formation_soil_code!r} (formation {formation_id})")

        # ------------------------------------------------------------------
        # 2. Load contacts for this body (model_id + formation_id).
        #    Body identity is stored on LithoLensOrm.body_ordinal but contacts
        #    themselves don't carry it — the resolver assigns ordinals globally.
        #    We load ALL contacts for (model, formation) and use the provided
        #    body_ordinal as a filter via the correlation graph.  For MVP the
        #    simplest correct approach: load ALL contacts for (model, formation)
        #    since at inference-time the caller already resolved which body the
        #    contacts belong to and passes body_ordinal for scoping metadata only.
        #    The inference engine computes the depth-band from whatever contacts
        #    it receives, so the caller must pre-filter to the specific body.
        #
        #    For Position 4 MVP: we treat ALL contacts for (model, formation) as
        #    the body's contacts.  Multi-body disambiguation (ordinal > 1) is a
        #    Phase 5 refinement — the inference engine design already supports it
        #    via its pure-function interface.
        # ------------------------------------------------------------------
        contact_rows = (
            await self._session.execute(
                select(
                    FormationContactOrm.borehole_id,
                    FormationContactOrm.cpt_id,
                    FormationContactOrm.depth_top_m,
                ).where(
                    FormationContactOrm.model_id == model_id,
                    FormationContactOrm.formation_id == formation_id,
                )
            )
        ).all()

        body_contacts: list[BodyContactRecord] = []
        for row in contact_rows:
            if row.borehole_id is not None:
                body_contacts.append(
                    BodyContactRecord(
                        investigation_id=row.borehole_id,
                        investigation_kind="borehole",
                        depth_top_m=row.depth_top_m,
                    )
                )
            elif row.cpt_id is not None:
                body_contacts.append(
                    BodyContactRecord(
                        investigation_id=row.cpt_id,
                        investigation_kind="cpt",
                        depth_top_m=row.depth_top_m,
                    )
                )
        self.debug(f"Loaded {len(body_contacts)} body contacts for formation {formation_id}")

        # ------------------------------------------------------------------
        # 3. Collect in-corridor investigations from the section's projection
        #    buffer.  Use the section's bounding box + buffer as the corridor
        #    definition — same logic used by BuildSectionSnapshot.
        # ------------------------------------------------------------------
        corridor_investigations = await self._load_corridor_investigations(
            project_id=project_id, section=section
        )
        self.debug(
            f"Corridor has {len(corridor_investigations)} investigations (section {section_id})"
        )

        # ------------------------------------------------------------------
        # 4. Load observation layers for corridor investigations.
        # ------------------------------------------------------------------
        observation_layers = await self._load_observation_layers(
            corridor_investigations=corridor_investigations
        )
        self.debug(f"Loaded {len(observation_layers)} observation layers")

        # ------------------------------------------------------------------
        # 5. Load existing absence rows for this formation + corridor.
        # ------------------------------------------------------------------
        corridor_inv_ids = [inv_id for inv_id, _ in corridor_investigations]
        existing_rows = (
            await self._session.execute(
                select(
                    FormationAbsenceOrm.id,
                    FormationAbsenceOrm.investigation_id,
                    FormationAbsenceOrm.investigation_kind,
                    FormationAbsenceOrm.source,
                ).where(
                    FormationAbsenceOrm.formation_id == formation_id,
                    FormationAbsenceOrm.investigation_id.in_(corridor_inv_ids),
                )
            )
        ).all()

        existing_absences: list[FormationAbsenceRecord] = [
            FormationAbsenceRecord(
                absence_id=row.id,
                investigation_id=row.investigation_id,
                investigation_kind=row.investigation_kind,
                source=row.source,
            )
            for row in existing_rows
        ]
        self.debug(
            f"Loaded {len(existing_absences)} existing absence rows for formation {formation_id}"
        )

        # ------------------------------------------------------------------
        # 6. Run the inference engine (pure domain).
        # ------------------------------------------------------------------
        result = infer_formation_absences(
            formation_id=formation_id,
            formation_soil_code=formation_soil_code,
            body_contacts=body_contacts,
            corridor_investigations=corridor_investigations,
            observation_layers=observation_layers,
            existing_absences=existing_absences,
        )
        self.debug(
            f"Inference result: "
            f"to_write={len(result.to_write)} "
            f"to_retract={len(result.to_retract)} "
            f"skipped={len(result.skipped_no_data)}"
        )

        # ------------------------------------------------------------------
        # 7. Apply delta.
        # ------------------------------------------------------------------
        written_count = 0
        retracted_count = 0

        # UPSERT to_write rows.  PostgreSQL INSERT ON CONFLICT DO UPDATE.
        for i, absence in enumerate(result.to_write, start=1):
            self.debug(
                f"[{i}/{len(result.to_write)}] "
                f"UPSERT absence: {absence.investigation_kind} "
                f"{absence.investigation_id} source={absence.source}"
            )
            now = func.now()
            stmt = (
                pg_insert(FormationAbsenceOrm)
                .values(
                    id=uuid7(),
                    formation_id=absence.formation_id,
                    investigation_id=absence.investigation_id,
                    investigation_kind=absence.investigation_kind,
                    source=absence.source,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    constraint="uq_formation_absence_formation_investigation",
                    set_={"source": absence.source, "updated_at": func.now()},
                    # Defense-in-depth: only overwrite when the existing row
                    # is still inferred.  A 'manual' or 'observed' row that
                    # somehow ends up in to_write (application-layer bug or
                    # race) must NOT be silently demoted to 'inferred'.
                    where=FormationAbsenceOrm.source == "inferred",
                )
            )
            await self._session.execute(stmt)
            written_count += 1

        # DELETE retracted rows.
        if result.to_retract:
            await self._session.execute(
                delete(FormationAbsenceOrm).where(FormationAbsenceOrm.id.in_(result.to_retract))
            )
            retracted_count = len(result.to_retract)
            self.debug(f"Retracted {retracted_count} stale inferred absence(s)")

        if commit:
            await self._session.commit()

        self.success(
            f"RecomputeFormationAbsencesForBody done: "
            f"formation={formation_id} ordinal={body_ordinal} "
            f"written={written_count} retracted={retracted_count} "
            f"skipped_no_data={len(result.skipped_no_data)}"
        )
        return RecomputeFormationAbsencesResult(
            written_count=written_count,
            retracted_count=retracted_count,
            skipped_no_data_count=len(result.skipped_no_data),
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_corridor_investigations(
        self,
        *,
        project_id: UUID,
        section: CrossSectionOrm,
    ) -> list[tuple[UUID, str]]:
        """Return ``(investigation_id, kind)`` pairs within the section corridor.

        Uses the section's bounding box expanded by ``projection_buffer_m`` to
        find in-corridor investigations.  The corridor geometry mirrors the
        approach used by ``BuildSectionSnapshot`` — parallel strips on each
        side of the section line.

        Parameters
        ----------
        project_id : UUID
            Project scope for the investigation queries.
        section : CrossSectionOrm
            The cross-section that defines the corridor.

        Returns
        -------
        list[tuple[UUID, str]]
            All ``(investigation_id, 'borehole'|'cpt')`` pairs in the corridor.
        """
        buf = section.projection_buffer_m
        # Bounding box of the section line expanded by the buffer.
        min_x = min(section.start_x, section.end_x) - buf
        max_x = max(section.start_x, section.end_x) + buf
        min_y = min(section.start_y, section.end_y) - buf
        max_y = max(section.start_y, section.end_y) + buf

        bh_rows = (
            (
                await self._session.execute(
                    select(BoreholeOrm.id).where(
                        BoreholeOrm.app_project_id == project_id,
                        BoreholeOrm.location_x.between(min_x, max_x),
                        BoreholeOrm.location_y.between(min_y, max_y),
                    )
                )
            )
            .scalars()
            .all()
        )

        cpt_rows = (
            (
                await self._session.execute(
                    select(CptOrm.id).where(
                        CptOrm.app_project_id == project_id,
                        CptOrm.location_x.between(min_x, max_x),
                        CptOrm.location_y.between(min_y, max_y),
                    )
                )
            )
            .scalars()
            .all()
        )

        result: list[tuple[UUID, str]] = [(inv_id, "borehole") for inv_id in bh_rows] + [
            (inv_id, "cpt") for inv_id in cpt_rows
        ]
        return result

    async def _load_observation_layers(
        self,
        *,
        corridor_investigations: list[tuple[UUID, str]],
    ) -> list[ObservationLayerRecord]:
        """Load ``ObservationLayerOrm`` rows for all borehole investigations in the corridor.

        CPT Robertson-SBT layers are Phase 5; this method covers boreholes only.

        Parameters
        ----------
        corridor_investigations : list[tuple[UUID, str]]
            All corridor investigation pairs.

        Returns
        -------
        list[ObservationLayerRecord]
            Flattened list of observation-layer records for the corridor.
        """
        borehole_ids = [inv_id for inv_id, kind in corridor_investigations if kind == "borehole"]
        if not borehole_ids:
            return []

        # Load observation ids for these boreholes.
        obs_rows = (
            await self._session.execute(
                select(ObservationOrm.id, ObservationOrm.borehole_id).where(
                    ObservationOrm.borehole_id.in_(borehole_ids)
                )
            )
        ).all()

        if not obs_rows:
            return []

        obs_id_to_borehole: dict[UUID, UUID] = {r.id: r.borehole_id for r in obs_rows}
        obs_ids = list(obs_id_to_borehole.keys())

        layer_rows = (
            await self._session.execute(
                select(
                    ObservationLayerOrm.observation_id,
                    ObservationLayerOrm.top_m,
                    ObservationLayerOrm.base_m,
                    ObservationLayerOrm.main_soil_codes,
                ).where(ObservationLayerOrm.observation_id.in_(obs_ids))
            )
        ).all()

        records: list[ObservationLayerRecord] = []
        for row in layer_rows:
            borehole_id = obs_id_to_borehole.get(row.observation_id)
            if borehole_id is None:
                continue
            codes: list[str] = row.main_soil_codes or []
            records.append(
                ObservationLayerRecord(
                    investigation_id=borehole_id,
                    investigation_kind="borehole",
                    top_m=row.top_m,
                    base_m=row.base_m,
                    main_soil_codes=codes,
                )
            )
        return records
