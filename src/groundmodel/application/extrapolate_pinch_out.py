"""Use case — extrapolate a formation pinch-out to a synthetic tip contact.

When a formation pinches out laterally (the engineer's field jargon: it
"wigs out"), this use case computes the location where the formation's
thickness shrinks to zero against the next-deeper formation, then commits
two synthetic FormationContact rows so the 3D TIN / DXF / Plaxis / .gmproj
all wedge consistently.

WHY two contacts: ``compute_tin`` uses SciPy Delaunay on the (x, y) plane.
If the tip contact falls exactly on the section line, and the section line
already has other contacts along it, all tip-side contacts may be collinear
and Delaunay cannot form a triangle — producing a degenerate (zero-volume)
wedge.  A second contact offset PERPENDICULAR to the section line by
``offset_m`` guarantees a non-collinear third point, so the TIN produces a
real wedge triangle.  The offset is geologically negligible (1 m default)
but guarantees the geometry.

Crossings validator note (IMPORTANT — do NOT change this):
The synthetic tip sits at the elevation where the two formations are equal
(Δ=0), which is BELOW the crossing-tolerance threshold.  The crossings
validator flags formations that dip BELOW each other, not ones that touch.
No bypass, no override is needed — the geometry is correct by construction.
A future engineer MUST NOT add a validator exception for pinch-out contacts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.pinch_out_constants import (
    DEFAULT_PINCH_OUT_OFFSET_M,
    PINCH_OUT_CONFIDENCE,
    PINCH_OUT_SOURCE,
)
from groundmodel.domain.services.pinch_out_geometry import compute_pinch_tip
from groundmodel.domain.services.tin_surface import (
    TinSurface,
    slice_tin,
)
from groundmodel.domain.value_objects.section_line_2d import SectionLine2D
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class PinchOutResult:
    """Result of a successful pinch-out extrapolation.

    Attributes
    ----------
    created_contact_ids : list[UUID]
        The two newly-created synthetic FormationContact ids (tip on the
        section line + the perpendicular twin).
    tip_elevation_m : float
        Absolute elevation (m above datum) of the pinch-out tip.
    tip_along_m : float
        Distance along the section line (m from start) of the tip.
    updated_section : CrossSectionOrm | None
        Refreshed section row after its seeded set was patched, or
        ``None`` when no section_id was provided.
    was_idempotent : bool
        True when synthetic contacts already existed for this formation and
        the use case returned them WITHOUT creating new ones. The router
        maps this to a 409 (existing ids still in the body) so the caller
        knows the invocation was a no-op.
    """

    created_contact_ids: list[UUID]
    tip_elevation_m: float
    tip_along_m: float
    updated_section: CrossSectionOrm | None
    was_idempotent: bool = False


class ExtrapolatePinchOut(GroundModelLogger):
    """Compute and commit the synthetic contacts for a formation pinch-out.

    Caller provides the section context plus the two formation ids
    (pinching formation + the deeper target).  The use case loads
    the cached TIN surfaces, slices them against the section line,
    delegates the crossing geometry to ``compute_pinch_tip``, converts
    the result back to absolute project coordinates, and inserts the
    two synthetic contacts.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

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
        formation_id: UUID,
        target_formation_id: UUID,
        section_id: UUID,
        direction: Literal["left", "right"],
        dip_override_m_per_m: float | None = None,
        offset_m: float | None = None,
        dry_run: bool = False,
    ) -> PinchOutResult:
        """Run the full pinch-out extrapolation for one formation pair.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            Geological model that owns both formations' contacts.
        formation_id : UUID
            The formation whose thickness shrinks to zero (the "pinching"
            or "wigging-out" formation).
        target_formation_id : UUID
            The deeper formation the pinching one wedges into.
        section_id : UUID
            Cross-section line used to slice both TIN surfaces.
        direction : Literal["left", "right"]
            Which end of the section the formation thins toward.
        dip_override_m_per_m : float | None
            When provided, uses this gradient instead of deriving it from
            the pinching polyline's last segment.  Required when the
            pinching formation has a single-point TIN (no segment).
        offset_m : float | None
            Perpendicular offset for the twin contact that breaks Delaunay
            collinearity.  Defaults to ``DEFAULT_PINCH_OUT_OFFSET_M``.
        dry_run : bool
            When ``True``, run steps 1–5 (section load, TIN load, slice,
            crossing geometry, coordinate conversion) and return the tip
            geometry WITHOUT creating contacts, marking the surface stale,
            seeding the section, or committing.  The returned result
            carries ``created_contact_ids=[]`` and ``updated_section=None``.
            All ``ValueError`` (uncomputable geometry) paths remain active
            so the frontend ghost preview can surface a meaningful error.

        Returns
        -------
        PinchOutResult
            Ids + geometry of the committed contacts (commit path), or
            geometry only with empty id list (dry-run path).

        Raises
        ------
        ValueError
            When the geometry is uncomputable: no TIN surface for either
            formation, empty or single-point TIN slices without a
            ``dip_override_m_per_m``, or the ray never crosses the target.
            The router maps this to HTTP 422.
        """
        effective_offset = offset_m if offset_m is not None else DEFAULT_PINCH_OUT_OFFSET_M
        self.info(
            f"ExtrapolatePinchOut entry: model={model_id} "
            f"formation={formation_id} target={target_formation_id} "
            f"section={section_id} direction={direction!r} "
            f"dip_override={dip_override_m_per_m} offset={effective_offset} "
            f"dry_run={dry_run}"
        )

        # ------------------------------------------------------------------ #
        # 1. Load section line.                                               #
        # ------------------------------------------------------------------ #
        section = await self._session.get(CrossSectionOrm, section_id)
        if section is None or section.app_project_id != project_id:
            raise ValueError(f"Cross-section {section_id} not found in project {project_id}")
        section_line = SectionLine2D(
            start_x=section.start_x,
            start_y=section.start_y,
            end_x=section.end_x,
            end_y=section.end_y,
        )
        self.debug(f"Section line loaded: length={section_line.length_m:.1f} m")

        # ------------------------------------------------------------------ #
        # 2. Load cached TIN surfaces for both formations.                    #
        # ------------------------------------------------------------------ #
        pinching_surface = await self._load_surface(model_id, formation_id, "pinching")
        target_surface = await self._load_surface(model_id, target_formation_id, "target")

        # ------------------------------------------------------------------ #
        # 3. Slice both TINs along the section line.                          #
        # ------------------------------------------------------------------ #
        pinching_slice = slice_tin(pinching_surface, section_line)
        target_slice = slice_tin(target_surface, section_line)

        if not pinching_slice:
            self.warning(
                f"Pinching formation {formation_id} has no TIN slice on section "
                f"{section_id} — ensure the TIN is built and the formation has "
                f"contacts within the section corridor"
            )
            raise ValueError(
                f"Pinching formation {formation_id} has no TIN slice on this section. "
                "Build the 3D model first."
            )
        if not target_slice:
            self.warning(
                f"Target formation {target_formation_id} has no TIN slice on section "
                f"{section_id} — target formation contacts may be outside the corridor"
            )
            raise ValueError(
                f"Target formation {target_formation_id} has no TIN slice on this section. "
                "Ensure the target formation has contacts within the section corridor."
            )

        pinching_pts = [(sp.along_m, sp.elevation_m) for sp in pinching_slice]
        target_pts = [(sp.along_m, sp.elevation_m) for sp in target_slice]
        self.debug(f"Slices: pinching={len(pinching_pts)} pts, target={len(target_pts)} pts")

        # ------------------------------------------------------------------ #
        # 4. Compute the crossing tip via pure domain geometry.               #
        # ------------------------------------------------------------------ #
        tip = compute_pinch_tip(
            pinching_polyline=pinching_pts,
            target_polyline=target_pts,
            direction=direction,
            dip_override_m_per_m=dip_override_m_per_m,
        )
        if tip is None:
            self.warning(
                f"Pinch-out geometry uncomputable: formation={formation_id} "
                f"target={target_formation_id} direction={direction!r}. "
                f"The two formations may be diverging (never meet) or the "
                f"pinching formation's gradient is undefined."
            )
            raise ValueError(
                "Could not compute pinch-out tip: the extrapolated ray does not "
                "cross the target formation on this section. The surfaces may be "
                "diverging, or the pinching formation's dip is undefined. "
                "Provide a dip_override_m_per_m or adjust the section."
            )

        tip_along_m, tip_elevation_m = tip
        self.debug(f"Tip found: along={tip_along_m:.2f} m elev={tip_elevation_m:.3f} m")

        # ------------------------------------------------------------------ #
        # 5. Convert (along, elev) back to absolute (x, y, z).               #
        # ------------------------------------------------------------------ #
        # WHY here (before dry_run exit): the response for dry_run still
        # returns tip_along_m / tip_elevation_m so the frontend can draw the
        # ghost wedge without storing anything.  The coordinate conversion
        # below only affects the inserted contacts and is skipped by the
        # dry_run branch, so both paths see the same (along, elev) pair.
        dx = section.end_x - section.start_x
        dy = section.end_y - section.start_y
        length = math.hypot(dx, dy)
        # Unit direction vector of the section line.
        ux = dx / length
        uy = dy / length
        # Left-perpendicular unit vector (+90°: rotate (ux, uy) CCW).
        nx = -uy
        ny = ux

        # Tip on the section line.
        tip_x = section.start_x + tip_along_m * ux
        tip_y = section.start_y + tip_along_m * uy

        # Perpendicular twin offset: offset_m to the left of the section
        # (positive nx direction).  WHY: breaks Delaunay collinearity —
        # see module docstring.
        twin_x = tip_x + effective_offset * nx
        twin_y = tip_y + effective_offset * ny

        self.debug(
            f"Absolute coords: tip=({tip_x:.1f}, {tip_y:.1f}) twin=({twin_x:.1f}, {twin_y:.1f})"
        )

        # ------------------------------------------------------------------ #
        # 5b. Dry-run exit — return geometry only, no DB writes.              #
        # ------------------------------------------------------------------ #
        if dry_run:
            self.info(
                f"ExtrapolatePinchOut dry_run: returning tip geometry without "
                f"persisting contacts. along={tip_along_m:.2f} m elev={tip_elevation_m:.3f} m"
            )
            return PinchOutResult(
                created_contact_ids=[],
                tip_elevation_m=tip_elevation_m,
                tip_along_m=tip_along_m,
                updated_section=None,
                was_idempotent=False,
            )

        # ------------------------------------------------------------------ #
        # 6. Idempotency guard: reject if synthetic contacts already exist    #
        #    at (approximately) this position for this formation.             #
        # ------------------------------------------------------------------ #
        existing = await self._find_existing_synthetic_contacts(
            model_id=model_id,
            formation_id=formation_id,
        )
        if existing:
            existing_ids = [c.id for c in existing]
            self.warning(
                f"Synthetic contacts already exist for formation={formation_id} "
                f"in model={model_id}: {existing_ids} — returning existing (idempotent)"
            )
            # B3: report the STORED contact geometry, not the freshly
            # recomputed tip — the TIN may have changed since the original
            # pinch-out, so the recomputed (along, elev) can disagree with
            # what is actually persisted. Project each existing contact
            # onto the section line; the one with the smallest
            # perpendicular offset is the on-line tip (the twin sits
            # ~offset_m off). Fall back to the recomputed values only if a
            # contact is missing synthetic coordinates (should not happen).
            stored_tip_along = tip_along_m
            stored_tip_elev = tip_elevation_m
            best_perp = float("inf")
            for c in existing:
                if (
                    c.synthetic_x is None
                    or c.synthetic_y is None
                    or c.synthetic_elevation_m is None
                ):
                    continue
                rel_x = c.synthetic_x - section.start_x
                rel_y = c.synthetic_y - section.start_y
                perp = abs(rel_x * nx + rel_y * ny)
                if perp < best_perp:
                    best_perp = perp
                    stored_tip_along = rel_x * ux + rel_y * uy
                    stored_tip_elev = c.synthetic_elevation_m
            # B2: the user explicitly invoked the tool on THIS section, so
            # the explicit-content invariant requires the existing
            # contacts to be seeded here too — not merely re-fetched.
            seeded_section = await CrossSectionRepository(self._session).union_seeded_contact_ids(
                section_id, project_id, set(existing_ids), operation="pinch_out"
            )
            return PinchOutResult(
                created_contact_ids=existing_ids,
                tip_elevation_m=stored_tip_elev,
                tip_along_m=stored_tip_along,
                updated_section=seeded_section,
                was_idempotent=True,
            )

        # ------------------------------------------------------------------ #
        # 7. Insert the two synthetic contacts.                               #
        # ------------------------------------------------------------------ #
        # depth_top_m is required by the ORM schema (NOT NULL) but has no
        # physical meaning for synthetic contacts (they carry absolute
        # elevation, not a depth relative to an investigation surface).
        # We store 0.0 as a sentinel — the TIN compute ignores depth_top_m
        # for synthetic contacts (branch added in RecomputeFormationSurface).
        _SYNTHETIC_DEPTH_SENTINEL = 0.0

        contact_tip = FormationContactOrm(
            id=uuid7(),
            model_id=model_id,
            formation_id=formation_id,
            borehole_id=None,
            cpt_id=None,
            synthetic_x=tip_x,
            synthetic_y=tip_y,
            synthetic_elevation_m=tip_elevation_m,
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
            synthetic_elevation_m=tip_elevation_m,  # same elevation, different (x, y)
            depth_top_m=_SYNTHETIC_DEPTH_SENTINEL,
            source=PINCH_OUT_SOURCE,
            confidence=PINCH_OUT_CONFIDENCE,
        )
        self._session.add(contact_tip)
        self._session.add(contact_twin)
        await self._session.flush()
        self.debug(f"Synthetic contacts flushed: tip={contact_tip.id} twin={contact_twin.id}")

        # ------------------------------------------------------------------ #
        # 8. Mark the surface stale (Build button clears it).                 #
        # ------------------------------------------------------------------ #
        await self._repo.mark_surfaces_stale([(model_id, formation_id)])

        # ------------------------------------------------------------------ #
        # 9. Commit.                                                           #
        # ------------------------------------------------------------------ #
        await self._session.commit()
        await self._session.refresh(contact_tip)
        await self._session.refresh(contact_twin)
        self.success(
            f"Pinch-out committed: tip={contact_tip.id} twin={contact_twin.id} "
            f"along={tip_along_m:.2f} m elev={tip_elevation_m:.3f} m"
        )

        # ------------------------------------------------------------------ #
        # 10. Seed section contacts (explicit-content invariant).             #
        # ------------------------------------------------------------------ #
        new_ids = {contact_tip.id, contact_twin.id}
        updated_section = await CrossSectionRepository(self._session).union_seeded_contact_ids(
            section_id, project_id, new_ids, operation="pinch_out"
        )

        return PinchOutResult(
            created_contact_ids=[contact_tip.id, contact_twin.id],
            tip_elevation_m=tip_elevation_m,
            tip_along_m=tip_along_m,
            updated_section=updated_section,
        )

    # ---------------------------------------------------------------------- #
    # Private helpers                                                         #
    # ---------------------------------------------------------------------- #

    async def _load_surface(self, model_id: UUID, formation_id: UUID, label: str) -> TinSurface:
        """Load the cached TIN surface for (model, formation) and deserialise it.

        Raises ``ValueError`` when no surface row exists.
        """
        surface_orm = (
            await self._session.execute(
                select(FormationSurfaceOrm).where(
                    FormationSurfaceOrm.model_id == model_id,
                    FormationSurfaceOrm.formation_id == formation_id,
                )
            )
        ).scalar_one_or_none()

        if surface_orm is None:
            self.warning(
                f"No cached TIN surface for {label} formation={formation_id} "
                f"model={model_id}. Build the 3D model first."
            )
            raise ValueError(
                f"No built TIN surface for the {label} formation. Use 'Build 3D model' first."
            )

        vertices = [tuple(v) for v in surface_orm.vertices]
        triangles = [tuple(t) for t in surface_orm.triangles]
        self.debug(f"{label} surface: {len(vertices)} vertices {len(triangles)} triangles")
        return TinSurface(vertices=vertices, triangles=triangles)  # type: ignore[arg-type]

    async def _find_existing_synthetic_contacts(
        self,
        model_id: UUID,
        formation_id: UUID,
    ) -> list[FormationContactOrm]:
        """Return any synthetic contacts already committed for this (model, formation)."""
        rows = (
            (
                await self._session.execute(
                    select(FormationContactOrm).where(
                        FormationContactOrm.model_id == model_id,
                        FormationContactOrm.formation_id == formation_id,
                        FormationContactOrm.source == PINCH_OUT_SOURCE,
                        FormationContactOrm.borehole_id.is_(None),
                        FormationContactOrm.cpt_id.is_(None),
                        FormationContactOrm.synthetic_x.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        return list(rows)
