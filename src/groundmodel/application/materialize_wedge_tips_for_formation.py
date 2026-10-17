"""Use case — re-materialise wedge-tip synthetic contacts for one formation (#101 fix-up 2).

After the inference engine rewrites the ``formation_absence`` table for a
formation, any previous synthetic ``FormationContact`` rows (source
``'pinch_out_extrapolation'``) for that formation are stale: they were
computed from the old set of absences.  This use case:

1. Loads every cross-section for the project.
2. For each section, deletes existing synthetic contacts for this formation
   and removes their ids from ``seeded_formation_contact_ids``.
3. For each remaining ``formation_absence`` row whose investigation falls
   inside the section corridor, attempts to compute a wedge-tip geometry via
   ``compute_lens_pinch_tip``.
4. When the geometry succeeds, inserts two new synthetic contacts (on-line
   tip + perpendicular twin to break Delaunay collinearity) and adds their
   ids to the section's ``seeded_formation_contact_ids``.
5. When the geometry fails (insufficient contacts, no target surface,
   parallel surfaces), logs a warning and skips — absence rows are retained,
   only the synthetic geometry is absent.

Geometry prerequisites (both must hold per absence to produce a tip):

* The pinching formation must have at least one real contact on the section
  (on the opposite side of the absent investigation from the wedge direction).
  Without it, no dip can be estimated.
* The parent geological formation must have at least 2 real contacts on the
  parent geological model for this section (the target polyline).  Without
  it, the target surface is undefined.

When either prerequisite fails the absence is retained (inference result is
correct) but no synthetic contact is created.  The section view will render
the absent column correctly via the inference-absence display path; the
synthetic tip contact improves the TIN geometry but is not load-bearing for
the section display.

Atomicity
---------
``commit=False`` defers the transaction to the caller.  ``CorrelateLithoUnits``,
``UncorrelateLithoUnits``, and ``AcceptLithoSuggestions`` all pass
``commit=False`` here and commit once after the full inference + wedge-tip
cycle so the absence delta and the synthetic contacts are written atomically.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import Row, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.pinch_out_constants import (
    PINCH_OUT_CONFIDENCE,
    PINCH_OUT_SOURCE,
)
from groundmodel.application.recompute_formation_absences_for_body import load_project_sections
from groundmodel.domain.services.lens_pinch_out_geometry import (
    LensPinchGeometryError,
    LensPinchTip,
    compute_lens_pinch_tip,
    project_along_to_world,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Perpendicular offset for the Delaunay-collinearity-breaking twin contact.
# WHY 1.0 m: large enough to break Delaunay collinearity (compute_tin
# collapses collinear/duplicate (x, y) points silently, so without the
# offset the tip contact and the section-line contact share the same
# (x, y) in the TIN and the wedge degenerates to a point), yet small
# enough to be geologically negligible — well within normal CPT/borehole
# positioning uncertainty at any project scale.
_TWIN_OFFSET_M: float = 1.0

# Lateral buffer (metres) used to decide whether a section's corridor
# contains an absent investigation. Mirrors the bounding-box approach in
# ``RecomputeFormationAbsencesForBody._load_corridor_investigations``.
# We re-use the section's own ``projection_buffer_m`` rather than this
# constant, so this value is only a fallback when ``projection_buffer_m``
# is zero (should not happen in normal use).
_FALLBACK_BUFFER_M: float = 50.0


@dataclass
class WedgeTipMaterializationResult:
    """Return value of :meth:`MaterializeWedgeTipsForFormation.execute`.

    Attributes
    ----------
    sections_processed : int
        Number of cross-sections scanned.
    old_contacts_deleted : int
        Total stale synthetic contacts deleted across all sections.
    new_contacts_created : int
        Total new synthetic contacts inserted across all sections.
    absences_skipped_no_geometry : int
        Absence rows for which geometry could not be computed (insufficient
        contacts or parallel surfaces).  The absence rows are retained.
    """

    sections_processed: int
    old_contacts_deleted: int
    new_contacts_created: int
    absences_skipped_no_geometry: int


class MaterializeWedgeTipsForFormation(GroundModelLogger):
    """Re-materialise synthetic wedge-tip contacts for one formation after an absence delta.

    Parameters
    ----------
    session : AsyncSession
        Active database session.  The caller controls the transaction boundary
        via the ``commit`` parameter on :meth:`execute`.
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
    ) -> WedgeTipMaterializationResult:
        """Delete stale and insert fresh wedge-tip synthetic contacts.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Lithostratigraphic model that owns the correlation graph and
            whose contacts define the pinching polyline.
        formation_id : UUID
            The geological formation being materialised.
        commit : bool
            When ``True`` (the default) the session is committed after
            applying all changes.  Pass ``False`` when the caller owns
            the transaction (``CorrelateLithoUnits``, ``UncorrelateLithoUnits``,
            ``AcceptLithoSuggestions``).

        Returns
        -------
        WedgeTipMaterializationResult
            Aggregate counts of deleted, created, and skipped contacts.
            Returns a zero-count result (no-op) when the model or formation
            cannot be resolved — the caller already validated these inputs;
            this path is a defensive fallback for unit-test mock scenarios.
        """
        self.info(
            f"MaterializeWedgeTipsForFormation.execute: "
            f"project={project_id} model={model_id} formation={formation_id}"
        )

        # ------------------------------------------------------------------ #
        # 1. Scope guards + load model/formation metadata.                    #
        #                                                                      #
        # PROJECT MISMATCH → raises ValueError (debt #211-d): a row that      #
        # exists but belongs to a different project is the real IDOR risk —   #
        # the original silent-return made it indistinguishable from success.  #
        #                                                                      #
        # NOT FOUND → warning + early return (backwards-compatible):          #
        # a None from session.get means the row was just inserted and is not  #
        # yet visible in the unit-test mock's return map (the row is added     #
        # via session.add, not .get).  The caller already validated the        #
        # inputs; this is a defensive fallback for that test-mock scenario.   #
        # In production the row is always found at this point.                #
        # ------------------------------------------------------------------ #
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            self.warning(
                f"MaterializeWedgeTipsForFormation: model {model_id} not found "
                "— skipping (caller already validated; likely a test-mock gap)"
            )
            return WedgeTipMaterializationResult(
                sections_processed=0,
                old_contacts_deleted=0,
                new_contacts_created=0,
                absences_skipped_no_geometry=0,
            )
        if model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        formation = await self._session.get(GeologicalFormationOrm, formation_id)
        if formation is None:
            self.warning(
                f"MaterializeWedgeTipsForFormation: formation {formation_id} not found "
                "— skipping (caller already validated; likely a test-mock gap)"
            )
            return WedgeTipMaterializationResult(
                sections_processed=0,
                old_contacts_deleted=0,
                new_contacts_created=0,
                absences_skipped_no_geometry=0,
            )
        if formation.app_project_id != project_id:
            raise ValueError(
                f"GeologicalFormation {formation_id} not found in project {project_id}"
            )

        parent_model_id: UUID | None = model.parent_model_id
        parent_formation_id: UUID | None = formation.parent_formation_id

        # Log prerequisites so failures are diagnosable without a debugger.
        self.debug(
            f"MaterializeWedgeTipsForFormation: parent_model={parent_model_id} "
            f"parent_formation={parent_formation_id}"
        )

        # ------------------------------------------------------------------ #
        # 2. Load all project cross-sections.                                 #
        # ------------------------------------------------------------------ #
        sections = await load_project_sections(self._session, project_id=project_id)
        self.debug(f"MaterializeWedgeTipsForFormation: {len(sections)} section(s) in project")

        if not sections:
            self.info(
                f"MaterializeWedgeTipsForFormation: no sections in project {project_id} "
                "— nothing to materialise"
            )
            return WedgeTipMaterializationResult(
                sections_processed=0,
                old_contacts_deleted=0,
                new_contacts_created=0,
                absences_skipped_no_geometry=0,
            )

        # ------------------------------------------------------------------ #
        # 3. Load all formation_absence rows for this formation.              #
        # ------------------------------------------------------------------ #
        absence_rows = list(
            (
                await self._session.execute(
                    select(
                        FormationAbsenceOrm.id,
                        FormationAbsenceOrm.investigation_id,
                        FormationAbsenceOrm.investigation_kind,
                        FormationAbsenceOrm.source,
                    ).where(FormationAbsenceOrm.formation_id == formation_id)
                )
            ).all()
        )
        self.debug(
            f"MaterializeWedgeTipsForFormation: {len(absence_rows)} absence row(s) "
            f"for formation {formation_id}"
        )

        # ------------------------------------------------------------------ #
        # 4. Load real (non-synthetic) contacts for this formation in the     #
        #    litho model — used as the pinching polyline.                      #
        # ------------------------------------------------------------------ #
        pinching_contacts_stmt = select(
            FormationContactOrm.borehole_id,
            FormationContactOrm.cpt_id,
            FormationContactOrm.depth_top_m,
        ).where(
            FormationContactOrm.model_id == model_id,
            FormationContactOrm.formation_id == formation_id,
            # Exclude synthetic contacts — the pinching polyline must come
            # from physical investigations only.
            FormationContactOrm.source != PINCH_OUT_SOURCE,
        )
        pinching_contact_rows = list((await self._session.execute(pinching_contacts_stmt)).all())

        # ------------------------------------------------------------------ #
        # 5. Load parent geological formation contacts (target polyline).     #
        # ------------------------------------------------------------------ #
        # The target polyline comes from the geological (parent) model. When
        # either parent pointer is None the geometry cannot be computed and
        # all absences fall to the skip path.
        target_contact_rows: list[Row[tuple[UUID | None, UUID | None, float]]] = []
        if parent_model_id is not None and parent_formation_id is not None:
            target_contacts_stmt = select(
                FormationContactOrm.borehole_id,
                FormationContactOrm.cpt_id,
                FormationContactOrm.depth_top_m,
            ).where(
                FormationContactOrm.model_id == parent_model_id,
                FormationContactOrm.formation_id == parent_formation_id,
                FormationContactOrm.source != PINCH_OUT_SOURCE,
            )
            target_contact_rows = list((await self._session.execute(target_contacts_stmt)).all())
        self.debug(
            f"MaterializeWedgeTipsForFormation: "
            f"{len(pinching_contact_rows)} pinching contact(s), "
            f"{len(target_contact_rows)} target contact(s)"
        )

        # ------------------------------------------------------------------ #
        # 6. Load investigation (x, y) for all referenced ids.               #
        # ------------------------------------------------------------------ #
        # Collect all investigation ids we need to geocode.
        all_inv_ids: set[UUID] = set()
        for absence_row in absence_rows:
            all_inv_ids.add(absence_row.investigation_id)
        for pinching_row in pinching_contact_rows:
            if pinching_row.borehole_id is not None:
                all_inv_ids.add(pinching_row.borehole_id)
            elif pinching_row.cpt_id is not None:
                all_inv_ids.add(pinching_row.cpt_id)
        for target_row in target_contact_rows:
            if target_row.borehole_id is not None:
                all_inv_ids.add(target_row.borehole_id)
            elif target_row.cpt_id is not None:
                all_inv_ids.add(target_row.cpt_id)

        inv_xy: dict[UUID, tuple[float, float]] = {}
        inv_elevation: dict[UUID, float | None] = {}

        if all_inv_ids:
            # The borehole + CPT investigation surface elevation is
            # stored on the ``elevation_m`` column, NOT ``ground_level_m``
            # (the latter does not exist on either ORM — the materialiser
            # initially referenced it by mistake and 500'd every accept-
            # all call until the fix). Source of truth: BoreholeOrm /
            # CptOrm field declarations + the ElevationSource enum.
            bh_rows = list(
                (
                    await self._session.execute(
                        select(
                            BoreholeOrm.id,
                            BoreholeOrm.location_x,
                            BoreholeOrm.location_y,
                            BoreholeOrm.elevation_m,
                        ).where(BoreholeOrm.id.in_(all_inv_ids))
                    )
                ).all()
            )
            for r in bh_rows:
                inv_xy[r.id] = (r.location_x, r.location_y)
                inv_elevation[r.id] = r.elevation_m

            cpt_rows = list(
                (
                    await self._session.execute(
                        select(
                            CptOrm.id,
                            CptOrm.location_x,
                            CptOrm.location_y,
                            CptOrm.elevation_m,
                        ).where(CptOrm.id.in_(all_inv_ids))
                    )
                ).all()
            )
            for r in cpt_rows:
                inv_xy[r.id] = (r.location_x, r.location_y)
                inv_elevation[r.id] = r.elevation_m

        self.debug(f"MaterializeWedgeTipsForFormation: geocoded {len(inv_xy)} investigation(s)")

        # ------------------------------------------------------------------ #
        # 7. Delete stale synthetic contacts ONCE, before the section loop.   #
        #                                                                      #
        # The synthetic-tip query is (model, formation)-scoped — there is no  #
        # section column — so this MUST run outside the per-section loop.     #
        # Running it inside (pre-#231) meant section k+1's pass deleted the   #
        # fresh tips section k had just flushed AND pruned only the current    #
        # section's seeded array, leaving every other section with dangling    #
        # seeded UUIDs. Delete once; prune EVERY section's array.             #
        # ------------------------------------------------------------------ #
        total_old_deleted = 0
        total_new_created = 0
        total_skipped = 0

        old_synthetic_ids = await self._find_existing_synthetic_ids(
            model_id=model_id, formation_id=formation_id
        )
        if old_synthetic_ids:
            await self._session.execute(
                delete(FormationContactOrm).where(FormationContactOrm.id.in_(old_synthetic_ids))
            )
            for section in sections:
                await self._remove_from_seeded_ids(section=section, contact_ids=old_synthetic_ids)
            total_old_deleted = len(old_synthetic_ids)
            self.debug(
                f"deleted {total_old_deleted} stale synthetic contact(s) "
                f"across {len(sections)} section(s)"
            )

        for sec_idx, section in enumerate(sections, start=1):
            self.debug(f"[{sec_idx}/{len(sections)}] section={section.id} name={section.name!r}")
            sec_endpoints = SectionEndpoints(
                start_x=section.start_x,
                start_y=section.start_y,
                end_x=section.end_x,
                end_y=section.end_y,
            )
            buf = section.projection_buffer_m or _FALLBACK_BUFFER_M

            # ---------------------------------------------------------------- #
            # 7b. Build pinching polyline for this section.                    #
            # ---------------------------------------------------------------- #
            pinching_pts: list[tuple[float, float]] = []
            for pinching_row in pinching_contact_rows:
                inv_id = (
                    pinching_row.borehole_id
                    if pinching_row.borehole_id is not None
                    else pinching_row.cpt_id
                )
                if inv_id is None:
                    continue
                xy = inv_xy.get(inv_id)
                if xy is None:
                    continue
                proj = project_point_onto_line(sec_endpoints, xy[0], xy[1])
                if proj is None or abs(proj.offset) > buf:
                    continue
                # along_m + elevation: elevation = ground_level_m - depth_top_m.
                ground = inv_elevation.get(inv_id)
                if ground is None:
                    continue
                elevation_m = ground - pinching_row.depth_top_m
                pinching_pts.append((proj.along, elevation_m))

            # Sort ascending by along_m (required by compute_lens_pinch_tip).
            pinching_pts.sort(key=lambda p: p[0])

            # ---------------------------------------------------------------- #
            # 7c. Build target polyline for this section.                      #
            # ---------------------------------------------------------------- #
            target_pts: list[tuple[float, float]] = []
            for target_row in target_contact_rows:
                inv_id = (
                    target_row.borehole_id
                    if target_row.borehole_id is not None
                    else target_row.cpt_id
                )
                if inv_id is None:
                    continue
                xy = inv_xy.get(inv_id)
                if xy is None:
                    continue
                proj = project_point_onto_line(sec_endpoints, xy[0], xy[1])
                if proj is None or abs(proj.offset) > buf:
                    continue
                ground = inv_elevation.get(inv_id)
                if ground is None:
                    continue
                elevation_m = ground - target_row.depth_top_m
                target_pts.append((proj.along, elevation_m))

            target_pts.sort(key=lambda p: p[0])

            # ---------------------------------------------------------------- #
            # 7d. Attempt wedge-tip geometry for each absence in corridor.     #
            # ---------------------------------------------------------------- #
            new_contact_ids: list[UUID] = []
            for abs_row in absence_rows:
                inv_id = abs_row.investigation_id
                xy = inv_xy.get(inv_id)
                if xy is None:
                    # Investigation not geocoded (deleted?) — skip silently.
                    continue
                proj = project_point_onto_line(sec_endpoints, xy[0], xy[1])
                if proj is None or abs(proj.offset) > buf:
                    # Investigation is outside this section's corridor.
                    continue

                absent_along_m = proj.along

                try:
                    tip, created = await self._compute_and_insert_tip(
                        section=section,
                        sec_endpoints=sec_endpoints,
                        model_id=model_id,
                        formation_id=formation_id,
                        pinching_pts=pinching_pts,
                        target_pts=target_pts,
                        absent_along_m=absent_along_m,
                    )
                    if created:
                        new_contact_ids.extend(created)
                        total_new_created += len(created)
                        self.debug(
                            f"[{sec_idx}/{len(sections)}] "
                            f"wedge tip at along={tip.along_m:.2f} m "
                            f"elev={tip.elevation_m:.3f} m "
                            f"for inv={inv_id} ({abs_row.investigation_kind})"
                        )
                except (LensPinchGeometryError, ValueError) as exc:
                    total_skipped += 1
                    self.warning(
                        f"[{sec_idx}/{len(sections)}] "
                        f"wedge-tip geometry failed for abs inv={inv_id} "
                        f"along={absent_along_m:.2f} m: {exc}"
                    )

            # ---------------------------------------------------------------- #
            # 7e. Add new contact ids to seeded_formation_contact_ids.         #
            # ---------------------------------------------------------------- #
            if new_contact_ids:
                await self._add_to_seeded_ids(section=section, contact_ids=new_contact_ids)
                self.debug(
                    f"[{sec_idx}/{len(sections)}] "
                    f"seeded {len(new_contact_ids)} new wedge-tip contact(s)"
                )

        # ------------------------------------------------------------------ #
        # 8. Commit (when the caller delegates the transaction boundary).     #
        # ------------------------------------------------------------------ #
        if commit:
            await self._session.commit()

        self.success(
            f"MaterializeWedgeTipsForFormation done: "
            f"formation={formation_id} "
            f"sections_processed={len(sections)} "
            f"old_deleted={total_old_deleted} "
            f"new_created={total_new_created} "
            f"skipped_no_geometry={total_skipped}"
        )
        return WedgeTipMaterializationResult(
            sections_processed=len(sections),
            old_contacts_deleted=total_old_deleted,
            new_contacts_created=total_new_created,
            absences_skipped_no_geometry=total_skipped,
        )

    # ---------------------------------------------------------------------- #
    # Private helpers                                                         #
    # ---------------------------------------------------------------------- #

    async def _find_existing_synthetic_ids(
        self, *, model_id: UUID, formation_id: UUID
    ) -> list[UUID]:
        """Return ids of all existing synthetic contacts for (model, formation)."""
        rows = (
            (
                await self._session.execute(
                    select(FormationContactOrm.id).where(
                        FormationContactOrm.model_id == model_id,
                        FormationContactOrm.formation_id == formation_id,
                        FormationContactOrm.source == PINCH_OUT_SOURCE,
                        FormationContactOrm.borehole_id.is_(None),
                        FormationContactOrm.cpt_id.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        return list(rows)

    async def _remove_from_seeded_ids(
        self, *, section: CrossSectionOrm, contact_ids: list[UUID]
    ) -> None:
        """Remove ``contact_ids`` from ``section.seeded_formation_contact_ids``."""
        if not contact_ids:
            return
        id_set = set(contact_ids)
        current: list[UUID] = list(section.seeded_formation_contact_ids or [])
        updated = [cid for cid in current if cid not in id_set]
        section.seeded_formation_contact_ids = updated

    async def _add_to_seeded_ids(
        self, *, section: CrossSectionOrm, contact_ids: list[UUID]
    ) -> None:
        """Append ``contact_ids`` to ``section.seeded_formation_contact_ids`` (union semantics)."""
        if not contact_ids:
            return
        current_set: set[UUID] = set(section.seeded_formation_contact_ids or [])
        for cid in contact_ids:
            current_set.add(cid)
        section.seeded_formation_contact_ids = sorted(current_set)

    async def _compute_and_insert_tip(
        self,
        *,
        section: CrossSectionOrm,
        sec_endpoints: SectionEndpoints,
        model_id: UUID,
        formation_id: UUID,
        pinching_pts: list[tuple[float, float]],
        target_pts: list[tuple[float, float]],
        absent_along_m: float,
    ) -> tuple[LensPinchTip, list[UUID]]:
        """Compute the wedge tip and insert two synthetic contacts.

        Tries ``direction='right'`` first (present contacts to the left of
        the absent column), then ``direction='left'`` if the first attempt
        raises ``LensPinchGeometryError``.

        Parameters
        ----------
        section : CrossSectionOrm
            The section context.
        sec_endpoints : SectionEndpoints
            Pre-built endpoints dataclass for the section line.
        model_id : UUID
            Lithostratigraphic model id for the inserted contacts.
        formation_id : UUID
            Formation id for the inserted contacts.
        pinching_pts : list[tuple[float, float]]
            ``(along_m, elevation_m)`` points for the pinching formation,
            sorted ascending by ``along_m``.
        target_pts : list[tuple[float, float]]
            ``(along_m, elevation_m)`` points for the target (substrate)
            formation, sorted ascending by ``along_m``.
        absent_along_m : float
            Section position of the absent investigation.

        Returns
        -------
        tuple[LensPinchTip, list[UUID]]
            The computed tip and the ids of the two inserted synthetic
            contacts (tip + perpendicular twin).

        Raises
        ------
        LensPinchGeometryError
            When geometry fails for both directions.  The caller logs the
            error and increments ``absences_skipped_no_geometry``.
        """
        if not pinching_pts:
            raise LensPinchGeometryError(
                "No pinching contacts on this section — cannot compute wedge tip."
            )
        if len(target_pts) < 2:
            raise LensPinchGeometryError(
                "Fewer than 2 target contacts on this section — cannot interpolate "
                "the target surface."
            )

        # Try right first; fall back to left.
        last_exc: LensPinchGeometryError | None = None
        for direction in ("right", "left"):
            try:
                tip = compute_lens_pinch_tip(
                    pinching_polyline=pinching_pts,
                    target_polyline=target_pts,
                    absent_along_m=absent_along_m,
                    direction=direction,
                )
                break
            except LensPinchGeometryError as exc:
                last_exc = exc
                continue
        else:
            # Both directions failed.
            raise last_exc or LensPinchGeometryError("Wedge-tip geometry failed")

        # Convert (along_m, elevation_m) → world (x, y).
        tip_x, tip_y = project_along_to_world(
            section_start=(sec_endpoints.start_x, sec_endpoints.start_y),
            section_end=(sec_endpoints.end_x, sec_endpoints.end_y),
            along_m=tip.along_m,
        )

        # Perpendicular twin to break Delaunay collinearity (same rationale
        # as ExtrapolatePinchOut — see module docstring of extrapolate_pinch_out.py).
        dx = sec_endpoints.end_x - sec_endpoints.start_x
        dy = sec_endpoints.end_y - sec_endpoints.start_y
        sec_len = math.hypot(dx, dy)
        ux = dx / sec_len
        uy = dy / sec_len
        # Left-perpendicular unit vector (+90°: rotate (ux, uy) CCW).
        nx = -uy
        ny = ux
        twin_x = tip_x + _TWIN_OFFSET_M * nx
        twin_y = tip_y + _TWIN_OFFSET_M * ny

        _SYNTHETIC_DEPTH_SENTINEL = 0.0
        contact_tip = FormationContactOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=formation_id,
            borehole_id=None,
            cpt_id=None,
            synthetic_x=tip_x,
            synthetic_y=tip_y,
            synthetic_elevation_m=tip.elevation_m,
            depth_top_m=_SYNTHETIC_DEPTH_SENTINEL,
            source=PINCH_OUT_SOURCE,
            confidence=PINCH_OUT_CONFIDENCE,
        )
        contact_twin = FormationContactOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=formation_id,
            borehole_id=None,
            cpt_id=None,
            synthetic_x=twin_x,
            synthetic_y=twin_y,
            synthetic_elevation_m=tip.elevation_m,
            depth_top_m=_SYNTHETIC_DEPTH_SENTINEL,
            source=PINCH_OUT_SOURCE,
            confidence=PINCH_OUT_CONFIDENCE,
        )
        self._session.add(contact_tip)
        self._session.add(contact_twin)
        await self._session.flush()

        return tip, [contact_tip.id, contact_twin.id]
