"""Shared borehole-materialisation helpers for the geotech subdivision stage.

Both :class:`SubdivideAllBodies` and :class:`DivideBoreholes` TIN-divide
borehole columns and find-or-create classified geotech formations.  This base
class extracts those shared methods so neither use case copy-pastes the ~250
lines of find-or-create + TIN-interpolation logic.

Who inherits
------------
* :class:`~groundmodel.application.subdivide_all_bodies.SubdivideAllBodies`
* :class:`~groundmodel.application.divide_boreholes.DivideBoreholes`

Who does NOT inherit
--------------------
Dataclasses, value objects, enums, exception classes — they hold data, not
behaviour.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.build_geotech_model_from_litho import (
    BuildGeotechModelFromLitho,
    _GeoSurface,
)
from groundmodel.domain.services.geotech_split_surface import (
    ColumnXY,
    interpolate_split_elevations,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Geo↔litho snap tolerance for the geotech geo-bounding.  When a geological
# surface crosses a litho unit within this distance of a litho contact, the
# division SNAPS to the contact instead of carving a thin sliver.  Geotech uses
# a wider default (0.3 m) than the litho stage's 0.20 m so true near-coincident
# slivers snap, while a genuine mid-unit geo boundary further than 0.3 m from
# any contact still divides (a 0.44 m division is real, not a sliver — owner).
# Read from ``view_state["geotech_subdivision"]``, kept separate from the litho
# stage's ``litho_segmenter.litho_snap_tolerance_m``.
_DEFAULT_GEOTECH_SNAP_TOLERANCE_M: float = 0.30


class GeotechBoreholeMaterialiser(GroundModelLogger):
    """Base class that provides shared TIN-division and find-or-create logic.

    Concrete subclasses must call ``super().__init__(__name__, session)`` so
    the logger uses the caller's module path (not the base class path).

    Parameters
    ----------
    name : str
        Logger name — pass ``__name__`` from the concrete class.
    session : AsyncSession
        Active SQLAlchemy async session.
    """

    def __init__(self, name: str, session: AsyncSession) -> None:
        """Initialise logger + shared infrastructure references."""
        super().__init__(name)
        self._session = session
        self._litho_repo = LithoLayerRepository(session)
        # Delegate geo-surface loading + geo-bounding helpers to C1's class.
        # We instantiate C1 for its helper methods without calling execute().
        self._c1 = BuildGeotechModelFromLitho(session)

    # ------------------------------------------------------------------
    # Grouping helper
    # ------------------------------------------------------------------

    async def _group_segments(
        self,
        divided: list[BodyLayerPick],
        geo_surfaces: list[_GeoSurface],
    ) -> dict[tuple[str, UUID | None], list[BodyLayerPick]]:
        """Group geo-bounded segments by ``(body_id, source_geo_formation_id)``.

        Parameters
        ----------
        divided : list[BodyLayerPick]
            Geo-bounded picks from ``divide_picks_by_geology``.
        geo_surfaces : list[_GeoSurface]
            Parent geology band surfaces.

        Returns
        -------
        dict[tuple[str, UUID | None], list[BodyLayerPick]]
            Keyed by ``(body_id_str, source_geo_formation_id)``.
        """
        groups: dict[tuple[str, UUID | None], list[BodyLayerPick]] = defaultdict(list)
        for seg in divided:
            geo_fid = self._c1._geo_formation_at_midpoint(seg, geo_surfaces)
            groups[(seg.body_id, geo_fid)].append(seg)
        return dict(groups)

    # ------------------------------------------------------------------
    # TIN-based borehole division
    # ------------------------------------------------------------------

    async def _materialise_borehole_bands(
        self,
        *,
        project_id: UUID,
        geotech_model_id: UUID,
        inv_id: str,
        inv_uuid: UUID,
        bh_x: float,
        bh_y: float,
        bh_surface_elev: float,
        geo_top_m: float,
        geo_base_m: float,
        transition_surfaces: list[list[tuple[ColumnXY, float]]],
        cpt_segs: list[BodyLayerPick],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        geotech_layer_by_inv_depth: dict[str, list[tuple[float, float, UUID, UUID, int | None]]],
    ) -> int:
        """Materialise geotech bands for one borehole using TIN-interpolated split depths.

        For each packing-transition surface in *transition_surfaces* the CPT
        control points are fed into :func:`interpolate_split_elevations`, which
        returns the transition elevation at the borehole's XY.  The elevation is
        converted to a depth and clamped to the borehole's geo-bounded extent
        ``[geo_top_m, geo_base_m]``.  The resulting ordered split depths divide
        the extent into bands; each band inherits the NAD class of the
        corresponding CPT-stack position.

        When *transition_surfaces* is empty (borehole-only body — no CPT split
        surfaces exist), a single skeleton band spanning the full geo-bounded
        extent is materialised instead.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        geotech_model_id : UUID
            The geotech model row to write layers into.
        inv_id : str
            Borehole id string.
        inv_uuid : UUID
            Borehole id as UUID.
        bh_x : float
            Borehole world x-coordinate (m).
        bh_y : float
            Borehole world y-coordinate (m).
        bh_surface_elev : float
            Borehole surface elevation (m, positive upward); used to convert
            interpolated elevation to depth.
        geo_top_m : float
            Top of the geo-bounded litho extent for this borehole segment.
        geo_base_m : float
            Base of the geo-bounded litho extent for this borehole segment.
        transition_surfaces : list[list[tuple[ColumnXY, float]]]
            Per-band-boundary control points.  ``transition_surfaces[k]`` is the
            list of ``(ColumnXY, base_elevation_m)`` for all CPT columns that
            have a k-th band boundary (i.e. at least k+2 bands).
        cpt_segs : list[BodyLayerPick]
            CPT body-layer picks in this group; used to derive the modal NAD
            class for each borehole band from the already-materialised CPT
            layers in *geotech_layer_by_inv_depth*.
        source_litho_formation_id : UUID
            Source litho formation driving the find-or-create key.
        source_geo_formation_id : UUID | None
            Source geo formation driving the find-or-create key.
        classified_by_key : dict
            In-memory find-or-create cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory find-or-create cache for skeleton formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified formation ids created in this call (mutated).
        geotech_layer_by_inv_depth : dict
            Per-investigation depth→layer-id map populated with the CPT layers
            already written for this group.

        Returns
        -------
        int
            Number of geotech ``LithoLayerOrm`` rows inserted for this borehole.
        """
        bh_col = ColumnXY(investigation_id=inv_id, x_m=bh_x, y_m=bh_y)

        # 1 mm guard so a split doesn't land exactly on the geo-bounded boundary
        # (which would produce a zero-thickness band at the edge).
        _CLAMP_GUARD = 0.001

        # Build the ordered list of split depths clamped to the geo extent.
        # Each transition surface k is interpolated at the borehole's XY and
        # converted from elevation to depth.
        split_depths: list[float] = []
        for ctrl_pts in transition_surfaces:
            if not ctrl_pts:
                continue
            cpt_points = [c for c, _ in ctrl_pts]
            cpt_elevs = [e for _, e in ctrl_pts]
            elev_at_bh = interpolate_split_elevations(cpt_points, cpt_elevs, [bh_col])
            split_elev = elev_at_bh[inv_id]
            split_depth = bh_surface_elev - split_elev
            split_depth = max(geo_top_m + _CLAMP_GUARD, min(geo_base_m - _CLAMP_GUARD, split_depth))
            split_depths.append(split_depth)

        # Deduplicate and sort; remove splits that collapse two adjacent bands to
        # less than _CLAMP_GUARD apart (avoids zero-thickness layers).
        split_depths = sorted(set(split_depths))
        filtered: list[float] = []
        prev = geo_top_m
        for sd in split_depths:
            if sd - prev > 0.001 and geo_base_m - sd > 0.001:
                filtered.append(sd)
                prev = sd
        split_depths = filtered

        # Build the band intervals from split_depths.
        band_intervals: list[tuple[float, float]] = []
        prev_top = geo_top_m
        for sd in split_depths:
            band_intervals.append((prev_top, sd))
            prev_top = sd
        band_intervals.append((prev_top, geo_base_m))

        # For each band, derive the representative nad_class from the CPT layers
        # already written for this group.  We use the midpoint of the borehole
        # band to identify which CPT sub-layer covers that depth.
        def _modal_nad_class(band_top: float, band_base: float) -> int | None:
            """Return the most-common CPT nad_class covering the band midpoint."""
            mid = (band_top + band_base) / 2.0
            counts: dict[int, int] = {}
            for cpt_seg in cpt_segs:
                for t, b, _lid, _fid, nc in geotech_layer_by_inv_depth.get(
                    cpt_seg.investigation_id, []
                ):
                    if t <= mid <= b and nc is not None:
                        counts[nc] = counts.get(nc, 0) + 1
            if not counts:
                return None
            return max(counts, key=lambda c: counts[c])

        inserted = 0
        for band_top, band_base in band_intervals:
            nad_class = _modal_nad_class(band_top, band_base)
            formation = await self._find_or_create_formation(
                project_id=project_id,
                classified_by_key=classified_by_key,
                skeleton_by_key=skeleton_by_key,
                created_formation_ids=created_formation_ids,
                nad_class=nad_class,
                source_litho_formation_id=source_litho_formation_id,
                source_geo_formation_id=source_geo_formation_id,
            )
            layer = LithoLayerOrm(
                id=uuid7(),
                model_id=geotech_model_id,
                formation_id=formation.id,
                depth_top_m=band_top,
                depth_base_m=band_base,
                status="accepted",
                source="segmenter",
                confidence="medium",
                borehole_id=inv_uuid,
            )
            self._session.add(layer)
            geotech_layer_by_inv_depth[inv_id].append(
                (band_top, band_base, layer.id, formation.id, nad_class)
            )
            inserted += 1

        if inserted >= 2:
            self.debug(
                f"_materialise_borehole_bands: borehole={inv_id} "
                f"TIN-divided into {inserted} bands "
                f"(geo=[{geo_top_m:.2f},{geo_base_m:.2f}] "
                f"splits={[f'{sd:.2f}' for sd in split_depths]})"
            )
        else:
            self.debug(
                f"_materialise_borehole_bands: borehole={inv_id} "
                f"single skeleton band [{geo_top_m:.2f},{geo_base_m:.2f}] "
                f"(no CPT split surfaces or all clamped)"
            )

        return inserted

    # ------------------------------------------------------------------
    # Formation find-or-create helpers
    # ------------------------------------------------------------------

    async def _find_or_create_formation(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int | None,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create the geotech formation for one sub-unit.

        Delegates to :meth:`_find_or_create_classified` for
        ``nad_class is not None`` or to :meth:`_find_or_create_skeleton` for
        the borehole-only carry-through.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory cache for classified formations (mutated).
        skeleton_by_key : dict
            In-memory cache for skeleton formations (mutated).
        created_formation_ids : list[UUID]
            Accumulator of classified formation ids created (mutated).
        nad_class : int | None
            NAD packing class, or ``None`` for a skeleton carry-through.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created formation row.
        """
        if nad_class is None:
            return await self._find_or_create_skeleton(
                project_id=project_id,
                skeleton_by_key=skeleton_by_key,
                source_litho_formation_id=source_litho_formation_id,
                source_geo_formation_id=source_geo_formation_id,
            )
        return await self._find_or_create_classified(
            project_id=project_id,
            classified_by_key=classified_by_key,
            created_formation_ids=created_formation_ids,
            nad_class=nad_class,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )

    async def _find_or_create_classified(
        self,
        *,
        project_id: UUID,
        classified_by_key: dict[tuple[int, UUID, UUID | None], GeologicalFormationOrm],
        created_formation_ids: list[UUID],
        nad_class: int,
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a classified geotech formation by the full triple.

        The triple ``(nad_class, source_litho_formation_id,
        source_geo_formation_id)`` is the stable find-or-create key shared
        with C2b's ``AcceptGeotechSuggestions._find_or_create_classified``.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        classified_by_key : dict
            In-memory find-or-create cache (mutated).
        created_formation_ids : list[UUID]
            Accumulator of ids created in this call (mutated).
        nad_class : int
            The NAD packing class.
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created classified formation row.
        """
        key = (nad_class, source_litho_formation_id, source_geo_formation_id)
        cached = classified_by_key.get(key)
        if cached is not None:
            return cached

        geo_filter = (
            GeologicalFormationOrm.source_geo_formation_id.is_(None)
            if source_geo_formation_id is None
            else GeologicalFormationOrm.source_geo_formation_id == source_geo_formation_id
        )
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class == nad_class,
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            classified_by_key[key] = db_row
            self.debug(
                f"_find_or_create_classified: reused {db_row.id} "
                f"nad={nad_class} litho={source_litho_formation_id} "
                f"geo={source_geo_formation_id}"
            )
            return db_row

        source_litho = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        soil_code = source_litho.litho_main_soil_code if source_litho is not None else None
        admixtures = source_litho.litho_admixtures if source_litho is not None else None
        color = source_litho.color if source_litho is not None else "#bbbbbb"
        base_name = source_litho.name if source_litho is not None else "geotech unit"
        display_order = source_litho.display_order if source_litho is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=f"{base_name} (NAD {nad_class})",
            color=color,
            display_order=display_order,
            nad_class=nad_class,
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        classified_by_key[key] = formation
        created_formation_ids.append(formation.id)
        self.debug(
            f"_find_or_create_classified: created {formation.id} "
            f"nad={nad_class} soil={soil_code} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
        )
        return formation

    async def _find_or_create_skeleton(
        self,
        *,
        project_id: UUID,
        skeleton_by_key: dict[tuple[UUID, UUID | None], GeologicalFormationOrm],
        source_litho_formation_id: UUID,
        source_geo_formation_id: UUID | None,
    ) -> GeologicalFormationOrm:
        """Find-or-create a skeleton (``nad_class=None``) formation.

        Used for borehole-only sub-bodies in a CPT-free body (permanent — they
        cannot be TIN-divided), and as a last resort when no CPT data exists in
        the model at all.

        Parameters
        ----------
        project_id : UUID
            Owning project.
        skeleton_by_key : dict
            In-memory find-or-create cache (mutated).
        source_litho_formation_id : UUID
            The litho formation this geotech unit subdivides.
        source_geo_formation_id : UUID | None
            The geological formation the unit sits within.

        Returns
        -------
        GeologicalFormationOrm
            The found-or-created skeleton formation row.
        """
        key = (source_litho_formation_id, source_geo_formation_id)
        cached = skeleton_by_key.get(key)
        if cached is not None:
            return cached

        geo_filter = (
            GeologicalFormationOrm.source_geo_formation_id.is_(None)
            if source_geo_formation_id is None
            else GeologicalFormationOrm.source_geo_formation_id == source_geo_formation_id
        )
        db_row = (
            (
                await self._session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.app_project_id == project_id,
                        GeologicalFormationOrm.nad_class.is_(None),
                        GeologicalFormationOrm.source_litho_formation_id
                        == source_litho_formation_id,
                        geo_filter,
                    )
                )
            )
            .scalars()
            .first()
        )
        if db_row is not None:
            skeleton_by_key[key] = db_row
            return db_row

        source_litho = await self._session.get(GeologicalFormationOrm, source_litho_formation_id)
        soil_code = source_litho.litho_main_soil_code if source_litho is not None else None
        admixtures = source_litho.litho_admixtures if source_litho is not None else None
        color = source_litho.color if source_litho is not None else "#bbbbbb"
        name = f"{source_litho.name} (geotech)" if source_litho is not None else "geotech unit"
        display_order = source_litho.display_order if source_litho is not None else 0

        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project_id,
            name=name,
            color=color,
            display_order=display_order,
            nad_class=None,
            litho_main_soil_code=soil_code,
            litho_admixtures=admixtures,
            source_litho_formation_id=source_litho_formation_id,
            source_geo_formation_id=source_geo_formation_id,
        )
        self._session.add(formation)
        await self._session.flush()
        skeleton_by_key[key] = formation
        self.debug(
            f"_find_or_create_skeleton: created {formation.id} "
            f"litho={source_litho_formation_id} geo={source_geo_formation_id}"
        )
        return formation

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    async def _resolve_anchor_kinds(self, investigation_ids: set[UUID]) -> dict[str, str]:
        """Classify each investigation id as ``"borehole"`` or ``"cpt"``.

        Parameters
        ----------
        investigation_ids : set[UUID]
            Investigation UUIDs to classify.

        Returns
        -------
        dict[str, str]
            ``investigation_id (str) -> "borehole" | "cpt"``.
        """
        if not investigation_ids:
            return {}
        kinds: dict[str, str] = {}
        bh_ids = (
            await self._session.execute(
                select(BoreholeOrm.id).where(BoreholeOrm.id.in_(investigation_ids))
            )
        ).scalars()
        for bid in bh_ids:
            kinds[str(bid)] = "borehole"
        cpt_ids = (
            await self._session.execute(select(CptOrm.id).where(CptOrm.id.in_(investigation_ids)))
        ).scalars()
        for cid in cpt_ids:
            kinds[str(cid)] = "cpt"
        return kinds

    async def _read_geotech_snap_tolerance_m(self, project_id: UUID) -> float:
        """Read the geotech geo↔litho snap tolerance from the project view-state.

        Reads ``view_state["geotech_subdivision"]["litho_snap_tolerance_m"]`` —
        a GEOTECH-specific, WIDER tolerance than the litho stage's, so a
        geological surface that crosses a litho unit within this distance of a
        litho contact snaps to the contact (no sliver) rather than dividing.

        Parameters
        ----------
        project_id : UUID
            Owning project id.

        Returns
        -------
        float
            The configured geotech snap tolerance, or
            ``_DEFAULT_GEOTECH_SNAP_TOLERANCE_M`` (0.30 m) when absent,
            non-positive, or non-numeric.
        """
        project = await ProjectRepository(self._session).get_by_id(project_id)
        view_state = project.view_state if project is not None else None
        seg = (view_state or {}).get("geotech_subdivision") or {}
        try:
            val = float(seg.get("litho_snap_tolerance_m", _DEFAULT_GEOTECH_SNAP_TOLERANCE_M))
            return val if val > 0 else _DEFAULT_GEOTECH_SNAP_TOLERANCE_M
        except (TypeError, ValueError):
            return _DEFAULT_GEOTECH_SNAP_TOLERANCE_M
