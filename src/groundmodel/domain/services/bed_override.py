"""Manual bed-level override applied to the ground surface (owner ruling 2026-09-06).

Pure domain functions.  No I/O, no DB, no framework dependencies.

Rule
----
    "inside a bed polygon the ground surface is the bed level; outside it is the
    DEM; the section DEM line shows the bed where it crosses the polygon."

A :class:`BedOverridePolygon` names a constant bed elevation over a map area.
:func:`bed_level_at` answers "which override applies at this (x, y)?" and
:func:`ground_sampler_with_bed` wraps a DEM sampler so every ground-surface
consumer (the 3D terrain, the section DEM line, and the crossing-line formation
clip) reads the bed inside a polygon and the DEM everywhere else, from one
shared primitive.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from groundmodel.domain.value_objects.bed_override_polygon import BedOverridePolygon


def bed_level_at(
    polygons: Sequence[BedOverridePolygon],
    x: float,
    y: float,
) -> float | None:
    """Return the bed level overriding the ground at ``(x, y)``, or ``None``.

    Parameters
    ----------
    polygons : Sequence[BedOverridePolygon]
        The project's bed-override polygons, in order.
    x, y : float
        Query coordinates in the project's horizontal CRS.

    Returns
    -------
    float | None
        The ``level_m`` of the first polygon in ``polygons`` that contains the
        point, or ``None`` when the point is outside every polygon.  Overlaps
        resolve by order: the first containing polygon wins (deterministic, and
        the newest-drawn polygon wins when the caller lists them newest-first).
    """
    for polygon in polygons:
        if _point_in_ring(polygon.vertices, x, y):
            return polygon.level_m
    return None


def ground_sampler_with_bed(
    dem_sample: Callable[[float, float], float | None],
    polygons: Sequence[BedOverridePolygon],
) -> Callable[[float, float], float | None]:
    """Wrap a DEM sampler so bed overrides win inside their polygons.

    The returned callable has the same ``(x, y) -> float | None`` contract as a
    raw DEM sampler, so it drops straight into ``build_ground_surface_tin``,
    the section DEM-line profile, and ``clip_tin_by_ground_surface``.

    Parameters
    ----------
    dem_sample : Callable[[float, float], float | None]
        The underlying DEM sampler.
    polygons : Sequence[BedOverridePolygon]
        Bed overrides to apply.  Empty → the returned sampler is exactly
        ``dem_sample``.

    Returns
    -------
    Callable[[float, float], float | None]
        Inside a polygon: that polygon's bed level (even where the DEM is
        NoData — the bed fills the missing bathymetry).  Outside every polygon:
        the DEM value, ``None`` included.
    """
    if not polygons:
        return dem_sample

    def sample(x: float, y: float) -> float | None:
        level = bed_level_at(polygons, x, y)
        if level is not None:
            return level
        return dem_sample(x, y)

    return sample


def _point_in_ring(vertices: Sequence[tuple[float, float]], x: float, y: float) -> bool:
    """Even-odd ray-cast point-in-polygon test.

    Treats ``vertices`` as a closed ring (the edge from the last vertex back to
    the first is implicit).  Fewer than three vertices never contains a point.
    A point exactly on an edge is not guaranteed either way (boundary case);
    the bed polygons are hand-drawn areas where that never matters.

    Parameters
    ----------
    vertices : Sequence[tuple[float, float]]
        The ring's ``(x, y)`` vertices.
    x, y : float
        Query point.

    Returns
    -------
    bool
        ``True`` when the point is inside the ring.
    """
    n = len(vertices)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = vertices[i]
        xj, yj = vertices[j]
        # The edge (j -> i) straddles the horizontal ray at y when exactly one
        # endpoint is above y; the x-intersection of that edge with the ray is
        # compared against the query x.
        if (yi > y) != (yj > y):
            x_cross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_cross:
                inside = not inside
        j = i
    return inside
