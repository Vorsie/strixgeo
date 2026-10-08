"""Pure helpers of the printed-table profile: numbers as printed, rounding, gaps."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    MISSING_ROW_STEP_FACTOR,
    PRINTED_NUMBER_PATTERN,
)


def parse_printed_number(text: str) -> tuple[float, int] | None:
    """Return a printed cell's value and how many decimals it was printed with.

    Parameters
    ----------
    text : str
        The cell ("1,01", "-4,43", "0,014", "15,52°").

    Returns
    -------
    tuple or None
        ``(value, decimals)``; None when the cell is not a number.
    """
    match = PRINTED_NUMBER_PATTERN.match(text.strip())
    if match is None:
        return None
    sign = -1.0 if match.group("sign") in ("-", "−") else 1.0
    decimals = match.group("dec") or ""
    value = float(f"{match.group('int')}.{decimals or '0'}")
    return sign * value, len(decimals)


def normalise_column_header(text: str) -> str:
    """Return a column header in the form the profile keys on.

    Parameters
    ----------
    text : str
        The printed header ("Rf, %", "Inclinatie, °", "φ'").

    Returns
    -------
    str
        Lower case, spaces and commas dropped ("rf%", "inclinatie°", "φ'").
    """
    return "".join(ch for ch in text.lower() if not ch.isspace() and ch != ",")


def half_unit(decimals: int) -> float:
    """Return half a unit of the last printed digit (the printed value's rounding).

    Parameters
    ----------
    decimals : int
        Decimals printed.

    Returns
    -------
    float
        ``0.5 * 10 ** -decimals``.
    """
    return 0.5 * 10.0 ** (-decimals)


def rf_outside_rounding(
    qc: float, qc_decimals: int, fs: float, fs_decimals: int, rf: float, rf_decimals: int
) -> bool:
    """Return whether a printed Rf cannot come from its own printed fs and qc.

    Each printed value is the true value rounded to its last digit, so the
    true ``fs / qc * 100`` lies between the ratio of the rounding bounds. A
    printed Rf outside that range (widened by its own rounding) is not the
    ratio of the printed fs and qc: it is flagged, never corrected.

    Parameters
    ----------
    qc, fs, rf : float
        The printed values (MPa, MPa, %).
    qc_decimals, fs_decimals, rf_decimals : int
        Their printed decimals.

    Returns
    -------
    bool
        True when the printed Rf is inconsistent; False when consistent or
        when qc is too small to bound the ratio.
    """
    qc_low = qc - half_unit(qc_decimals)
    if qc_low <= 0:
        return False
    qc_high = qc + half_unit(qc_decimals)
    fs_low = max(fs - half_unit(fs_decimals), 0.0)
    fs_high = fs + half_unit(fs_decimals)
    low = fs_low / qc_high * 100.0
    high = fs_high / qc_low * 100.0
    slack = half_unit(rf_decimals) + 1e-9
    return rf + slack < low or rf - slack > high


def printed_step(depths: Sequence[float]) -> float | None:
    """Return the regular depth step of a printed table (its most common step).

    Parameters
    ----------
    depths : sequence of float
        Row depths, increasing.

    Returns
    -------
    float or None
        The most common step to the centimetre; None for fewer than 2 rows.
    """
    if len(depths) < 2:
        return None
    steps = Counter(round(b - a, 2) for a, b in zip(depths[:-1], depths[1:], strict=True))
    step, _ = max(steps.items(), key=lambda kv: (kv[1], -kv[0]))
    return float(step) if step > 0 else None


def table_chain(
    depths: Sequence[float],
    no_measurement: Sequence[tuple[float, float]],
    step_m: float | None,
) -> np.ndarray:
    """Return a stroke id per row: a new stroke after every missing block of rows.

    The vector path calls a pen lift a drilled stretch (owner ruling "a",
    2026-10-04); a printed table says the same with a missing block of rows
    (a step longer than ``MISSING_ROW_STEP_FACTOR`` printed steps) or with a
    printed stretch without measurement lying between two rows. Either way
    the stroke changes there, so nothing is drawn or interpolated across it.

    Parameters
    ----------
    depths : sequence of float
        Row depths, strictly increasing.
    no_measurement : sequence of tuple of float
        Printed ``(top, base)`` stretches without measurement.
    step_m : float or None
        The table's regular step; None = no missing-row test.

    Returns
    -------
    numpy.ndarray
        Integer stroke id per row, starting at 0.
    """
    chain = np.zeros(len(depths), dtype=int)
    stroke = 0
    for i in range(1, len(depths)):
        above, below = depths[i - 1], depths[i]
        missing = step_m is not None and below - above > MISSING_ROW_STEP_FACTOR * step_m
        unmeasured = any(top < below and base > above for top, base in no_measurement)
        if missing or unmeasured:
            stroke += 1
        chain[i] = stroke
    return chain
