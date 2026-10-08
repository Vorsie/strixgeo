"""Pure check of a printed position against its coordinate system's extent."""

from __future__ import annotations

from groundmodel.infrastructure.parsers.cpt.pdf.coordinate_extent_constants import (
    COORDINATE_EXTENTS_M,
)


def position_outside_extent(x: float, y: float, epsg: int | None) -> bool:
    """Return True when (x, y) lies outside the known extent of ``epsg``.

    Parameters
    ----------
    x, y : float
        The printed position in metres.
    epsg : int or None
        The coordinate system of the position.

    Returns
    -------
    bool
        True only for a system with a known extent and a position outside it;
        a system without an extent in ``COORDINATE_EXTENTS_M`` is never flagged.
    """
    extent = COORDINATE_EXTENTS_M.get(epsg) if epsg is not None else None
    if extent is None:
        return False
    x_min, x_max, y_min, y_max = extent
    return not (x_min <= x <= x_max and y_min <= y <= y_max)
