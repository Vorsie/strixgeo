"""Load a parent geological model's built band surfaces as ``SurfaceBound`` bounds.

Shared application-layer helper: reads the ``formation_surface`` rows for a
geological model and wraps each built, non-stale surface as a
:class:`~groundmodel.domain.services.surface_bound.SurfaceBound`.  Consumed by
:class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`
— the voxel builder, which bounds the labelled voxel grid by these surfaces.

The free function takes its ``session`` explicitly and an OPTIONAL
:class:`~groundmodel.shared.logging.ground_model_logger.GroundModelLogger` (so a
``GroundModelLogger`` subclass can pass ``self`` to preserve the original
debug/info log lines; ``None`` is a no-op).  It returns a ``tuple`` — the
contract the ``geo_bands`` helpers and ``label_voxels`` expect.

This module also carries :func:`digest_surfaces`, the BLAKE2b digest of a
surface set that the voxel build checksum folds in so a geo-surface rebuild
busts the litho 3-D cache.
"""

from __future__ import annotations

import hashlib
import struct
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.surface_bound import SurfaceBound
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
        summary at INFO.  ``None`` (the default) means no logging.

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


def digest_surfaces(surfaces: list[SurfaceBound]) -> bytes:
    """BLAKE2b-16 digest of the geological surfaces' mesh geometry.

    Covers every vertex triple + triangle triple in sorted surface order (sorted
    by ``(min_x, min_y)`` of each surface's vertices for determinism when the
    surface load order is DB-arbitrary).  Folded into the build checksum so any
    geo-surface rebuild forces a litho rebuild.

    Parameters
    ----------
    surfaces : list[SurfaceBound]
        The parent geological model's band surfaces.

    Returns
    -------
    bytes
        16-byte BLAKE2b digest.
    """
    h = hashlib.blake2b(digest_size=16)

    # Sort surfaces by their vertex centroid for determinism across DB load orders.
    # The Z centroid is the third key so two flat surfaces tiling the SAME hull
    # (identical XY centroid) but at different elevations sort deterministically —
    # without it the sort falls back to DB load order and the digest can drift
    # across runs with no data change (false checksum-skip / false-rebuild).
    def _surface_sort_key(s: SurfaceBound) -> tuple[float, float, float]:
        if not s.vertices:
            return (0.0, 0.0, 0.0)
        return (
            sum(v[0] for v in s.vertices) / len(s.vertices),
            sum(v[1] for v in s.vertices) / len(s.vertices),
            sum(v[2] for v in s.vertices) / len(s.vertices),
        )

    for s in sorted(surfaces, key=_surface_sort_key):
        h.update(struct.pack("<I", len(s.vertices)))
        for x, y, z in s.vertices:
            h.update(struct.pack("<ddd", x, y, z))
        h.update(struct.pack("<I", len(s.triangles)))
        for i, j, k in s.triangles:
            h.update(struct.pack("<III", i, j, k))
    return h.digest()
