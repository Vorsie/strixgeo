"""The ONE representative-qc statistic every NAD reader goes through.

Owner ruling 7 (docs/debt.md #227, 2026-08-01): the representative statistic
is SELECTABLE per geotech model — median (today's, chosen as spike-robust),
arithmetic, harmonic, geometric. They are ordered
harmonic <= geometric <= arithmetic for the same positive series, so the
choice systematically shifts classes; harmonic is the conservative one,
weighted toward the low values that govern bearing and settlement.

Ruling 6 makes single-sourcing load-bearing: the band-edit warning "MUST be
computed with the same statistic the classifier reads, or it predicts a
reclassification that does not happen". The subdivision classifier
(``geotech_subdivision``) and the band-edit planners
(``geotech_band_reclassification``) therefore BOTH call
:func:`representative_qc` with the model's stored choice — never a local
``median(...)``.

Zero rule: a ``0.0`` qc reading is a VALID loosest-class value (owner rule
2026-07-25 — bad-qc sentinels are filtered upstream by ``_is_valid_qc``).
``statistics.harmonic_mean`` returns ``0.0`` natively when a zero is present;
``statistics.geometric_mean`` raises, so it is guarded here to the same
conservative ``0.0``. Negative values never reach this module.

Pure: no I/O, no ORM, no logging.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from typing import Final

# The four owner-approved tokens; also the CHECK-constraint vocabulary on
# geological_model.representative_statistic (migration 9f8e7d6c5b4a).
REPRESENTATIVE_STATISTICS: Final[tuple[str, ...]] = (
    "median",
    "arithmetic",
    "harmonic",
    "geometric",
)

# Median stays the default: spike-robust against thin-lens qc excursions, and
# the statistic every band classified before ruling 7 shipped was derived with.
DEFAULT_STATISTIC: Final[str] = "median"


def representative_qc(values: Sequence[float], statistic: str) -> float:
    """Reduce a qc series to its representative value under *statistic*.

    Parameters
    ----------
    values : Sequence[float]
        Valid qc readings (MPa) over one interval — non-empty, non-negative
        (upstream filtering guarantees both).
    statistic : str
        One of :data:`REPRESENTATIVE_STATISTICS`.

    Returns
    -------
    float
        The representative qc in MPa. A series containing ``0.0`` returns
        ``0.0`` under ``'harmonic'`` and ``'geometric'`` (the conservative
        loosest-class answer).

    Raises
    ------
    ValueError
        When *statistic* is not one of the four known tokens — a programming
        error surfaced loudly, never silently defaulted.
    """
    if statistic == "median":
        return statistics.median(values)
    if statistic == "arithmetic":
        return statistics.fmean(values)
    if statistic == "harmonic":
        return statistics.harmonic_mean(values)
    if statistic == "geometric":
        # geometric_mean raises on zero; harmonic's native 0.0 answer is the
        # conservative behaviour both low-sensitive statistics share.
        if any(v == 0.0 for v in values):
            return 0.0
        return statistics.geometric_mean(values)
    raise ValueError(
        f"Unknown representative statistic {statistic!r} — expected one of "
        f"{REPRESENTATIVE_STATISTICS}"
    )
