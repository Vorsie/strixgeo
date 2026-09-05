"""Answer whether projected coordinates fall inside their declared CRS's area.

A GEF or DOV record carries a horizontal EPSG and an ``(x, y)`` in that
system's units. When the two disagree — a swapped X/Y, a wrong EPSG code, a
coordinate copied from a foreign project — the point lands somewhere the
declared system does not cover, and today it silently appears as a dot in the
sea. This module turns that into an answer a parser can act on: given an EPSG
and ``(x, y)``, is the point ``INSIDE`` the system's area, ``OUTSIDE`` it, or
is the system ``UNKNOWN`` (so the check cannot run and must stay silent)?

The area itself comes from ``pyproj``: every EPSG carries an ``area_of_use``,
a WGS84 longitude/latitude rectangle describing where the system is valid.
That rectangle is projected into the system's own metric coordinates once per
EPSG (cached), giving a bounding box the incoming ``(x, y)`` is compared
against — a pure numeric test per point, no transform in the hot path.

The check is deliberately lenient: the box is padded by
:data:`CRS_BOUNDS_MARGIN_M`, and a system whose area cannot be determined is
reported ``UNKNOWN`` rather than guessed. It exists to catch gross mistakes
without ever second-guessing a valid edge-of-country sounding.
"""

from __future__ import annotations

from enum import StrEnum
from functools import cache

from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError

from groundmodel.infrastructure.parsers.crs_bounds_constants import (
    CRS_BOUNDS_MARGIN_M,
    CRS_BOUNDS_SAMPLES_PER_EDGE,
)


class CrsBoundsResult(StrEnum):
    """Outcome of a CRS-bounds coordinate check.

    Attributes
    ----------
    INSIDE
        The coordinate falls within the declared system's area (plus margin).
    OUTSIDE
        The coordinate falls outside it — a probable swapped X/Y, wrong EPSG,
        or foreign position.
    UNKNOWN
        The check could not run: no EPSG, no coordinate, or a system whose
        ``area_of_use`` ``pyproj`` cannot supply. The caller must stay silent
        so the more specific "no CRS" / "unknown CRS code" findings are not
        doubled.
    """

    INSIDE = "inside"
    OUTSIDE = "outside"
    UNKNOWN = "unknown"


def _linspace(start: float, stop: float, count: int) -> list[float]:
    """Return *count* evenly spaced values from *start* to *stop* inclusive.

    A dependency-free stand-in for ``numpy.linspace`` — this module has no
    other reason to import numpy, and the sample count is tiny.

    Parameters
    ----------
    start, stop : float
        First and last values (both included in the result).
    count : int
        Number of values to return; ``count <= 1`` yields ``[start]``.

    Returns
    -------
    list[float]
        The evenly spaced values.
    """
    if count <= 1:
        return [start]
    step = (stop - start) / (count - 1)
    return [start + step * i for i in range(count)]


@cache
def _projected_area_bounds(epsg: int) -> tuple[float, float, float, float] | None:
    """Return the ``(min_x, min_y, max_x, max_y)`` metric box for *epsg*.

    The box is the projection of the EPSG's WGS84 ``area_of_use`` rectangle
    into the EPSG's own coordinates. Because the rectangle's edges bow under
    projection, they are sampled densely (see
    :data:`CRS_BOUNDS_SAMPLES_PER_EDGE`) rather than taken at the four corners.

    Pure and memoised: the transform runs once per EPSG, then every coordinate
    check for that system is arithmetic. Uses the ``always_xy=True`` transform
    convention shared with the DOV/Lambert-72 transformer so input/output order
    is (easting/longitude, northing/latitude) regardless of authority axis
    order.

    Parameters
    ----------
    epsg : int
        The horizontal EPSG code.

    Returns
    -------
    tuple[float, float, float, float] | None
        ``(min_x, min_y, max_x, max_y)`` in the system's metric units, or
        ``None`` when ``epsg`` is unknown to ``pyproj`` or carries no
        ``area_of_use``.
    """
    try:
        crs = CRS.from_epsg(epsg)
    except CRSError:
        return None
    area = crs.area_of_use
    if area is None:
        return None

    west, south, east, north = area.bounds
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)

    lons = _linspace(west, east, CRS_BOUNDS_SAMPLES_PER_EDGE)
    lats = _linspace(south, north, CRS_BOUNDS_SAMPLES_PER_EDGE)
    # Walk the four edges of the lon/lat rectangle (its extremes, and thus the
    # projected box's extremes, all lie on the boundary for these projections).
    lonlat: list[tuple[float, float]] = []
    lonlat += [(lon, south) for lon in lons]
    lonlat += [(lon, north) for lon in lons]
    lonlat += [(west, lat) for lat in lats]
    lonlat += [(east, lat) for lat in lats]

    xs: list[float] = []
    ys: list[float] = []
    for lon, lat in lonlat:
        x, y = transformer.transform(lon, lat)
        xs.append(x)
        ys.append(y)

    return min(xs), min(ys), max(xs), max(ys)


def classify_coordinates(epsg: int | None, x: float | None, y: float | None) -> CrsBoundsResult:
    """Classify ``(x, y)`` against the area covered by *epsg*.

    Parameters
    ----------
    epsg : int | None
        The declared horizontal EPSG code. ``None`` — or a code ``pyproj``
        cannot resolve, or one with no ``area_of_use`` — yields ``UNKNOWN``.
    x, y : float | None
        The projected coordinate in the system's units. Either being ``None``
        yields ``UNKNOWN``.

    Returns
    -------
    CrsBoundsResult
        ``INSIDE``, ``OUTSIDE``, or ``UNKNOWN``. The margin
        (:data:`CRS_BOUNDS_MARGIN_M`) is added on every side before the
        inside/outside decision.
    """
    if epsg is None or x is None or y is None:
        return CrsBoundsResult.UNKNOWN

    bounds = _projected_area_bounds(epsg)
    if bounds is None:
        return CrsBoundsResult.UNKNOWN

    min_x, min_y, max_x, max_y = bounds
    inside = (
        min_x - CRS_BOUNDS_MARGIN_M <= x <= max_x + CRS_BOUNDS_MARGIN_M
        and min_y - CRS_BOUNDS_MARGIN_M <= y <= max_y + CRS_BOUNDS_MARGIN_M
    )
    return CrsBoundsResult.INSIDE if inside else CrsBoundsResult.OUTSIDE
