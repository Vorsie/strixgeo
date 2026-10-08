"""PrintedSheetHeader: the text header every sheet of a printed-table sounding carries."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PrintedSheetHeader:
    """What the sheet header says about the sounding, as printed.

    Parameters
    ----------
    report_number : str
        The report number before the dash ("Z1234567"): the GEF-compatible
        project id the sounding is stored under.
    sounding_id : str
        The sounding id after the dash ("CPTE001").
    test_type : str or None
        The ISO 22476 test type ("TE1", "TM4").
    standard : str or None
        The ISO part ("22476-1", "22476-12").
    application_class : str or None
        The ISO application class ("2", "7").
    cpt_type : str or None
        The GEF classification of the printed cone ("CPTE", "CPTM").
    cone : str or None
        The printed cone letter ("E", "M", "U").
    cone_area_cm2 : float or None
        The cone area the cone line names ("CPT-E 15 cm²"); None when it
        names none ("CPT-M M1": the standard cone).
    test_date : str or None
        The test date as printed ("04-07-2022").
    x, y : float or None
        The printed position (its system is named elsewhere in the report).
    groundwater : str or None
        The groundwater remark, verbatim ("Toegeslibd op 2,30 m").
    remark : str or None
        The free remark block, verbatim.
    pre_drill_m : float or None
        The printed pre-drill depth ("voorgeduwd ... tot een diepte van 1 m").
    no_measurement_intervals_m : tuple of tuple of float
        Printed stretches without measurement ("gesloten punt vanaf 30,32 m
        tot 30,34 m"), top first.
    """

    report_number: str
    sounding_id: str
    test_type: str | None = None
    standard: str | None = None
    application_class: str | None = None
    cpt_type: str | None = None
    cone: str | None = None
    cone_area_cm2: float | None = None
    test_date: str | None = None
    x: float | None = None
    y: float | None = None
    groundwater: str | None = None
    remark: str | None = None
    pre_drill_m: float | None = None
    no_measurement_intervals_m: tuple[tuple[float, float], ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        """Return the header as a JSON-ready dict (the provenance)."""
        return {
            "report_number": self.report_number,
            "sounding_id": self.sounding_id,
            "test_type": self.test_type,
            "standard": self.standard,
            "application_class": self.application_class,
            "cpt_type": self.cpt_type,
            "cone_area_cm2": self.cone_area_cm2,
            "test_date": self.test_date,
            "groundwater_remark": self.groundwater,
            "remark": self.remark,
            "pre_drill_m": self.pre_drill_m,
            "no_measurement_intervals_m": [[t, b] for t, b in self.no_measurement_intervals_m],
        }
