"""Load a project's bed-override polygons as domain value objects.

Thin application helper bridging the ORM (``BedOverrideOrm``) and the pure
domain value object (``BedOverridePolygon``) so the ground-surface build, the
section DEM line, and the crossing-line clip all consume the same shape.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.value_objects.bed_override_polygon import BedOverridePolygon
from groundmodel.infrastructure.db.repositories.bed_override_repository import (
    BedOverrideRepository,
)


async def load_bed_override_polygons(
    session: AsyncSession,
    project_id: UUID,
) -> list[BedOverridePolygon]:
    """Return the project's bed overrides as domain value objects, newest first.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session (read-only here).
    project_id : UUID
        Project to load bed overrides for.

    Returns
    -------
    list[BedOverridePolygon]
        One value object per stored bed override. Rows come back newest-first
        (see :meth:`BedOverrideRepository.list_all`), so the most recently drawn
        polygon wins any overlap in ``bed_level_at``.
    """
    rows = await BedOverrideRepository(session).list_all(project_id)
    polygons: list[BedOverridePolygon] = []
    for row in rows:
        # ``vertices`` is a JSONB list of [x, y] pairs; coerce to float tuples.
        ring = [(float(v[0]), float(v[1])) for v in (row.vertices or []) if len(v) >= 2]
        polygons.append(
            BedOverridePolygon(label=row.label, level_m=float(row.level_m), vertices=ring)
        )
    return polygons
