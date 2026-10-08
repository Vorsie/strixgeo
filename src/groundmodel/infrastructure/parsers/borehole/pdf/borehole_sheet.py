"""BoreholeSheet: everything read from one borehole-log sheet, in page terms."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_header import (
    BoreholeSheetHeader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.depth_axis import DepthAxis
from groundmodel.infrastructure.parsers.borehole.pdf.level_label import LevelLabel
from groundmodel.infrastructure.parsers.borehole.pdf.sample_mark import SampleMark
from groundmodel.infrastructure.parsers.borehole.pdf.sheet_row import SheetRow
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue


@dataclass
class BoreholeSheet:
    """One sheet: header, the level column, the rows, the samples, the axis.

    Levels are in metres of the sheet's datum; turning them into depths needs
    the borehole's ground level, which the digitiser decides over all sheets.

    Parameters
    ----------
    page_number : int
        1-based page number in the report.
    profile : str
        The layout profile that read it.
    text_source : str
        ``"text"`` (text layer) or ``"ocr"``.
    header : BoreholeSheetHeader
        The printed header fields.
    labels : list of LevelLabel
        The level column, top to bottom.
    rule_ys : list of float
        The description rules, top to bottom (page y).
    rows : list of SheetRow
        The description rows, top to bottom.
    surface_text : str
        Text printed above the first rule in the description column.
    samples : list of SampleMark
        Sample bars with their ids.
    axis : DepthAxis or None
        The depth / elevation axis, when its labels could be fitted.
    columns : dict
        Column positions read (pt): ``label_x0``, ``rule_x0``, ``rule_x1``,
        ``description_x0``, ``bottom_y`` (provenance and overlay).
    issues : list of ValidationIssue
        Findings of this sheet (each names the page).
    """

    page_number: int
    profile: str
    text_source: str
    header: BoreholeSheetHeader
    labels: list[LevelLabel] = field(default_factory=list)
    rule_ys: list[float] = field(default_factory=list)
    rows: list[SheetRow] = field(default_factory=list)
    surface_text: str = ""
    samples: list[SampleMark] = field(default_factory=list)
    axis: DepthAxis | None = None
    columns: dict[str, float] = field(default_factory=dict)
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def name(self) -> str | None:
        """Return the borehole name the sheet prints, if any."""
        return self.header.value("name")

    @property
    def first_level_m(self) -> float | None:
        """Return the first readable level of the sheet (its top boundary)."""
        return next((lab.level_m for lab in self.labels if lab.level_m is not None), None)

    @property
    def last_level_m(self) -> float | None:
        """Return the last readable level of the sheet (its bottom boundary)."""
        return next((lab.level_m for lab in reversed(self.labels) if lab.level_m is not None), None)

    def provenance(self) -> dict[str, Any]:
        """Return what this sheet contributes to a borehole's provenance."""
        return {
            "page": self.page_number,
            "text_source": self.text_source,
            "columns": {k: round(v, 2) for k, v in self.columns.items()},
            "axis": self.axis.to_dict() if self.axis else None,
            "rules": len(self.rule_ys),
            "labels": [lab.text for lab in self.labels],
        }
