"""PdfSoundingImportRequest: one sounding the user ticked for import."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PdfSoundingImportRequest:
    """A ticked sounding plus whatever the user changed in the dialog.

    Every field but ``key`` is optional: left None, the sheet's own value (or
    the digitiser's own calibration) is used.

    Parameters
    ----------
    key : str
        The sounding's key in the triaged report.
    calibrations : list of dict or None
        ``PageCalibration.to_dict()`` per page the user re-calibrated.
    x, y : float or None
        Typed position (when the sheet printed none or the user corrected it).
    epsg : int or None
        Coordinate system of the typed position.
    ground_level_m : float or None
        Typed ground level (also converts an elevation axis to depth).
    test_date : str or None
        Typed test date.
    project_number : str or None
        Typed project number (stored as the CPT's project id); blank = none.
    series_source : str or None
        A printed-table sounding only: ``"table"`` (the default) or ``"graph"``
        (the curve read off its graph sheet, owner 2026-10-12).
    """

    key: str
    calibrations: list[dict[str, Any]] | None = field(default=None)
    x: float | None = None
    y: float | None = None
    epsg: int | None = None
    ground_level_m: float | None = None
    test_date: str | None = None
    project_number: str | None = None
    series_source: str | None = None
