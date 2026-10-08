"""Pure helpers: turn printed header fields into numbers, systems and depths.

A value is read as the sheet says it. Where the sheet leaves something out,
the owner's 2026-10-08 rulings apply AS ASSUMPTIONS the import asks the user
to confirm, never silently: X/Y without a named system are Lambert 72; a water
level without a unit or a reference is in cm below ground level.
"""

from __future__ import annotations

import re

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    ASSUMED_HORIZONTAL_EPSG,
    ASSUMED_WATER_UNIT_M,
    ASSUMED_WATER_VALUE_PATTERN,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_header import (
    BoreholeSheetHeader,
)
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import (
    horizontal_epsg,
    last_number,
    vertical_epsg,
)

# A water-level label in centimetres below ground ("[cm-mv]", "cm -mv").
_CM_BELOW_GROUND = re.compile(r"cm\s*-?\s*mv", re.IGNORECASE)
# ... in metres below ground ("[m-mv]").
_M_BELOW_GROUND = re.compile(r"(?<![a-z])m\s*-\s*mv", re.IGNORECASE)
# A label that names a reference other than the ground (TAW, NAP): no
# below-ground reading at all.
_OTHER_REFERENCE = re.compile(r"TAW|NAP", re.IGNORECASE)


def coordinates(header: BoreholeSheetHeader) -> tuple[float | None, float | None, int | None]:
    """Return the printed X, Y and the EPSG of the system the labels name.

    Parameters
    ----------
    header : BoreholeSheetHeader
        The sheet's fields.

    Returns
    -------
    tuple
        ``(x, y, epsg)``; ``epsg`` None when neither label names a system.
    """
    x = last_number(header.value("x"))
    y = last_number(header.value("y"))
    labels = " ".join(t for t in (header.label("x"), header.label("y")) if t)
    epsg = horizontal_epsg(labels) if labels else None
    return x, y, epsg


def ground_level(header: BoreholeSheetHeader) -> tuple[float | None, int | None]:
    """Return the printed ground level (m) and the vertical datum it names.

    Parameters
    ----------
    header : BoreholeSheetHeader
        The sheet's fields.

    Returns
    -------
    tuple
        ``(level_m, z_epsg)``; both None when no ground level is printed.
    """
    value = header.value("ground_level")
    level = last_number(value) if value else None
    if level is None:
        # "Maaiveld = +6.01 TAW": the number is followed by the datum word.
        numbers = re.findall(r"[-+]?\d+(?:[.,]\d+)?", value or "")
        level = float(numbers[0].replace(",", ".")) if numbers else None
    text = f"{header.label('ground_level') or ''} {value or ''}"
    return level, (vertical_epsg(text) if level is not None else None)


def assumed_crs(x: float | None, y: float | None, epsg: int | None) -> tuple[int | None, bool]:
    """Return the EPSG of a printed position and whether it is the ruled assumption.

    Parameters
    ----------
    x, y : float or None
        The printed position.
    epsg : int or None
        The system the labels name (None when not named).

    Returns
    -------
    tuple
        ``(epsg, assumed)``: the named system and False; Lambert 72 and True
        for a position printed without a named system (owner 2026-10-08);
        ``(None, False)`` when no position is printed.
    """
    if epsg is not None:
        return epsg, False
    if x is None or y is None:
        return None, False
    return ASSUMED_HORIZONTAL_EPSG, True


def water_depth_m(label: str, value: str) -> tuple[float | None, bool]:
    """Return a printed water level as metres below ground, and whether that was assumed.

    Parameters
    ----------
    label : str
        The printed label ("Grondwaterstand [cm-mv]:", "GWS:").
    value : str
        The printed value ("200").

    Returns
    -------
    tuple
        ``(depth_m, unit_assumed)``. A label naming the unit and the
        below-ground reference reads as printed (assumed False). A label
        naming no reference ("GWS:", "Grondwaterstand in cm'") with a
        digits-only value reads as cm below ground level (assumed True,
        owner 2026-10-08). Anything else (another reference, a value with
        decimals and no unit) gives ``(None, False)``: the raw text stays.
    """
    number = last_number(value)
    if number is None:
        return None, False
    if _CM_BELOW_GROUND.search(label):
        return round(number / 100.0, 3), False
    if _M_BELOW_GROUND.search(label):
        return round(number, 3), False
    if _OTHER_REFERENCE.search(label) or not ASSUMED_WATER_VALUE_PATTERN.match(value):
        return None, False
    # Bare ("GWS: 380") or centimetres without a reference ("in cm': 234"):
    # both read as cm below ground level, flagged as the ruled assumption.
    return round(number * ASSUMED_WATER_UNIT_M, 3), True
