"""Pure text helpers shared by the Geosys export parsers (no I/O, no logging)."""

from __future__ import annotations

from groundmodel.infrastructure.parsers.lab.geosys.geosys_constants import (
    GEOSYS_DEPTH_RANGE_RE,
    GEOSYS_NUMBER_RE,
    GEOSYS_VALUE_UNIT_RE,
)


def parse_geosys_number(raw: str | None) -> float | None:
    """Parse a Belgian-locale Geosys number ("0,6700001", "-5,999565E-03").

    Parameters
    ----------
    raw : str or None
        The cell text. Surrounding whitespace is ignored.

    Returns
    -------
    float or None
        The value, or ``None`` for an empty cell.

    Raises
    ------
    ValueError
        When the cell is not empty and not a number in Geosys notation.
    """
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if not GEOSYS_NUMBER_RE.match(text):
        raise ValueError(f"not a Geosys number: {text!r}")
    return float(text.replace(",", "."))


def parse_geosys_value_unit(raw: str | None) -> tuple[float | None, str | None]:
    """Split a header value such as "96,1 kPa" into (96.1, "kPa").

    Parameters
    ----------
    raw : str or None
        The header value text.

    Returns
    -------
    tuple of (float or None, str or None)
        The number and the trailing unit text (``None`` when absent). A value
        that does not start with a number gives ``(None, None)``.
    """
    if raw is None:
        return None, None
    match = GEOSYS_VALUE_UNIT_RE.match(raw)
    if match is None:
        return None, None
    unit = match.group(2).strip() or None
    return float(match.group(1).replace(",", ".")), unit


def parse_geosys_depth_range(raw: str | None) -> tuple[float | None, float | None]:
    """Parse a sampling-depth interval ("14,50-15,00") into (top, base) metres.

    Parameters
    ----------
    raw : str or None
        The interval text.

    Returns
    -------
    tuple of (float or None, float or None)
        Top and base depth; ``(None, None)`` when the text is not an interval.
    """
    if raw is None:
        return None, None
    match = GEOSYS_DEPTH_RANGE_RE.match(raw)
    if match is None:
        return None, None
    return (
        float(match.group(1).replace(",", ".")),
        float(match.group(2).replace(",", ".")),
    )


def blank_to_none(raw: str | None) -> str | None:
    """Return the stripped text, or ``None`` when it is empty.

    Parameters
    ----------
    raw : str or None
        Any header value.

    Returns
    -------
    str or None
        Stripped value, ``None`` for empty / whitespace-only / missing.
    """
    if raw is None:
        return None
    text = raw.strip()
    return text or None
