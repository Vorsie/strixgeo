"""Use case — auto-create a perpendicular companion cross-section for a litho lens.

A lens is a 3D body; a single cross-section only constrains it in one
direction.  This use case generates a second section perpendicular to the
primary section, centred on the lens, and links it to the lens via
``cross_section.companion_body_id``.

Algorithm (Q3 directive from debt #101):

1. Load the lens and verify scope (project + model guards).
2. Idempotency guard — if the lens already owns a companion section, return
   the existing row rather than creating a duplicate.
3. Load the primary section from ``litho_lens.primary_section_id``.
4. Compute the centroid of the lens in world space:
   a. Collect all ``formation_contact`` rows for the formation's body.
   b. Centroid = mean of their world-x / world-y.  Anchored contacts use the
      investigation's (location_x, location_y); synthetics use synthetic_x/y.
   c. If no contacts are found (zero-contact lens), fall back to the midpoint
      of the primary section.
5. Perpendicular bearing: rotate the primary section's unit vector 90° CCW
   (i.e. ``(-dy, dx)``).
6. Determine the half-length in each direction by walking outward from the
   centroid along the perpendicular bearing and finding the nearest
   investigation within ``search_buffer_m`` of the perpendicular line.
   Fall back to ``max(2 × primary_buffer_m, 100 m)`` per side when no
   investigation is found on that side (Q3 rule).
7. Build start/end endpoints of the companion section.
8. Create the companion ``CrossSectionOrm`` row via
   ``CrossSectionRepository.create()``, setting ``companion_body_id`` and
   ``is_body_companion=True`` on the row AFTER flush.
9. Commit.  Return the new section.

Single-companion invariant: at most one perpendicular companion per lens.
The idempotency guard in step 2 enforces this without a DB unique constraint
(the guard is in the use-case layer because the one-companion rule is a
business rule, not a DB structural invariant — the same lens can logically
have multiple user-drawn sections but only one AUTO-companion).

Primary section choice: explicit ``primary_section_id`` on the ``body`` row
(set by ``NameBody`` when the body is named/anchored).  Design rationale: implicit
derivation from contact membership breaks when (a) the lens has zero present
contacts, (b) present contacts are re-seeded to a different section later,
or (c) the lens spans two sections after a workflow change.  Explicit FK
survives all three cases with one cheap lookup.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Distance along the perpendicular line within which an investigation is
# considered "reachable" from the companion section line.  Wide enough to
# cover a typical investigation cluster without pulling in distant outliers.
_SEARCH_BUFFER_M: float = 250.0

# Minimum half-length of the companion section per side when no investigation
# is found on that side (Q3 fallback rule from debt #101).
_MIN_FALLBACK_HALF_LENGTH_M: float = 100.0


@dataclass(frozen=True)
class CreatePerpendicularCompanionResult:
    """Return value of :meth:`CreatePerpendicularCompanion.execute`.

    Attributes
    ----------
    companion_section : CrossSectionOrm
        The newly-created (or pre-existing) companion section row.
    already_existed : bool
        ``True`` when the lens already had a companion section and the
        existing row was returned instead of creating a new one.
    """

    companion_section: CrossSectionOrm
    already_existed: bool


class CreatePerpendicularCompanion(GroundModelLogger):
    """Auto-create a perpendicular companion cross-section for a litho lens.

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
        body_id: UUID,
    ) -> CreatePerpendicularCompanionResult:
        """Run the perpendicular-companion creation pipeline.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Model scope guard.
        body_id : UUID
            The body to create a companion section for.
            Renamed from ``lens_id`` in Slice 3.3 (2026-06-01).

        Returns
        -------
        CreatePerpendicularCompanionResult
            The companion section (new or pre-existing) and an
            ``already_existed`` flag.

        Raises
        ------
        ValueError
            When the body is not found in the project/model scope, when
            ``primary_section_id`` is null on the body (body was created
            before Slice 4 and has no recorded primary section), or when
            the primary section is missing (deleted after body creation).
        """
        self.info(
            f"CreatePerpendicularCompanion.execute: "
            f"project={project_id} model={model_id} body={body_id}"
        )

        # ------------------------------------------------------------------
        # 1. Load and validate the body.
        # ------------------------------------------------------------------
        lens = await self._session.get(BodyOrm, body_id)
        if lens is None or lens.app_project_id != project_id or lens.model_id != model_id:
            raise ValueError(f"Body {body_id} not found in project {project_id}")

        # ------------------------------------------------------------------
        # 2. Model scope guard.
        # ------------------------------------------------------------------
        await load_scoped_or_raise(
            self._session,
            GeologicalModelOrm,
            model_id,
            project_id,
            label="Geological model",
        )

        # ------------------------------------------------------------------
        # 3. Idempotency guard — at most one companion per body.
        # ------------------------------------------------------------------
        existing_companion_stmt = (
            select(CrossSectionOrm).where(CrossSectionOrm.companion_body_id == body_id).limit(1)
        )
        existing_companion = (
            await self._session.execute(existing_companion_stmt)
        ).scalar_one_or_none()
        if existing_companion is not None:
            self.info(
                f"Body {body_id} already has companion section "
                f"{existing_companion.id} — returning existing"
            )
            return CreatePerpendicularCompanionResult(
                companion_section=existing_companion,
                already_existed=True,
            )

        # ------------------------------------------------------------------
        # 4. Load the primary section.
        # ------------------------------------------------------------------
        if lens.primary_section_id is None:
            raise ValueError(
                f"Body {body_id} has no primary_section_id — it was created "
                "before Slice 4 (perpendicular-companion support). Re-create the body "
                "to record the primary section."
            )
        primary_section = await self._session.get(CrossSectionOrm, lens.primary_section_id)
        if primary_section is None:
            raise ValueError(
                f"Primary section {lens.primary_section_id} for body {body_id} "
                "no longer exists — it was deleted after the body was created."
            )

        # ------------------------------------------------------------------
        # 5. Compute the lens centroid.
        # ------------------------------------------------------------------
        cx, cy = await self._compute_lens_centroid(
            model_id=model_id,
            formation_id=lens.formation_id,
            primary_section=primary_section,
        )
        self.debug(f"Lens centroid: ({cx:.1f}, {cy:.1f})")

        # ------------------------------------------------------------------
        # 6. Perpendicular unit vector (rotate primary direction 90° CCW).
        # ------------------------------------------------------------------
        pdx = primary_section.end_x - primary_section.start_x
        pdy = primary_section.end_y - primary_section.start_y
        primary_len = math.hypot(pdx, pdy)
        # Perpendicular unit vector (CCW rotation of (pdx/L, pdy/L)).
        perp_ux = -pdy / primary_len
        perp_uy = pdx / primary_len

        # ------------------------------------------------------------------
        # 7. Determine half-lengths by finding nearest investigations.
        # ------------------------------------------------------------------
        fallback_half = max(2.0 * primary_section.projection_buffer_m, _MIN_FALLBACK_HALF_LENGTH_M)
        half_pos, half_neg = await self._find_half_lengths(
            project_id=project_id,
            cx=cx,
            cy=cy,
            perp_ux=perp_ux,
            perp_uy=perp_uy,
            fallback_half=fallback_half,
        )
        self.debug(f"Companion half-lengths: positive={half_pos:.1f} m, negative={half_neg:.1f} m")

        # ------------------------------------------------------------------
        # 8. Build companion section endpoints.
        # ------------------------------------------------------------------
        start_x = cx + perp_ux * (-half_neg)
        start_y = cy + perp_uy * (-half_neg)
        end_x = cx + perp_ux * half_pos
        end_y = cy + perp_uy * half_pos

        lens_name = lens.name or f"Body {str(body_id)[:8]}"
        companion_name = f"Companion of: {lens_name}"

        # ------------------------------------------------------------------
        # 9. Create the companion section.
        # ------------------------------------------------------------------
        repo = CrossSectionRepository(self._session)
        companion = await repo.create(
            project_id,
            name=companion_name,
            start_x=start_x,
            start_y=start_y,
            end_x=end_x,
            end_y=end_y,
            epsg=primary_section.epsg,
            projection_buffer_m=primary_section.projection_buffer_m,
        )

        # Tag as companion — must set after flush gives us the row.
        companion.companion_body_id = body_id
        companion.is_body_companion = True
        await self._session.flush()
        # A companion is a section like any other: it can draw tests no section
        # drew before, and only tests a section draws feed the model (owner
        # ruling 2026-09-23).
        await GeologyRepository(self._session).mark_project_surfaces_stale(
            project_id, reason=f"companion section created: {companion_name}"
        )
        await self._session.commit()
        await self._session.refresh(companion)

        self.success(
            f"CreatePerpendicularCompanion done: companion={companion.id} "
            f"for body={body_id} "
            f"start=({start_x:.1f}, {start_y:.1f}) "
            f"end=({end_x:.1f}, {end_y:.1f})"
        )
        return CreatePerpendicularCompanionResult(
            companion_section=companion,
            already_existed=False,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _compute_lens_centroid(
        self,
        *,
        model_id: UUID,
        formation_id: UUID,
        primary_section: CrossSectionOrm,
    ) -> tuple[float, float]:
        """Compute the world-space centroid of all contacts for the formation body.

        Position 4: body identity is ``(model_id, formation_id)``; there is no
        ``body_id`` column on contacts.  Anchored contacts use the
        investigation's ``(location_x, location_y)``; synthetics use
        ``(synthetic_x, synthetic_y)``.  Falls back to the midpoint of the
        primary section when no contacts are found.

        Parameters
        ----------
        model_id : UUID
            The lithostratigraphic model that owns the contacts.
        formation_id : UUID
            The formation whose contacts define the body extent.
        primary_section : CrossSectionOrm
            Used as fallback when the body has no contacts.

        Returns
        -------
        tuple[float, float]
            ``(centroid_x, centroid_y)`` in the section's CRS.
        """
        # Collect all contacts for this (model, formation).
        stmt = select(
            FormationContactOrm.borehole_id,
            FormationContactOrm.cpt_id,
            FormationContactOrm.synthetic_x,
            FormationContactOrm.synthetic_y,
        ).where(
            FormationContactOrm.model_id == model_id,
            FormationContactOrm.formation_id == formation_id,
        )
        contact_rows = (await self._session.execute(stmt)).all()

        if not contact_rows:
            # Zero-contact body — fall back to primary section midpoint.
            self.warning(
                f"Formation {formation_id} has no contacts in model {model_id} — "
                "using primary section midpoint as centroid fallback"
            )
            return (
                (primary_section.start_x + primary_section.end_x) / 2.0,
                (primary_section.start_y + primary_section.end_y) / 2.0,
            )

        # Resolve anchored contact positions.
        borehole_ids = [r.borehole_id for r in contact_rows if r.borehole_id is not None]
        cpt_ids = [r.cpt_id for r in contact_rows if r.cpt_id is not None]

        borehole_xy: dict[UUID, tuple[float, float]] = {}
        if borehole_ids:
            bh_rows = (
                await self._session.execute(
                    select(BoreholeOrm.id, BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                        BoreholeOrm.id.in_(borehole_ids)
                    )
                )
            ).all()
            borehole_xy = {r.id: (r.location_x, r.location_y) for r in bh_rows}

        cpt_xy: dict[UUID, tuple[float, float]] = {}
        if cpt_ids:
            cpt_rows = (
                await self._session.execute(
                    select(CptOrm.id, CptOrm.location_x, CptOrm.location_y).where(
                        CptOrm.id.in_(cpt_ids)
                    )
                )
            ).all()
            cpt_xy = {r.id: (r.location_x, r.location_y) for r in cpt_rows}

        xs: list[float] = []
        ys: list[float] = []
        for row in contact_rows:
            if row.synthetic_x is not None and row.synthetic_y is not None:
                xs.append(row.synthetic_x)
                ys.append(row.synthetic_y)
            elif row.borehole_id is not None and row.borehole_id in borehole_xy:
                xs.append(borehole_xy[row.borehole_id][0])
                ys.append(borehole_xy[row.borehole_id][1])
            elif row.cpt_id is not None and row.cpt_id in cpt_xy:
                xs.append(cpt_xy[row.cpt_id][0])
                ys.append(cpt_xy[row.cpt_id][1])

        if not xs:
            # All contacts unresolved (e.g. referenced investigations deleted).
            return (
                (primary_section.start_x + primary_section.end_x) / 2.0,
                (primary_section.start_y + primary_section.end_y) / 2.0,
            )

        return (sum(xs) / len(xs), sum(ys) / len(ys))

    async def _find_half_lengths(
        self,
        *,
        project_id: UUID,
        cx: float,
        cy: float,
        perp_ux: float,
        perp_uy: float,
        fallback_half: float,
    ) -> tuple[float, float]:
        """Walk outward from the centroid and find the nearest investigations.

        Scans all investigations in the project; for each one computes its
        signed projection onto the perpendicular vector and its perpendicular
        distance from the companion line.  Investigations within
        ``_SEARCH_BUFFER_M`` of the companion line that fall on the positive
        side contribute to ``half_pos``; those on the negative side contribute
        to ``half_neg``.  Falls back to ``fallback_half`` per side when nothing
        is found.

        Parameters
        ----------
        project_id : UUID
        cx, cy : float
            Centroid world coordinates.
        perp_ux, perp_uy : float
            Perpendicular unit vector from the centroid.
        fallback_half : float
            Half-length to use per side when no investigation is found.

        Returns
        -------
        tuple[float, float]
            ``(half_pos, half_neg)`` in metres.
        """
        # Load all investigations (borehole + CPT) in the project.
        bh_rows = (
            await self._session.execute(
                select(BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all()
        cpt_rows = (
            await self._session.execute(
                select(CptOrm.location_x, CptOrm.location_y).where(
                    CptOrm.app_project_id == project_id
                )
            )
        ).all()

        all_xy: list[tuple[float, float]] = [
            (r.location_x, r.location_y) for r in (*bh_rows, *cpt_rows)
        ]
        self.debug(f"Scanning {len(all_xy)} investigations for companion half-lengths")

        # Perpendicular direction (normal to the companion line).
        # For a line direction (perp_ux, perp_uy), the normal is (-perp_uy, perp_ux).
        normal_ux = -perp_uy
        normal_uy = perp_ux

        nearest_pos: float | None = None
        nearest_neg: float | None = None

        for ix, iy in all_xy:
            rel_x = ix - cx
            rel_y = iy - cy

            # Signed projection onto the companion-line direction.
            along = rel_x * perp_ux + rel_y * perp_uy
            # Signed distance perpendicular to the companion line.
            lateral = abs(rel_x * normal_ux + rel_y * normal_uy)

            if lateral > _SEARCH_BUFFER_M:
                continue  # outside the search corridor

            if along > 0:
                if nearest_pos is None or along < nearest_pos:
                    nearest_pos = along
            elif along < 0:
                dist = -along  # positive magnitude
                if nearest_neg is None or dist < nearest_neg:
                    nearest_neg = dist

        half_pos = nearest_pos if nearest_pos is not None else fallback_half
        half_neg = nearest_neg if nearest_neg is not None else fallback_half

        self.debug(
            f"Half-lengths resolved: pos={half_pos:.1f} m (fallback={nearest_pos is None}), "
            f"neg={half_neg:.1f} m (fallback={nearest_neg is None})"
        )
        return half_pos, half_neg
