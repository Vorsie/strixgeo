"""Use case — create a litho lens entity with section-local wedge-tip geometry.

Atomically:
1. Inserts a ``litho_lens`` row.
2. Records one ``litho_lens_absence`` row per absent investigation.
3. Tags every ``present_contact_id`` with ``lens_id``.
4. For each absent column, projects its (x, y) onto the section line
   to get ``absent_along_m``, then calls ``compute_lens_pinch_tip``
   once per side (bracketed = two calls; edge = one call) to get the
   wedge-tip position in section-2D.
5. Commits one synthetic ``FormationContact`` per tip with non-null
   ``synthetic_x/y/elevation_m`` + ``lens_id``.
6. Unions all new synthetic contact ids into the section's
   ``seeded_formation_contact_ids`` (explicit-content invariant).
7. Commits the full transaction — nothing is written on any exception.

Pre-build pinch-outs: section-local math at mark-time (owner directive
2026-05-24).  No TIN is required; all geometry derives from contacts
already projected onto the section line.  See docs/debt.md #101.

One synthetic per absent-column side (NOT two like ``ExtrapolatePinchOut``).
The Delaunay-collinearity twin is the existing tool's responsibility;
the lens path ships ONE synthetic per side and documents that the twin
emission stays Phase 5.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.create_litho_lens_constants import (
    LENS_PINCH_OUT_CONFIDENCE,
    LENS_PINCH_OUT_SOURCE,
    LENS_SYNTHETIC_DEPTH_SENTINEL,
)
from groundmodel.domain.services.lens_pinch_out_geometry import (
    LensPinchGeometryError,
    LensPinchTip,
    compute_lens_pinch_tip,
    project_along_to_world,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_absence_orm import LithoLensAbsenceOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class CreateLithoLensResult:
    """Return value of :meth:`CreateLithoLens.execute`.

    Attributes
    ----------
    lens_id : UUID
        The newly-created :class:`LithoLensOrm` id.
    synthetic_contact_ids : list[UUID]
        :class:`FormationContactOrm` rows committed as wedge-tip synthetic
        contacts.
    skipped_absent_count : int
        Number of absent investigations for which no wedge-tip geometry
        could be computed on ANY side.  Non-zero signals the lens body is
        under-constrained; the user should add a present contact closer to
        the absent column.
    updated_section : CrossSectionOrm
        The section row after all new synthetic contact ids were unioned
        into ``seeded_formation_contact_ids``.
    """

    lens_id: UUID
    synthetic_contact_ids: list[UUID]
    skipped_absent_count: int
    updated_section: CrossSectionOrm


class CreateLithoLens(GroundModelLogger):
    """Create a litho lens entity with section-local wedge-tip synthetic contacts.

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
        parent_formation_id: UUID,
        section_id: UUID,
        name: str | None,
        present_contact_ids: list[UUID],
        absent_investigations: list[tuple[Literal["borehole", "cpt"], UUID]],
    ) -> CreateLithoLensResult:
        """Run the full lens-creation pipeline.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — all resources must belong to this project.
        model_id : UUID
            Lithostratigraphic model.  Must have ``kind='lithostratigraphic'``
            (enforced by the router before calling this use case).
        parent_formation_id : UUID
            The formation the lens carves a body out of.  Must belong to
            ``model_id`` (validated here — 422 propagated as ValueError).
        section_id : UUID
            Cross-section used for wedge-tip geometry + section seeding.
        name : str | None
            Optional human label for the lens.
        present_contact_ids : list[UUID]
            Existing :class:`FormationContact` ids to tag with ``lens_id``.
            All must belong to ``parent_formation_id`` in ``model_id``.
        absent_investigations : list[tuple[Literal["borehole", "cpt"], UUID]]
            ``(kind, investigation_id)`` pairs for each absent column.

        Returns
        -------
        CreateLithoLensResult
            Lens id, synthetic contact ids, skip count, updated section.

        Raises
        ------
        ValueError
            On any scope-guard failure (model/formation/contact not in
            project, investigation not in project) or when ALL absent
            columns fail geometry and there are absent columns to process.
        LensPinchGeometryError
            Propagated as ``ValueError`` in the router when geometry is
            uncomputable for every absent column simultaneously.  Individual
            column failures are logged and skipped (skipped_absent_count
            is incremented); the error is raised only when ALL fail.
        """
        self.info(
            f"CreateLithoLens.execute: project={project_id} model={model_id} "
            f"formation={parent_formation_id} section={section_id} "
            f"name={name!r} present_contacts={len(present_contact_ids)} "
            f"absent_investigations={len(absent_investigations)}"
        )

        # ------------------------------------------------------------------
        # 1. Load and validate the model.
        # ------------------------------------------------------------------
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        # ------------------------------------------------------------------
        # 2. Validate the parent formation belongs to this model.
        # ------------------------------------------------------------------
        formation = await self._session.get(GeologicalFormationOrm, parent_formation_id)
        if formation is None or formation.app_project_id != project_id:
            raise ValueError(f"Formation {parent_formation_id} not found in project {project_id}")
        # Verify the formation has at least one contact in this model.
        # This implicitly confirms it belongs to the model without a
        # dedicated model_id column on geological_formation.
        formation_contact_check = (
            await self._session.execute(
                select(FormationContactOrm.id)
                .where(
                    FormationContactOrm.model_id == model_id,
                    FormationContactOrm.formation_id == parent_formation_id,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if formation_contact_check is None:
            raise ValueError(
                f"Formation {parent_formation_id} has no contacts in model {model_id}. "
                "The formation must have at least one contact in the model before "
                "it can be the parent of a lens."
            )

        # ------------------------------------------------------------------
        # 3. Load and validate the section.
        # ------------------------------------------------------------------
        section = await self._session.get(CrossSectionOrm, section_id)
        if section is None or section.app_project_id != project_id:
            raise ValueError(f"Cross-section {section_id} not found in project {project_id}")
        self.debug(
            f"Section line: start=({section.start_x:.1f}, {section.start_y:.1f}) "
            f"end=({section.end_x:.1f}, {section.end_y:.1f})"
        )

        # ------------------------------------------------------------------
        # 4. Validate all present_contact_ids belong to parent_formation_id
        #    in this model.
        # ------------------------------------------------------------------
        if present_contact_ids:
            await self._validate_present_contacts(
                model_id=model_id,
                parent_formation_id=parent_formation_id,
                contact_ids=present_contact_ids,
            )

        # ------------------------------------------------------------------
        # 5. Validate all absent investigation ids exist in the project.
        # ------------------------------------------------------------------
        absent_xyz: dict[UUID, tuple[float, float]] = {}
        for idx, (kind, inv_id) in enumerate(absent_investigations):
            x, y = await self._load_investigation_xy(
                project_id=project_id, kind=kind, investigation_id=inv_id
            )
            absent_xyz[inv_id] = (x, y)
            self.debug(
                f"[{idx + 1}/{len(absent_investigations)}] absent {kind}={inv_id} "
                f"at ({x:.1f}, {y:.1f})"
            )

        # ------------------------------------------------------------------
        # 6. Create the litho_lens row.
        # ------------------------------------------------------------------
        lens_id = uuid7()
        lens = LithoLensOrm(
            id=lens_id,
            app_project_id=project_id,
            model_id=model_id,
            parent_formation_id=parent_formation_id,
            name=name,
            # Record the primary section so CreatePerpendicularCompanion can
            # retrieve it without deriving it from contact membership.
            primary_section_id=section_id,
        )
        self._session.add(lens)
        await self._session.flush()
        self.debug(f"LithoLens row flushed: id={lens_id}")

        # ------------------------------------------------------------------
        # 7. Record absence rows.
        # ------------------------------------------------------------------
        for kind, inv_id in absent_investigations:
            absence = LithoLensAbsenceOrm(
                id=uuid7(),
                lens_id=lens_id,
                investigation_id=inv_id,
                investigation_kind=kind,
            )
            self._session.add(absence)
        if absent_investigations:
            await self._session.flush()
            self.debug(f"Flushed {len(absent_investigations)} absence row(s)")

        # ------------------------------------------------------------------
        # 8. Tag present contacts with lens_id.
        # ------------------------------------------------------------------
        if present_contact_ids:
            await self._session.execute(
                update(FormationContactOrm)
                .where(FormationContactOrm.id.in_(present_contact_ids))
                .values(lens_id=lens_id)
            )
            await self._session.flush()
            self.debug(
                f"Tagged {len(present_contact_ids)} present contact(s) with lens_id={lens_id}"
            )

        # ------------------------------------------------------------------
        # 9. For each absent column: compute wedge-tip(s) and commit synthetics.
        # ------------------------------------------------------------------
        synthetic_contact_ids: list[UUID] = []
        skipped_absent_count = 0

        if absent_investigations:
            # Load the formation's contacts on this section as the "pinching polyline".
            pinching_pts = await self._load_formation_contacts_on_section(
                model_id=model_id,
                formation_id=parent_formation_id,
                section=section,
            )
            self.debug(f"Pinching polyline: {len(pinching_pts)} contacts on section {section_id}")

            # Load the target lithology's contacts (the next-older formation
            # by display_order that has contacts on this section).
            target_pts = await self._load_target_contacts_on_section(
                project_id=project_id,
                model_id=model_id,
                formation=formation,
                section=section,
            )
            self.debug(f"Target polyline: {len(target_pts)} contacts on section {section_id}")

            # Compute the section-line unit vector once (reused across absent columns).
            dx = section.end_x - section.start_x
            dy = section.end_y - section.start_y
            section_length = math.hypot(dx, dy)

            for idx, (kind, inv_id) in enumerate(absent_investigations):
                inv_x, inv_y = absent_xyz[inv_id]
                absent_along_m = self._project_to_along(inv_x, inv_y, section, section_length)
                self.debug(
                    f"[{idx + 1}/{len(absent_investigations)}] "
                    f"{kind}={inv_id} along_m={absent_along_m:.2f}"
                )

                new_ids = await self._commit_wedge_tips_for_absent(
                    model_id=model_id,
                    formation_id=parent_formation_id,
                    lens_id=lens_id,
                    pinching_pts=pinching_pts,
                    target_pts=target_pts,
                    absent_along_m=absent_along_m,
                    section=section,
                    absent_index=idx,
                    absent_total=len(absent_investigations),
                )
                if new_ids:
                    synthetic_contact_ids.extend(new_ids)
                else:
                    skipped_absent_count += 1

        # ------------------------------------------------------------------
        # 10. Patch seeded_formation_contact_ids BEFORE the single commit
        #     (explicit-content invariant).
        #
        # Merging the section patch into the same transaction ensures atomicity:
        # if the commit fails, neither the lens row nor the section's id set is
        # persisted.  A second commit (the previous "step 11") created a window
        # where the lens existed in the DB but the section renderer could not see
        # its synthetic contacts — violation of the explicit-content invariant.
        # See reviewer blocker 2, 2026-05-24.
        # ------------------------------------------------------------------
        all_seed_ids: set[UUID] = set(synthetic_contact_ids) | set(present_contact_ids)
        if all_seed_ids:
            existing_seeded = frozenset(section.seeded_formation_contact_ids or [])
            merged = list(existing_seeded | all_seed_ids)
            section.seeded_formation_contact_ids = merged
            self.info(
                f"Staging section {section_id} seed patch: {len(merged)} total ids "
                f"({len(all_seed_ids)} added this call)"
            )

        # ------------------------------------------------------------------
        # 11. Single commit — lens + absences + tagged contacts + synthetics
        #     + section seeded_formation_contact_ids all land atomically.
        # ------------------------------------------------------------------
        await self._session.commit()
        await self._session.refresh(section)

        self.success(
            f"CreateLithoLens done: lens={lens_id} "
            f"synthetic_contacts={len(synthetic_contact_ids)} "
            f"skipped_absent={skipped_absent_count}"
        )
        return CreateLithoLensResult(
            lens_id=lens_id,
            synthetic_contact_ids=synthetic_contact_ids,
            skipped_absent_count=skipped_absent_count,
            updated_section=section,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _validate_present_contacts(
        self,
        *,
        model_id: UUID,
        parent_formation_id: UUID,
        contact_ids: list[UUID],
    ) -> None:
        """Verify all ``contact_ids`` belong to ``parent_formation_id`` in ``model_id``.

        Parameters
        ----------
        model_id : UUID
        parent_formation_id : UUID
        contact_ids : list[UUID]

        Raises
        ------
        ValueError
            When any id is not found on the (model, formation) pair.
        """
        found_ids = set(
            (
                await self._session.execute(
                    select(FormationContactOrm.id).where(
                        FormationContactOrm.id.in_(contact_ids),
                        FormationContactOrm.model_id == model_id,
                        FormationContactOrm.formation_id == parent_formation_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        missing = set(contact_ids) - found_ids
        if missing:
            raise ValueError(
                f"{len(missing)} present_contact_id(s) do not belong to formation "
                f"{parent_formation_id} in model {model_id}: {missing}"
            )

    async def _load_investigation_xy(
        self,
        *,
        project_id: UUID,
        kind: Literal["borehole", "cpt"],
        investigation_id: UUID,
    ) -> tuple[float, float]:
        """Load (x, y) for an investigation, project-scoped.

        Parameters
        ----------
        project_id : UUID
        kind : Literal["borehole", "cpt"]
        investigation_id : UUID

        Returns
        -------
        tuple[float, float]
            ``(location_x, location_y)`` in the project CRS.

        Raises
        ------
        ValueError
            When the investigation does not exist or is in a different project.
        """
        if kind == "cpt":
            row = await self._session.get(CptOrm, investigation_id)
            if row is None or row.app_project_id != project_id:
                raise ValueError(f"CPT {investigation_id} not found in project {project_id}")
            return row.location_x, row.location_y
        else:
            row = await self._session.get(BoreholeOrm, investigation_id)
            if row is None or row.app_project_id != project_id:
                raise ValueError(f"Borehole {investigation_id} not found in project {project_id}")
            return row.location_x, row.location_y

    async def _load_formation_contacts_on_section(
        self,
        *,
        model_id: UUID,
        formation_id: UUID,
        section: CrossSectionOrm,
    ) -> list[tuple[float, float]]:
        """Load contacts for ``formation_id`` in ``model_id`` that lie in
        the section's corridor, project each to (along_m, elevation_m).

        Returns
        -------
        list[tuple[float, float]]
            Sorted ascending by ``along_m``.  Synthetic contacts (lens tips
            already committed for this formation) are included — they
            contribute the geometry the user has already confirmed.
        """
        stmt = select(
            FormationContactOrm.borehole_id,
            FormationContactOrm.cpt_id,
            FormationContactOrm.synthetic_x,
            FormationContactOrm.synthetic_y,
            FormationContactOrm.synthetic_elevation_m,
            FormationContactOrm.depth_top_m,
        ).where(
            FormationContactOrm.model_id == model_id,
            FormationContactOrm.formation_id == formation_id,
        )
        rows = (await self._session.execute(stmt)).all()

        # For each anchored contact we need the investigation's (x, y)
        # and elevation to compute the contact's world position.
        borehole_ids = [r.borehole_id for r in rows if r.borehole_id is not None]
        cpt_ids = [r.cpt_id for r in rows if r.cpt_id is not None]

        borehole_map: dict[UUID, tuple[float, float, float | None]] = {}
        if borehole_ids:
            bh_rows = (
                await self._session.execute(
                    select(
                        BoreholeOrm.id,
                        BoreholeOrm.location_x,
                        BoreholeOrm.location_y,
                        BoreholeOrm.elevation_m,
                    ).where(BoreholeOrm.id.in_(borehole_ids))
                )
            ).all()
            borehole_map = {r.id: (r.location_x, r.location_y, r.elevation_m) for r in bh_rows}

        cpt_map: dict[UUID, tuple[float, float, float | None]] = {}
        if cpt_ids:
            cpt_rows = (
                await self._session.execute(
                    select(
                        CptOrm.id,
                        CptOrm.location_x,
                        CptOrm.location_y,
                        CptOrm.elevation_m,
                    ).where(CptOrm.id.in_(cpt_ids))
                )
            ).all()
            cpt_map = {r.id: (r.location_x, r.location_y, r.elevation_m) for r in cpt_rows}

        dx = section.end_x - section.start_x
        dy = section.end_y - section.start_y
        section_length = math.hypot(dx, dy)

        result: list[tuple[float, float]] = []
        for row in rows:
            if row.synthetic_x is not None:
                # Synthetic contact: apply the same corridor perp-distance guard
                # as anchored contacts.  Without this, synthetic tips created on
                # a DIFFERENT section (with a different orientation) leak into
                # this section's pinching polyline → wrong wedge-tip geometry.
                # See reviewer should-fix SF4, 2026-05-24.
                perp = abs(
                    (row.synthetic_x - section.start_x) * (-dy / section_length)
                    + (row.synthetic_y - section.start_y) * (dx / section_length)
                )
                if perp > section.projection_buffer_m:
                    continue
                along_m = self._project_to_along(
                    row.synthetic_x, row.synthetic_y, section, section_length
                )
                elev_m = row.synthetic_elevation_m
                result.append((along_m, elev_m))
            elif row.borehole_id is not None:
                xyz = borehole_map.get(row.borehole_id)
                if xyz is None or xyz[2] is None:
                    continue  # no elevation → skip
                inv_x, inv_y, inv_elev = xyz
                # Check corridor membership.
                perp = abs(
                    (inv_x - section.start_x) * (-dy / section_length)
                    + (inv_y - section.start_y) * (dx / section_length)
                )
                if perp > section.projection_buffer_m:
                    continue
                along_m = self._project_to_along(inv_x, inv_y, section, section_length)
                elev_m = inv_elev - row.depth_top_m
                result.append((along_m, elev_m))
            elif row.cpt_id is not None:
                xyz = cpt_map.get(row.cpt_id)
                if xyz is None or xyz[2] is None:
                    continue
                inv_x, inv_y, inv_elev = xyz
                perp = abs(
                    (inv_x - section.start_x) * (-dy / section_length)
                    + (inv_y - section.start_y) * (dx / section_length)
                )
                if perp > section.projection_buffer_m:
                    continue
                along_m = self._project_to_along(inv_x, inv_y, section, section_length)
                elev_m = inv_elev - row.depth_top_m
                result.append((along_m, elev_m))

        return sorted(result, key=lambda p: p[0])

    async def _load_target_contacts_on_section(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        formation: GeologicalFormationOrm,
        section: CrossSectionOrm,
    ) -> list[tuple[float, float]]:
        """Find the next-older formation by ``display_order`` and load its contacts.

        The target formation is the one with the LOWEST ``display_order``
        GREATER THAN ``formation.display_order`` that has contacts in the
        corridor (older = higher display_order in the geological ordering
        where lower = younger, per CLAUDE.md "Stratigraphic order").

        Wait — CLAUDE.md states: *lower display_order = older formation*.
        So the "next-older" neighbour is the one with the highest
        ``display_order`` LESS THAN ``formation.display_order``.

        Concretely: for a formation at ``display_order=5``, the next-older
        neighbour is the formation with the largest ``display_order`` that
        is still ``< 5``.

        If no such formation exists, returns an empty list (caller skips
        geometry for all absent columns).

        Parameters
        ----------
        project_id : UUID
        model_id : UUID
        formation : GeologicalFormationOrm
            The pinching formation.
        section : CrossSectionOrm

        Returns
        -------
        list[tuple[float, float]]
            ``(along_m, elevation_m)`` sorted ascending by ``along_m``.
        """
        # Load the next-older formation by display_order, scoped to the lens's
        # model_id via an EXISTS subquery on FormationContactOrm.
        #
        # WHY: a project with sibling models (geological + lithostratigraphic +
        # geotechnical) has formations from ALL models in the same
        # geological_formation table.  Filtering only by app_project_id would
        # return a formation from the geological model as the "next-older
        # neighbour" even though the lens use case operates on the litho model —
        # the wedge-tip geometry would then compute against the wrong polyline.
        # See reviewer blocker 3, 2026-05-24.
        contact_in_model = (
            select(FormationContactOrm.id)
            .where(
                FormationContactOrm.formation_id == GeologicalFormationOrm.id,
                FormationContactOrm.model_id == model_id,
            )
            .exists()
        )
        stmt = (
            select(GeologicalFormationOrm)
            .where(
                GeologicalFormationOrm.app_project_id == project_id,
                GeologicalFormationOrm.display_order < formation.display_order,
                contact_in_model,
            )
            .order_by(GeologicalFormationOrm.display_order.desc())
            .limit(1)
        )
        target_formation = (await self._session.execute(stmt)).scalar_one_or_none()

        if target_formation is None:
            self.warning(
                f"No older formation found for {formation.id} "
                f"(display_order={formation.display_order}) — "
                "target polyline will be empty; wedge-tip geometry will fail for all "
                "absent columns"
            )
            return []

        self.debug(
            f"Target formation: {target_formation.id} name={target_formation.name!r} "
            f"display_order={target_formation.display_order}"
        )
        return await self._load_formation_contacts_on_section(
            model_id=model_id,
            formation_id=target_formation.id,
            section=section,
        )

    @staticmethod
    def _project_to_along(
        x: float,
        y: float,
        section: CrossSectionOrm,
        section_length: float,
    ) -> float:
        """Compute the scalar along-section distance for world point (x, y).

        Parameters
        ----------
        x, y : float
            World coordinates in the section's CRS.
        section : CrossSectionOrm
            Section row (provides start_x, start_y, end_x, end_y).
        section_length : float
            Pre-computed ``hypot(end_x - start_x, end_y - start_y)``
            (avoids redundant square-root calls in the main loop).

        Returns
        -------
        float
            Scalar distance from section start along the line (metres).
            May be negative (before start) or > section_length (after end).
        """
        dx = section.end_x - section.start_x
        dy = section.end_y - section.start_y
        rel_x = x - section.start_x
        rel_y = y - section.start_y
        # Dot product with the unit direction vector.
        return (rel_x * dx + rel_y * dy) / section_length

    async def _commit_wedge_tips_for_absent(
        self,
        *,
        model_id: UUID,
        formation_id: UUID,
        lens_id: UUID,
        pinching_pts: list[tuple[float, float]],
        target_pts: list[tuple[float, float]],
        absent_along_m: float,
        section: CrossSectionOrm,
        absent_index: int,
        absent_total: int,
    ) -> list[UUID]:
        """Compute and commit wedge-tip synthetic contacts for one absent column.

        Determines whether the absent column is bracketed (present contacts
        on BOTH sides → two tip calls) or at the corridor edge (contacts on
        ONE side → one tip call).  Logs and skips individual direction
        failures without aborting the whole lens creation.

        Parameters
        ----------
        model_id : UUID
        formation_id : UUID
        lens_id : UUID
        pinching_pts : list[tuple[float, float]]
            Present-column contacts for the pinching formation projected onto
            the section as ``(along_m, elevation_m)``, sorted ascending.
        target_pts : list[tuple[float, float]]
            Present-column contacts for the target (next-older) formation,
            same projection.
        absent_along_m : float
            Along-section position of the absent investigation.
        section : CrossSectionOrm
            Section row used to back-project along → world (x, y).
        absent_index : int
            0-based index within the absent-investigations list (for logging).
        absent_total : int
            Total number of absent investigations (for ``[i/total]`` prefix).

        Returns
        -------
        list[UUID]
            Contact ids for all successfully committed synthetic contacts.
            Empty list when no direction produces a valid tip.
        """
        prefix = f"[{absent_index + 1}/{absent_total}]"
        committed_ids: list[UUID] = []

        # Determine which sides have pinching contacts.
        has_left = any(p[0] < absent_along_m for p in pinching_pts)
        has_right = any(p[0] > absent_along_m for p in pinching_pts)

        directions: list[Literal["left", "right"]] = []
        if has_right:
            # Contacts on the RIGHT → wedge approaches from the right ('left').
            directions.append("left")
        if has_left:
            # Contacts on the LEFT → wedge approaches from the left ('right').
            directions.append("right")

        if not directions:
            self.warning(
                f"{prefix} No pinching contacts on either side of "
                f"absent_along_m={absent_along_m:.2f} m — skipping wedge-tip geometry"
            )
            return []

        for direction in directions:
            try:
                tip: LensPinchTip = compute_lens_pinch_tip(
                    pinching_polyline=pinching_pts,
                    target_polyline=target_pts,
                    absent_along_m=absent_along_m,
                    direction=direction,
                )
            except LensPinchGeometryError as exc:
                self.warning(
                    f"{prefix} direction={direction!r}: geometry failed — {exc}. "
                    "Skipping this direction."
                )
                continue

            # Back-project along_m → world (x, y).
            wx, wy = project_along_to_world(
                (section.start_x, section.start_y),
                (section.end_x, section.end_y),
                tip.along_m,
            )
            self.debug(
                f"{prefix} direction={direction!r} tip: along={tip.along_m:.2f} m "
                f"elev={tip.elevation_m:.3f} m → world=({wx:.1f}, {wy:.1f})"
            )

            contact = FormationContactOrm(
                id=uuid7(),
                model_id=model_id,
                formation_id=formation_id,
                borehole_id=None,
                cpt_id=None,
                synthetic_x=wx,
                synthetic_y=wy,
                synthetic_elevation_m=tip.elevation_m,
                depth_top_m=LENS_SYNTHETIC_DEPTH_SENTINEL,
                source=LENS_PINCH_OUT_SOURCE,
                confidence=LENS_PINCH_OUT_CONFIDENCE,
                lens_id=lens_id,
            )
            self._session.add(contact)
            await self._session.flush()
            committed_ids.append(contact.id)
            self.debug(f"{prefix} Synthetic contact flushed: {contact.id}")

        return committed_ids
