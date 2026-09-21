"""Build a ground-surface sampler for a model, for the crossing-line clip.

The formation surfaces are cut where they cross the ground surface (owner
ruling 2026-09-06). The ground surface is the DEM adjusted by the project's
manual bed-level overrides — exactly what the 3D view and the section DEM line
show. This helper builds that ground surface for a model and returns a
``ground_z(x, y)`` sampler over it, so the geological Build can hand it to
``RebuildModelSurfaces``.

Best-effort by contract: the clip must never fail a Build. Any failure — no DEM
provider for the project CRS, a WCS outage, an empty hull — returns ``None``, and
the caller then rebuilds the surfaces without a clip (byte-identical to before).
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.build_ground_surface import BuildGroundSurface
from groundmodel.application.load_bed_overrides import load_bed_override_polygons
from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.dem.dem_provider_factory import (
    NoDemProviderError,
    build_dem_provider,
)
from groundmodel.shared.config import settings
from groundmodel.shared.constants.crs import DEFAULT_HORIZONTAL_EPSG
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


async def build_model_ground_sampler(
    session: AsyncSession,
    project_id: UUID,
    model_id: UUID,
) -> Callable[[float, float], float | None] | None:
    """Return a ``ground_z(x, y)`` sampler for the model, or ``None``.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    project_id : UUID
        Owning project — selects the DEM provider and the bed overrides.
    model_id : UUID
        Geological model whose investigation hull sets the ground-surface
        extent.

    Returns
    -------
    Callable[[float, float], float | None] | None
        A sampler that interpolates the ground surface (DEM + bed overrides) at
        ``(x, y)`` and returns ``None`` outside its footprint, OR ``None`` when
        no usable ground surface could be built (no provider, WCS failure, empty
        hull). The caller treats ``None`` as "no clip".
    """
    try:
        project_row = await session.get(ProjectOrm, project_id)
        epsg: int = (
            project_row.default_horizontal_epsg
            if project_row is not None and project_row.default_horizontal_epsg is not None
            else DEFAULT_HORIZONTAL_EPSG
        )
        try:
            provider = build_dem_provider(
                epsg,
                settings.dem_cache_dir,
                max_cache_bytes=settings.dem_cache_max_bytes
                if settings.dem_cache_max_bytes > 0
                else None,
            )
        except NoDemProviderError:
            logger.info(
                f"ground clip: no DEM provider for EPSG:{epsg} (project={project_id}) — "
                "rebuilding surfaces without a ground clip"
            )
            return None

        bed_overrides = await load_bed_override_polygons(session, project_id)
        async with provider:
            result = await BuildGroundSurface(
                session, provider, bed_overrides=bed_overrides
            ).execute(project_id, model_id)
    except Exception as exc:  # noqa: BLE001 — a clip must never fail a Build
        # Broad by design: the crossing-line clip is a best-effort enhancement.
        # A DEM outage, a refused extent, or any other error here must degrade to
        # "rebuild without a clip", never turn the Build into a 500.
        logger.warning(
            f"ground clip: could not build the ground surface for model={model_id} "
            f"({type(exc).__name__}: {exc}) — rebuilding surfaces without a ground clip"
        )
        return None

    if not result.triangles:
        logger.info(
            f"ground clip: empty ground surface for model={model_id} — "
            "rebuilding surfaces without a ground clip"
        )
        return None

    ground_tin = TinSurface(vertices=result.vertices, triangles=result.triangles)

    def ground_z(x: float, y: float) -> float | None:
        """Interpolate the ground surface at ``(x, y)``; ``None`` off-footprint."""
        return evaluate_tin_at(ground_tin, x, y)

    logger.info(
        f"ground clip: built ground surface for model={model_id} "
        f"({len(result.vertices)} vertices, {len(bed_overrides)} bed override(s))"
    )
    return ground_z
