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

    The shape is method-agnostic — it accepts the curves produced by all five
    DOV methods, which differ in particle-size range and resolution:

    * Sieve test (DOV ``methode`` = "Zeving" = "sieving") — discrete sieve
      apertures, ISO series 0.063 mm to ~31.5 mm typical, ~13 entries.
    * Hydrometer / areometer (DOV ``methode`` = "Hydrometer") — derives
      diameters by sedimentation (Stokes' law); covers the fines (< 0.063 mm).
    * Laser diffraction (DOV ``methode`` = "D.m.v. Laserdiffractie" =
      "by means of laser diffraction") — fine bin centers from a
      particle-size analyser; can cover the full range.
    * Pipette method (DOV ``methode`` = "Pipette") — Stokes-law
      sedimentation read by pipetting at calibrated times; classic
      complement to sieve for the fines.
    * Sedigraph (DOV ``methode`` = "Sedigraaf") — X-ray sedimentation
      analyser; another fines technique.

    A single test may combine sieve + hydrometer to span both ends of the
    curve; in that case both source methods are recorded as one combined
    string in ``method`` and the arrays carry the merged curve.

    The ``method`` field is open ``str | None`` — the parser passes the
    source-vocabulary token through verbatim, including hybrid variants
    DOV occasionally ships ("Hydrometer met ijking Geotechniek",
    "Zeving op massa met grootte <= 2mm (fijnkorrelig)", etc.).
    Translation to English happens at the API/UI boundary, never at ingest
    (CLAUDE.md "Data Integrity Rules" + reference_dov_codelists memory).

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
        Five known DOV values: "Zeving" = sieving, "Hydrometer" =
        hydrometer/areometer, "D.m.v. Laserdiffractie" = "by means of
        laser diffraction", "Pipette" = pipette method, "Sedigraaf" =
        sedigraph. Hybrid / method-specific variants ("Hydrometer met
        ijking Geotechniek" etc.) also pass through unchanged.
    test_date : date | None
        Date the test was performed.
    lime_removed : bool | None
        **Pre-treatment flag** — whether lime (CaCO3) was chemically removed
        from the sample BEFORE the grain-size test. This is procedural metadata
        about the test, NOT a measurement of lime content. ``None`` if unknown
        or method-irrelevant (e.g. typically not applied to laser diffraction).
    organics_removed : bool | None
        **Pre-treatment flag** — whether organic matter was removed from the
        sample BEFORE the grain-size test. NOT a measurement of organic
        content. ``None`` if unknown or method-irrelevant.

    Notes
    -----
    Measured contents and other index properties are SEPARATE ``LabTest``
    subclasses on the parent ``Sample``, NOT fields on ``GrainSize``. The ones
    already modelled:

    * :class:`groundmodel.domain.models.lab.caco3_content.CaCO3Content` — lime / CaCO3 content
    * :class:`groundmodel.domain.models.lab.organic_content.OrganicContent`: organic carbon
      and matter
    * :class:`groundmodel.domain.models.lab.atterberg_limits.AtterbergLimits` — LL, PL, derived PI
    * :class:`groundmodel.domain.models.lab.water_content.WaterContent` — moisture content

    Future additions (not yet modelled): bulk density, specific gravity,
    triaxial, direct shear, UCS, oedometer / consolidation, permeability,
    mineralogy.

    DOV exposes all of them through the same ``monster:observaties`` WFS layer
    with different ``parametergroep`` filters, so the ingest plumbing is
    shared with grain size.

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
