"""Organic content lab test — organic carbon and/or organic matter percentages."""

from dataclasses import dataclass
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class OrganicContent(LabTest):
    """Organic content of a soil sample.

    OC and OM are easy to confuse but they are **different measurements of
    different things, by different methods**:

    * **Organic carbon (OC, ``carbon_pct``)** — the mass of elemental carbon
      that lives inside the organic fraction, expressed as % of total dry mass.
      Measured by combustion or chromic-acid oxidation (Walkley-Black, dry
      combustion). DOV's ``Organische C - percentage`` parameter is OC.
    * **Organic matter (OM, ``matter_pct``)** — the total mass of organic
      substances (carbon + hydrogen + oxygen + nitrogen + …) expressed as % of
      total dry mass. Measured directly by Loss on Ignition (burn the sample at
      ~550 °C; the mass that disappears is the organic matter).

    Numerically they differ because organic matter contains many elements
    besides carbon. The Van Bemmelen factor ``OM ≈ 1.724 × OC`` is the textbook
    conversion (it assumes organic matter is ~58 % carbon by mass), but the
    actual ratio varies materially with soil type — peats range ~1.6–1.9, soft
    organic clays differ again — so the conversion is empirical, not exact.

    Practical consequence: a lab may report only OC, only OM, or both. We
    store the two as **independent** fields and refuse to silently derive one
    from the other; auto-conversion would fabricate data and the consumer
    couldn't distinguish a measured value from a derived one.

    DOV path for organic carbon: ``parametergroep = "Bodem_chemisch"`` /
    ``parameter = "Organische C - percentage (organische_c_perc)"``, unit ``%``.

    Parameters
    ----------
    carbon_pct : float | None
        Organic carbon (OC) as percentage of dry mass, in [0, 100]. ``None``
        if not measured.
    matter_pct : float | None
        Organic matter (OM) as percentage of dry mass, in [0, 100]. ``None``
        if not measured. Do NOT silently fill from ``carbon_pct`` — if the lab
        only reported OC, leave OM as ``None`` so consumers know it was not
        measured directly.
    method : str | None
        Raw source-vocabulary measurement method (e.g. "Loss on ignition",
        "Walkley-Black", "Dry combustion"). Different methods can give
        materially different results, so the method is part of the record.
    test_date : date | None
        Date the test was performed.

    Raises
    ------
    ValueError
        If ``carbon_pct`` or ``matter_pct`` is outside [0, 100].
    """

    carbon_pct: float | None = None
    matter_pct: float | None = None
    method: str | None = None
    test_date: date | None = None

    def __post_init__(self) -> None:
        if self.carbon_pct is not None and not 0 <= self.carbon_pct <= 100:
            raise ValueError(f"OrganicContent.carbon_pct must be in [0, 100]: {self.carbon_pct}")
        if self.matter_pct is not None and not 0 <= self.matter_pct <= 100:
            raise ValueError(f"OrganicContent.matter_pct must be in [0, 100]: {self.matter_pct}")
