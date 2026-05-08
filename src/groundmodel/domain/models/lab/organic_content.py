"""Organic content lab test — organic carbon and/or organic matter percentages."""

from dataclasses import dataclass
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class OrganicContent(LabTest):
    """Organic content of a soil sample.

    Two related but distinct quantities are stored as separate fields because
    DOV (and many labs) report them independently:

    * **Organic carbon (OC)** — measured by dry/wet combustion or chromic acid
      oxidation; this is what DOV's ``Organische C - percentage`` parameter
      contains.
    * **Organic matter (OM)** — total organic content, typically measured by
      loss on ignition (LOI). Often estimated from OC via the Van Bemmelen
      factor (``OM ≈ 1.724 × OC``), but the conversion is empirical and
      soil-type-dependent, so we keep both fields independent and let the
      caller decide whether to derive one from the other.

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
