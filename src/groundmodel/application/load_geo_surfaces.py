"""Load a parent geological model's built band surfaces as ``SurfaceBound`` bounds.

Shared application-layer helper: reads the ``formation_surface`` rows for a
geological model and wraps each built, non-stale surface as a
:class:`~groundmodel.domain.services.strat_field.strat_types.SurfaceBound`.  Two
consumers share this loader:

* :meth:`~groundmodel.application.assemble_strat_inputs.AssembleStratInputs.assemble_with_geo`
  — the implicit-strat per-band builder, which partitions picks by these band
  surfaces.
* :class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`
  — the voxel builder, which bounds the labelled voxel grid by these surfaces.

The free function takes its ``session`` explicitly and an OPTIONAL
:class:`~groundmodel.shared.logging.ground_model_logger.GroundModelLogger` (so a
``GroundModelLogger`` subclass can pass ``self`` to preserve the original
debug/info log lines; ``None`` is a no-op).  It returns a ``tuple`` — the
contract Task 1's ``geo_bands`` helpers and Task 3's ``label_voxels`` expect.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.strat_field.strat_types import SurfaceBound
from groundmodel.domain.value_objects.tin_surface import TinSurface
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


async def load_geo_surfaces(
    session: AsyncSession,
    parent_geo_model_id: UUID,
    logger: GroundModelLogger | None = None,
) -> tuple[SurfaceBound, ...]:
    """Load the parent geological model's built, non-stale surfaces as bounds.

    Reads ``formation_surface`` rows for ``parent_geo_model_id``, skipping rows
    that are stale (not yet rebuilt) or have empty geometry (no vertices).  Wraps
    each usable surface as a :class:`SurfaceBound` via
    :meth:`SurfaceBound.from_tin`.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session.
    parent_geo_model_id : UUID
        The parent geological model's id.
    logger : GroundModelLogger or None, optional
        When provided, the per-surface skip reasons are logged at DEBUG and a
        summary at INFO (preserving the log lines from the original method on
        ``AssembleStratInputs``).  ``None`` (the default) means no logging.

    Returns
    -------
    tuple[SurfaceBound, ...]
        Built, non-stale surfaces as band bounds.  Empty when none exist.
    """
    surface_rows = await GeologyRepository(session).list_surfaces(parent_geo_model_id)
    bounds: list[SurfaceBound] = []
    for row in surface_rows:
        if row.is_stale:
            if logger is not None:
                logger.debug(f"  geo surface formation={row.formation_id} is_stale=True — skipping")
            continue
        if not row.vertices:
            if logger is not None:
                logger.debug(
                    f"  geo surface formation={row.formation_id} has no vertices — skipping"
                )
            continue
        tin = TinSurface(
            vertices=[tuple(v) for v in row.vertices],
            triangles=[tuple(t) for t in row.triangles],
        )
        bounds.append(SurfaceBound.from_tin(tin))

    skipped = len(surface_rows) - len(bounds)
    if skipped and logger is not None:
        logger.info(
            f"load_geo_surfaces: {len(bounds)} usable surface(s), {skipped} stale/empty skipped"
        )
    return tuple(bounds)
