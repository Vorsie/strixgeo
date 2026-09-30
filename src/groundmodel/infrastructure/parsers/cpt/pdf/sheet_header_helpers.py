"""Pure helpers: turn sounding-block field text into position, datum and date.

The sheet prints its own header ("X-COÖRDINAAT (Lambert72) : 66980.21",
"HOOGTE MAAIVELD 6.02 m TAW", "DATUM 28-2-2024"). These helpers read a value
only when the sheet says it; what it does not say stays None, so the import
asks the user instead of placing a sounding on a guessed system.
"""

from __future__ import annotations

import datetime as dt
import re

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    COORDINATE_SYSTEM_PATTERNS,
    DAY_MONTH_YEAR_PATTERN,
    FIELD_NUMBER_PATTERN,
    ISO_DATE_PATTERN,
    VERTICAL_DATUM_PATTERNS,
)


def last_number(text: str | None) -> float | None:
    """Return the last number in a field value ("(Lambert72) : 66980.21" -> 66980.21).

    Parameters
    ----------
    text : str or None
        A field value.

    Returns
    -------
    float or None
        The number, or None when the value holds none.
    """
    if not text:
        return None
    numbers = FIELD_NUMBER_PATTERN.findall(text)
    if not numbers:
        return None
    return float(numbers[-1].replace("−", "-").replace(",", "."))


def named_epsg(text: str, patterns: tuple[tuple[re.Pattern[str], int], ...]) -> int | None:
    """Return the EPSG of the first system ``text`` names, if any.

    Parameters
    ----------
    text : str
        Page (or label) text.
    patterns : tuple of (compiled pattern, int)
        Pattern -> EPSG, tried in order.

    Returns
    -------
    int or None
        The EPSG code, or None when no system is named.
    """
    for pattern, epsg in patterns:
        if pattern.search(text):
            return epsg
    return None


def horizontal_epsg(text: str) -> int | None:
    """Return the EPSG of the coordinate system a sheet names (Lambert72, RD).

    Parameters
    ----------
    text : str
        The page text.

    Returns
    -------
    int or None
        31370 / 28992, or None when the sheet names no system.
    """
    return named_epsg(text, COORDINATE_SYSTEM_PATTERNS)


def vertical_epsg(text: str) -> int | None:
    """Return the EPSG of the vertical datum a sheet names (TAW, NAP).

    Parameters
    ----------
    text : str
        The page text.

    Returns
    -------
    int or None
        5710 / 5709, or None when the sheet names no datum.
    """
    return named_epsg(text, VERTICAL_DATUM_PATTERNS)


def sheet_date_iso(text: str | None) -> str | None:
    """Return a printed date as ``YYYY-MM-DD``, or None when it is not a date.

    Parameters
    ----------
    text : str or None
        The printed date ("28-2-2024", "31/10/2024", "2024-01-29").

    Returns
    -------
    str or None
        The ISO date; None for text that is not a real calendar date.
    """
    if not text:
        return None
    iso = ISO_DATE_PATTERN.search(text)
    if iso is not None:
        year, month, day = (int(g) for g in iso.groups())
    else:
        dmy = DAY_MONTH_YEAR_PATTERN.search(text)
        if dmy is None:
            return None
        day, month, year = (int(g) for g in dmy.groups())
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None
