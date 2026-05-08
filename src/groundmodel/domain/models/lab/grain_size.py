"""Grain size distribution lab test."""

from dataclasses import dataclass, field
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class GrainSize(LabTest):
    """Grain size distribution from a sieve and/or hydrometer analysis.

    Stores the cumulative grain-size curve as two parallel arrays. Each entry
    pairs a sieve aperture diameter with the percentage of sample mass having a
    diameter LARGER than that sieve — i.e. % retained on the sieve, not %
    passing. (DOV labels this "Fractie met grotere diameter" — fraction with
    larger diameter.) Convert to %-passing at the consumer if needed.

    Parameters
    ----------
    sieve_diameters_mm : list[float]
        Sieve aperture diameters in millimetres, strictly ascending.
    pct_retained : list[float]
        Mass percentage retained on each corresponding sieve, in 0–100.
    method : str | None
        Source-vocabulary measurement method
        (DOV ``methode``: "Zeving" = sieving, "Sedimentatie" = hydrometer, ...).
    test_date : date | None
        Date the test was performed.
    lime_removed : bool | None
        Whether lime (CaCO3) was removed before sieving. ``None`` if unknown.
    organics_removed : bool | None
        Whether organic matter was removed before sieving. ``None`` if unknown.

    Raises
    ------
    ValueError
        If the sieve and percentage arrays have different lengths,
        if any percentage is outside 0–100,
        or if sieve diameters are not strictly ascending.
    """

    sieve_diameters_mm: list[float] = field(default_factory=list)
    pct_retained: list[float] = field(default_factory=list)
    method: str | None = None
    test_date: date | None = None
    lime_removed: bool | None = None
    organics_removed: bool | None = None

    def __post_init__(self) -> None:
        if len(self.sieve_diameters_mm) != len(self.pct_retained):
            raise ValueError(
                f"GrainSize sieve and percentage arrays length mismatch: "
                f"{len(self.sieve_diameters_mm)} vs {len(self.pct_retained)}"
            )
        for pct in self.pct_retained:
            if pct < 0 or pct > 100:
                raise ValueError(f"GrainSize percentage must be in [0, 100]: {pct}")
        for prev, curr in zip(self.sieve_diameters_mm, self.sieve_diameters_mm[1:], strict=False):
            if curr <= prev:
                raise ValueError(
                    f"GrainSize sieve_diameters_mm must be strictly ascending: {prev} >= {curr}"
                )
