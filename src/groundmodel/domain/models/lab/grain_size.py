"""Grain size distribution lab test."""

from dataclasses import dataclass, field
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class GrainSize(LabTest):
    """Grain size distribution from any size-distribution analysis method.

    Stores the cumulative grain-size curve as two parallel arrays. Each entry
    pairs a particle diameter with the percentage of sample mass having a
    diameter LARGER than that diameter — i.e. cumulative %-oversize, not
    %-passing. DOV labels this "Fractie met grotere diameter" = "fraction with
    larger diameter". Convert to %-passing at the consumer if needed.

    The shape is method-agnostic — it accepts the curves produced by all three
    DOV methods, which differ in particle-size range and resolution:

    * Sieve test (DOV ``methode`` = "Zeving") — discrete sieve apertures, ISO
      series 0.063 mm to ~31.5 mm typical, ~13 entries.
    * Hydrometer / areometer (DOV ``methode`` = "Hydrometer") — derives
      diameters by sedimentation (Stokes' law); covers the fines (< 0.063 mm).
    * Laser diffraction (DOV ``methode`` = "D.m.v. Laserdiffractie") — fine
      bin centers from a particle-size analyser; can cover the full range.

    A single test may combine sieve + hydrometer to span both ends of the
    curve; in that case both source methods are recorded as one combined
    string in ``method`` and the arrays carry the merged curve.

    Parameters
    ----------
    diameters_mm : list[float]
        Particle diameters in millimetres, strictly ascending. For sieve tests
        these are the aperture sizes; for hydrometer/laser these are the
        instrument-reported particle diameters at each measurement.
    pct_larger : list[float]
        Cumulative mass percentage with diameter LARGER than the corresponding
        ``diameters_mm`` entry, in 0–100. Maps directly to DOV's "Fractie met
        grotere diameter".
    method : str | None
        Raw source-vocabulary measurement method (passed through unmodified).
        DOV examples: "Zeving" = sieving, "Hydrometer" = hydrometer/areometer,
        "D.m.v. Laserdiffractie" = "by means of laser diffraction".
        Translation to a UI label is a presentation concern.
    test_date : date | None
        Date the test was performed.
    lime_removed : bool | None
        Whether lime (CaCO3) was removed before testing. ``None`` if unknown
        or method-irrelevant (e.g. typically not applied to laser diffraction).
    organics_removed : bool | None
        Whether organic matter was removed before testing. ``None`` if unknown
        or method-irrelevant.

    Raises
    ------
    ValueError
        If ``diameters_mm`` and ``pct_larger`` have different lengths,
        if any percentage is outside 0–100,
        or if diameters are not strictly ascending.
    """

    diameters_mm: list[float] = field(default_factory=list)
    pct_larger: list[float] = field(default_factory=list)
    method: str | None = None
    test_date: date | None = None
    lime_removed: bool | None = None
    organics_removed: bool | None = None

    def __post_init__(self) -> None:
        if len(self.diameters_mm) != len(self.pct_larger):
            raise ValueError(
                f"GrainSize diameter and percentage arrays length mismatch: "
                f"{len(self.diameters_mm)} vs {len(self.pct_larger)}"
            )
        for pct in self.pct_larger:
            if pct < 0 or pct > 100:
                raise ValueError(f"GrainSize percentage must be in [0, 100]: {pct}")
        for prev, curr in zip(self.diameters_mm, self.diameters_mm[1:], strict=False):
            if curr <= prev:
                raise ValueError(
                    f"GrainSize diameters_mm must be strictly ascending: {prev} >= {curr}"
                )
