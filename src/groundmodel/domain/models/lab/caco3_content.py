"""Calcium carbonate (CaCO3) content lab test."""

from dataclasses import dataclass
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class CaCO3Content(LabTest):
    """Calcium carbonate (lime) content of a soil sample, as percentage of dry mass.

    Often referred to as "lime content" in geotechnical practice. Measured by
    calcimetry (acid digestion + CO2 measurement) or thermogravimetric methods.
    The value is the percentage of CaCO3 by dry mass — distinct from
    ``GrainSize.lime_removed`` which is a *pre-treatment* boolean indicating
    whether lime was chemically stripped before a grain-size test.

    DOV exposes this under ``parametergroep = "Bodem_chemisch"`` /
    ``parameter = "Calciumcarbonaatgehalte (caco3_gehalte)"``, unit ``%``.

    Parameters
    ----------
    content_pct : float | None
        CaCO3 content as percentage of dry mass, in [0, 100]. ``None`` if not
        measured.
    method : str | None
        Raw source-vocabulary measurement method (e.g. "Calcimetrie" =
        calcimetry, "Scheibler"). Translation is a presentation concern.
    test_date : date | None
        Date the test was performed.

    Raises
    ------
    ValueError
        If ``content_pct`` is outside [0, 100].
    """

    content_pct: float | None = None
    method: str | None = None
    test_date: date | None = None

    def __post_init__(self) -> None:
        if self.content_pct is not None and not 0 <= self.content_pct <= 100:
            raise ValueError(f"CaCO3Content.content_pct must be in [0, 100]: {self.content_pct}")
