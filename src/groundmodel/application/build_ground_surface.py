"""Build the ground-surface TIN for a geological model's investigation hull.

Orchestrates provider selection → DEM tile fetch → grid sampling →
``build_ground_surface_tin``. The formation clip is not done here (see below).

The result is a pure-Python value object: a ``TinSurface`` (vertices +
triangles) plus ``ValidationIssue``-shaped ``GapIssue`` records for any
detected anomalies (formation top above DEM, water-surface cell). The API
layer converts these into the response schema; the DB is not touched.

Architecture
------------
* This use case lives in ``application/`` — it orchestrates infrastructure
  (DEM provider, tile cache) and domain (clip service) but owns no
  geotechnical logic itself.
* Infrastructure imports are scoped to ``DemProvider`` and its products
  (``DemZGrid``) — the use case never imports a concrete ``DhmviiDemProvider``
  or ``Ahn4DemProvider`` directly. The factory selects the provider; the use
  case uses the abstract interface.
* The DB session is only used to fetch investigation (x, y) locations for
  the hull bounding box — it is read-only within this use case.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.section_membership import (
    load_section_member_investigation_ids,
)
from groundmodel.domain.services.bed_override import ground_sampler_with_bed
from groundmodel.domain.services.dem_clip import (
    GroundPoint,
    assess_ground_coverage,
    build_ground_surface_tin,
)
from groundmodel.domain.services.dem_clip_constants import GROUND_SURFACE_MARGIN_M
from groundmodel.domain.value_objects.bed_override_polygon import BedOverridePolygon
from groundmodel.domain.value_objects.gap_issue import GapIssue
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.dem.dem_provider import DemProvider, DemZGrid
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class GroundSurfaceResult:
    """Output of ``BuildGroundSurface.execute``.

    Attributes
    ----------
    vertices : list[tuple[float, float, float]]
        TIN vertices as (x, y, z) triples in the project's horizontal CRS.
        Empty when the DEM is unavailable or the model has no investigations.
    triangles : list[tuple[int, int, int]]
        Vertex-index triples (counter-clockwise).  Empty when fewer than
        3 valid DEM samples exist.
    issues : list[GapIssue]
        Validation issues (water-surface cell hits, contacts above DEM, etc.).
    provider_id : str
        Which provider answered (``"dhmvii"`` / ``"ahn4"`` / ``"none"``).
    from_cache : bool
        ``True`` when every grid tile was served from the local filesystem
        cache — no WCS request was made.
    """

    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]
    issues: list[GapIssue]
    provider_id: str
    from_cache: bool


class BuildGroundSurface(GroundModelLogger):
    """Build the ground-surface TIN for a geological model.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session — used read-only to load investigation
        locations.  No commit is issued.
    provider : DemProvider
        Pre-constructed DEM provider (selected by the router from the project's
        ``default_horizontal_epsg`` via ``build_dem_provider``).  The caller
        owns the provider lifecycle (close / context-manager).
    grid_spacing_m : float, optional
        Sample-grid node spacing for the ground-surface TIN.  Defaults to 10 m
        — coarser than the DEM native resolution (1 m DHMVII / 0.5 m AHN4)
        but fine enough for a visual terrain mesh.  Smaller values produce a
        finer mesh at higher compute cost; anything ≤ 1 m is rarely meaningful
        at typical project extents (a few km²).
    """

    def __init__(
        self,
        session: AsyncSession,
        provider: DemProvider,
        *,
        grid_spacing_m: float = 10.0,
        margin_m: float = GROUND_SURFACE_MARGIN_M,
        bed_overrides: Sequence[BedOverridePolygon] = (),
    ) -> None:
        """Initialise the use case.

        Parameters
        ----------
        bed_overrides : Sequence[BedOverridePolygon], optional
            Manual bed-level polygons (owner ruling 2026-09-06). Inside a
            polygon the ground surface takes the bed level instead of the DEM
            — the manual fix for the missing bathymetry over dredged water.
            Empty (default) leaves the surface on the raw DEM. A surveyed test
            collar still outranks the bed at the test's own location (the
            collar is applied on top of the bed-adjusted sampler).
        """
        super().__init__(__name__)
        self._session = session
        self._provider = provider
        self._grid_spacing_m = grid_spacing_m
        self._margin_m = margin_m
        self._bed_overrides = list(bed_overrides)

    async def execute(
        self,
        project_id: UUID,
        model_id: UUID,
    ) -> GroundSurfaceResult:
        """Sample the DEM over the model's investigation hull and build a TIN.

        Steps
        -----
        1. Load all (x, y) locations for boreholes and CPTs that have at
           least one contact in the model — the "hull" of the geological model.
           Investigations with NULL geometry are silently skipped (they have no
           location and cannot define a hull).
        2. Compute the axis-aligned bounding box of the hull points.
        3. Fetch a DEM grid tile covering the bbox (+ padding) via the provider
           (cache-first, WCS on a cold miss).
        4. Build the ground-surface TIN by sampling the grid on a regular mesh
           within the hull bbox.
        5. Return the TIN vertices, triangles, and any validation issues.

        The formation TIN clip (``clip_tin_by_ground_surface``) is intentionally NOT
        applied here — that step lives inside ``recompute_formation_surface.py``
        (called by ``RebuildModelSurfaces``) so the clip is applied at every
        surfaces/rebuild call, not only on ground-surface-build.  This use case
        produces the terrain TIN; the formation clip uses it via the API.

        Parameters
        ----------
        project_id : UUID
            Project scope guard — ensures the model belongs to the project.
        model_id : UUID
            Geological model to build the ground surface for.

        Returns
        -------
        GroundSurfaceResult
            TIN + issues + provenance.  ``vertices`` is empty when the model
            has no in-scope investigations or the DEM has no data for the hull.

        Raises
        ------
        NoDemProviderError
            Raised by the factory when the project EPSG is not supported —
            the router maps this to a 422 or 503 response.
        httpx.HTTPError
            On transport-level WCS failure (timeout, connection refused).
        ValueError
            When the WCS returns a response that cannot be decoded as a
            GeoTIFF (bbox entirely outside coverage, server error).
        """
        self.info(f"build ground surface: project={project_id} model={model_id}")

        # Only tests a cross-section draws are model inputs (owner ruling
        # 2026-09-23) — the hull follows the same membership as the surfaces.
        member_ids = await load_section_member_investigation_ids(
            self._session, project_id=project_id
        )
        ground_points = await self._load_hull_points(model_id, member_ids)
        hull_points = [(p.x_m, p.y_m) for p in ground_points]
        if not hull_points:
            self.warning(
                f"build ground surface: model={model_id} has no in-scope investigations "
                "with known (x, y) — returning empty ground surface"
            )
            return GroundSurfaceResult(
                vertices=[],
                triangles=[],
                issues=[],
                provider_id=self._provider.provider_id,
                from_cache=False,
            )

        self.debug(f"build ground surface: {len(hull_points)} hull point(s) for model={model_id}")

        # Derive bbox from the hull and fetch the DEM tile.
        xs = [p[0] for p in hull_points]
        ys = [p[1] for p in hull_points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        # INFO, not DEBUG: this is the line that names WHERE the DEM tile was
        # asked for. The 2026-08-02 dogfeed flood (a 1000 m × 4 m strip at the
        # origin, 404ing forever) could not be attributed to a caller because
        # the only record of the extent was a DEBUG line nobody had enabled.
        # It costs one line per build and it identifies the offending model.
        self.info(
            f"build ground surface: hull {len(hull_points)} point(s), bbox "
            f"({min_x:.1f},{min_y:.1f})→({max_x:.1f},{max_y:.1f}) "
            f"span={max_x - min_x:.1f}×{max_y - min_y:.1f} m "
            f"provider={self._provider.provider_id} model={model_id}"
        )

        # The tile must cover the MARGIN too, not just the investigation
        # extent — otherwise every grid node in the skirt samples outside the
        # raster and silently drops out, and the surface stops at the last
        # borehole after all.
        grid: DemZGrid = await self._provider.fetch_grid(
            min_x - self._margin_m,
            min_y - self._margin_m,
            max_x + self._margin_m,
            max_y + self._margin_m,
        )

        self.debug(
            f"build ground surface: grid {grid.n_cols}×{grid.n_rows} px "
            f"res={grid.resolution_m:.2f}m from_cache={grid.from_cache}"
        )

        # Apply the manual bed-level overrides on top of the DEM: inside a bed
        # polygon the ground is the drawn bed level, not the DEM's water
        # surface (owner ruling 2026-09-06). Empty overrides → the sampler is
        # exactly ``grid.sample_at``, so the un-dredged case is unchanged.
        dem_sample = ground_sampler_with_bed(grid.sample_at, self._bed_overrides)
        if self._bed_overrides:
            self.info(
                f"build ground surface: applying {len(self._bed_overrides)} bed "
                f"override(s) over the DEM (model={model_id})"
            )

        # A test's own surveyed collar OUTRANKS the DEM at its location (owner
        # ruling 2026-08-28: "I trust surface elevation of a test more than a
        # DEM we pulled off the web"). Only tests that actually carry a Z go in
        # the map — ``is not None`` keeps a real 0.0 m TAW collar (ordinary on
        # the Belgian coast) as an override while an absent Z falls back to the
        # DEM for that column.
        surface_elevations = {
            (p.x_m, p.y_m): p.surface_elevation_m
            for p in ground_points
            if p.surface_elevation_m is not None
        }

        tin = build_ground_surface_tin(
            dem_sample=dem_sample,
            hull_points=hull_points,
            grid_spacing_m=self._grid_spacing_m,
            margin_m=self._margin_m,
            surface_elevations=surface_elevations,
        )

        # The TIN spans NoData rather than leaving a hole, so a surface over
        # water still LOOKS complete. Naming the affected tests is the only
        # thing that says otherwise (Data Integrity Rule §5).
        issues = assess_ground_coverage(dem_sample, ground_points)
        if issues:
            self.warning(
                f"build ground surface: model={model_id} — the DEM has no ground "
                f"under {len(issues)} of {len(ground_points)} investigation(s); "
                "the terrain is interpolated across them"
            )
            for issue in issues:
                self.debug(f"build ground surface: {issue.detail}")

        self.success(
            f"build ground surface: model={model_id} "
            f"{len(tin.vertices)} vertices {len(tin.triangles)} triangles "
            f"{len(issues)} issue(s) "
            f"provider={self._provider.provider_id} from_cache={grid.from_cache}"
        )

        return GroundSurfaceResult(
            vertices=tin.vertices,
            triangles=tin.triangles,
            issues=issues,
            provider_id=self._provider.provider_id,
            from_cache=grid.from_cache,
        )

    async def _load_hull_points(
        self, model_id: UUID, section_member_ids: set[UUID]
    ) -> list[GroundPoint]:
        """Load labelled locations for the model's investigations a section draws.

        Queries the ``formation_contact`` table for distinct borehole and CPT
        ids in the model, keeps those in ``section_member_ids``, then joins to
        the name + geometry columns for each. Investigations with NULL x/y are
        silently skipped — they cannot contribute to the hull.

        The name travels with the location because the coverage report has to
        name the test the DEM could not answer for; a UUID in that message
        would be unusable in the UI.

        Parameters
        ----------
        model_id : UUID
            Geological model to query.
        section_member_ids : set[UUID]
            Investigations that project onto at least one cross-section. A
            contact-bearing test outside this set is not a model input and
            must not stretch the hull (owner ruling 2026-09-23).

        Returns
        -------
        list[GroundPoint]
            Deduplicated locations in the project's native CRS, each labelled
            with its investigation name.
        """
        # Collect distinct borehole ids from contacts.
        bh_rows = (
            (
                await self._session.execute(
                    select(FormationContactOrm.borehole_id)
                    .where(FormationContactOrm.model_id == model_id)
                    .where(FormationContactOrm.borehole_id.is_not(None))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )

        # Collect distinct CPT ids from contacts.
        cpt_rows = (
            (
                await self._session.execute(
                    select(FormationContactOrm.cpt_id)
                    .where(FormationContactOrm.model_id == model_id)
                    .where(FormationContactOrm.cpt_id.is_not(None))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )

        # Membership filter: a test no cross-section draws feeds no surface, so
        # it must not define the ground hull either.
        before = len(bh_rows) + len(cpt_rows)
        bh_rows = [b for b in bh_rows if b in section_member_ids]
        cpt_rows = [c for c in cpt_rows if c in section_member_ids]
        skipped = before - len(bh_rows) - len(cpt_rows)
        if skipped:
            self.info(
                f"ground hull: skipped {skipped} contact-bearing test(s) on no cross-section "
                f"(model={model_id}, {len(bh_rows) + len(cpt_rows)} kept)"
            )

        points: list[GroundPoint] = []

        if bh_rows:
            bh_locs = (
                await self._session.execute(
                    select(
                        BoreholeOrm.name,
                        BoreholeOrm.location_x,
                        BoreholeOrm.location_y,
                        BoreholeOrm.elevation_m,
                    ).where(BoreholeOrm.id.in_(bh_rows))
                )
            ).all()
            for name, x, y, elev in bh_locs:
                if x is not None and y is not None:
                    # ``elev`` is the surveyed collar; ``None`` means unknown.
                    # A collar of 0.0 is kept as a real value (not coerced).
                    points.append(
                        GroundPoint(
                            label=str(name),
                            x_m=float(x),
                            y_m=float(y),
                            surface_elevation_m=None if elev is None else float(elev),
                        )
                    )

        if cpt_rows:
            cpt_locs = (
                await self._session.execute(
                    select(
                        CptOrm.name,
                        CptOrm.location_x,
                        CptOrm.location_y,
                        CptOrm.elevation_m,
                    ).where(CptOrm.id.in_(cpt_rows))
                )
            ).all()
            for name, x, y, elev in cpt_locs:
                if x is not None and y is not None:
                    points.append(
                        GroundPoint(
                            label=str(name),
                            x_m=float(x),
                            y_m=float(y),
                            surface_elevation_m=None if elev is None else float(elev),
                        )
                    )

        # Deduplicate on location — multiple contacts at the same anchor
        # produce the same (x, y); qhull rejects coincident points.
        seen: dict[tuple[float, float], GroundPoint] = {}
        for point in points:
            seen.setdefault((point.x_m, point.y_m), point)
        return list(seen.values())
