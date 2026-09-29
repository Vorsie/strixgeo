"""SeriesScore: how far a digitised series is from a reference series."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SeriesScore:
    """Error statistics of a digitised series against a reference (a GEF).

    Parameters
    ----------
    n : int
        Grid points compared (both series present, not excluded).
    rms : float
        Root-mean-square error at zero depth offset (value units).
    max_abs : float
        Largest absolute error at zero offset.
    best_offset_m : float
        Depth shift that, ADDED to the digitised depths, minimises the RMS.
        A clearly non-zero value means the depth calibration is off.
    rms_at_best_offset : float
        RMS after that shift.
    excluded : int
        Grid points left out (clipped values and the like).
    """

    n: int
    rms: float
    max_abs: float
    best_offset_m: float
    rms_at_best_offset: float
    excluded: int = 0
