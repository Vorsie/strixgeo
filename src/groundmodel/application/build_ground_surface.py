"""Build the ground-surface TIN for a geological model's investigation hull.

Orchestrates provider selection → DEM tile fetch → grid sampling →
``build_ground_surface_tin`` → ``clip_tin_to_dem`` (if requested).

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

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.dem_clip import build_ground_surface_tin
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
    ) -> None:
        """Initialise the use case."""
        super().__init__(__name__)
        self._session = session
        self._provider = provider
        self._grid_spacing_m = grid_spacing_m

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

        The formation TIN clip (``clip_tin_to_dem``) is intentionally NOT
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

        hull_points = await self._load_hull_points(model_id)
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

        self.debug(
            f"build ground surface: bbox ({min_x:.1f},{min_y:.1f})→"
            f"({max_x:.1f},{max_y:.1f}) provider={self._provider.provider_id}"
        )

        grid: DemZGrid = await self._provider.fetch_grid(
            min_x,
            min_y,
            max_x,
            max_y,
        )

        self.debug(
            f"build ground surface: grid {grid.n_cols}×{grid.n_rows} px "
            f"res={grid.resolution_m:.2f}m from_cache={grid.from_cache}"
        )

        tin = build_ground_surface_tin(
            dem_sample=grid.sample_at,
            hull_points=hull_points,
            grid_spacing_m=self._grid_spacing_m,
        )

        self.success(
            f"build ground surface: model={model_id} "
            f"{len(tin.vertices)} vertices {len(tin.triangles)} triangles "
            f"provider={self._provider.provider_id} from_cache={grid.from_cache}"
        )

        return GroundSurfaceResult(
            vertices=tin.vertices,
            triangles=tin.triangles,
            issues=[],
            provider_id=self._provider.provider_id,
            from_cache=grid.from_cache,
        )

    async def _load_hull_points(self, model_id: UUID) -> list[tuple[float, float]]:
        """Load (x, y) locations for all investigations anchored to this model.

        Queries the ``formation_contact`` table for distinct borehole and CPT
        ids in the model, then joins to the geometry columns for each.
        Investigations with NULL x/y are silently skipped — they cannot
        contribute to the hull.

        Parameters
        ----------
        model_id : UUID
            Geological model to query.

        Returns
        -------
        list[tuple[float, float]]
            Deduplicated (x, y) pairs in the project's native CRS.
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

        points: list[tuple[float, float]] = []

        if bh_rows:
            bh_locs = (
                await self._session.execute(
                    select(BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                        BoreholeOrm.id.in_(bh_rows)
                    )
                )
            ).all()
            for x, y in bh_locs:
                if x is not None and y is not None:
                    points.append((float(x), float(y)))

        if cpt_rows:
            cpt_locs = (
                await self._session.execute(
                    select(CptOrm.location_x, CptOrm.location_y).where(CptOrm.id.in_(cpt_rows))
                )
            ).all()
            for x, y in cpt_locs:
                if x is not None and y is not None:
                    points.append((float(x), float(y)))

        # Deduplicate — multiple contacts at the same anchor produce the
        # same (x, y); the TIN sampler does not benefit from exact duplicates.
        return list({p: None for p in points}.keys())
