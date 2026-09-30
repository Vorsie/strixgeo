"""One row of the lab's per-stage oedometer summary table (lab-derived)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OedometerLabSummaryRow:
    """The lab's derived values for one stage, as printed (pass-through).

    Every field is the lab software's own computation from the readings; it is
    carried for cross-checks, never treated as a measurement.

    Parameters
    ----------
    stage_number : int
        Stage number; 0 is the initial state before loading.
    stress_kpa : float or None
        "Druk" — stage stress, kPa.
    settlement_mm : float or None
        "Dhi" — settlement during the stage, mm.
    height_mm : float or None
        "h" — specimen height at the stage end, mm.
    dry_density_t_m3 : float or None
        "volumemassa droog" — dry density, t/m3.
    void_ratio : float or None
        "e" — void ratio at the stage end.
    lab_coefficient : float or None
        "C (A)" — compression / swelling coefficient.
    av_per_mpa : float or None
        "av" — coefficient of compressibility, 1/MPa.
    mv_per_mpa : float or None
        "mv" — coefficient of volume compressibility, 1/MPa.
    compression_index : float or None
        "Cc" — compression index for the stage.
    """

    stage_number: int
    stress_kpa: float | None
    settlement_mm: float | None
    height_mm: float | None
    dry_density_t_m3: float | None
    void_ratio: float | None
    lab_coefficient: float | None
    av_per_mpa: float | None
    mv_per_mpa: float | None
    compression_index: float | None
