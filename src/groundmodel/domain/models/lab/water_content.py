"""Water (moisture) content lab test."""

from dataclasses import dataclass
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class WaterContent(LabTest):
    """Water (moisture) content of a soil sample.

    Reported as percentage of dry mass — i.e. ``w = m_water / m_dry × 100``.
    Note that this exceeds 100 % for organic soils, peats, and some quick
    clays, since the wet sample can hold more water than the dry mass weighs.
    Validation therefore allows values up to 1000 %, rejecting only clearly
    non-physical readings.

    DOV exposes this under ``parametergroep = "Bodem_fysisch_vocht"`` /
    ``parameter = "Vochtgehalte luchtdroge grond (vocht_luchtdroge_grond)"``,
    unit ``g/100g`` (numerically equal to ``%``).

    Parameters
    ----------
    content_pct : float | None
        Water content as percentage of dry mass, in [0, 1000]. ``None`` if
        not measured. Values > 100 are valid for organic / peat / quick clays.
    method : str | None
        Raw source-vocabulary measurement method (DOV examples:
        "Oven drying", "Magnetron"). Translation is a presentation concern.
    test_date : date | None
        Date the test was performed.

    Raises
    ------
    ValueError
        If ``content_pct`` is outside [0, 1000].
    """

    content_pct: float | None = None
    method: str | None = None
    test_date: date | None = None

    def __post_init__(self) -> None:
        if self.content_pct is not None and not 0 <= self.content_pct <= 1000:
            raise ValueError(f"WaterContent.content_pct must be in [0, 1000]: {self.content_pct}")
