"""Oedometer vertical strain epsilon_v = delta_h / h0 (owner 2026-09-29).

The owner asked for "delta_h/h0 from il-oedometer": the vertical strain of the
incremental-loading oedometer, computed by Strix from the MEASURED cumulative
settlement and the specimen's initial height. It is a characterisation output
(the strain axis of a compression curve), not a design parameter.

delta_h is the cumulative settlement since the start of the test, as the
export lists it; that column already bridges a dial-gauge re-zero, so the
strain is continuous across it without any repair here.
"""

from __future__ import annotations

from collections.abc import Sequence


def vertical_strain(
    cumulative_settlement_mm: Sequence[float | None], h0_mm: float | None
) -> list[float | None]:
    """Return epsilon_v = delta_h / h0 for every reading.

    Parameters
    ----------
    cumulative_settlement_mm : Sequence[float or None]
        Settlement since the start of the test, mm (compression positive).
        ``None`` marks an unreadable reading.
    h0_mm : float or None
        The initial specimen height, mm.

    Returns
    -------
    list[float or None]
        The dimensionless vertical strain per reading; ``None`` where the
        settlement is ``None``.

    Raises
    ------
    ValueError
        When ``h0_mm`` is missing or not positive — there is no strain without
        a height, and a zero would divide by zero.
    """
    if h0_mm is None or h0_mm <= 0:
        raise ValueError(f"initial height must be positive to compute strain, got {h0_mm!r}")
    return [None if dh is None else dh / h0_mm for dh in cumulative_settlement_mm]
