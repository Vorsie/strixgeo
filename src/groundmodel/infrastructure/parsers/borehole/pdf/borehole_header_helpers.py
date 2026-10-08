"""Pure helpers: turn printed header fields into numbers, systems and depths.

A value is read only when the sheet says it (the CPT digitiser's rule): a
position whose coordinate system the sheet does not name keeps its numbers
with no EPSG, a water level whose unit or reference is not printed keeps its
raw text with no depth.
"""

from __future__ import annotations

import re

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


def water_depth_m(label: str, value: str) -> float | None:
    """Return a printed water level as metres below ground, when its unit says so.

    Parameters
    ----------
    label : str
        The printed label ("Grondwaterstand [cm-mv]:").
    value : str
        The printed value ("200").

    Returns
    -------
    float or None
        The depth below ground in metres; None when the label does not name
        both the unit and the below-ground reference (never guessed).
    """
    number = last_number(value)
    if number is None:
        return None
    if _CM_BELOW_GROUND.search(label):
        return round(number / 100.0, 3)
    if _M_BELOW_GROUND.search(label):
        return round(number, 3)
    return None
