"""Pure helpers: a borehole's ground level over its sheets, and levels to depths.

Both layouts print every boundary as a LEVEL (cm or m TAW); the depth below
ground is ``ground level - level``. The ground level is the one the header
prints; a layout that prints none gives the first level of the first sheet
(the top of the borehole), and the parse says which it used.
"""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_helpers import (
    ground_level,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    DEPTH_DECIMALS,
    GROUND_FROM_FIRST_LEVEL,
    GROUND_FROM_HEADER,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet


def header_value(sheets: Sequence[BoreholeSheet], name: str) -> str | None:
    """Return the first value any sheet prints for a header field.

    Parameters
    ----------
    sheets : sequence of BoreholeSheet
        The borehole's sheets, in order.
    name : str
        Field name.

    Returns
    -------
    str or None
        The value; None when no sheet prints it.
    """
    return next((v for s in sheets if (v := s.header.value(name))), None)


def ground_level_of(
    sheets: Sequence[BoreholeSheet],
) -> tuple[float | None, int | None, str | None]:
    """Return the borehole's ground level, its datum and where it came from.

    Parameters
    ----------
    sheets : sequence of BoreholeSheet
        The borehole's sheets, in order.

    Returns
    -------
    tuple
        ``(level_m, z_epsg, source)``; source ``"header"`` or
        ``"first-level"``; all None when neither is printed.
    """
    for sheet in sheets:
        level, z_epsg = ground_level(sheet.header)
        if level is not None:
            return level, z_epsg, GROUND_FROM_HEADER
    if sheets and sheets[0].first_level_m is not None:
        return sheets[0].first_level_m, None, GROUND_FROM_FIRST_LEVEL
    return None, None, None


def depth_below(ground_m: float | None, level_m: float | None) -> float | None:
    """Return ``ground - level`` rounded to the millimetre, None when either is unknown.

    Parameters
    ----------
    ground_m : float or None
        Ground level.
    level_m : float or None
        A printed boundary level, same datum.

    Returns
    -------
    float or None
        Depth below ground (m).
    """
    if ground_m is None or level_m is None:
        return None
    return round(ground_m - level_m, DEPTH_DECIMALS) + 0.0
