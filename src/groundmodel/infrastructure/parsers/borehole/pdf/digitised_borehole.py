"""DigitisedBorehole: one borehole read from a PDF report (header, layers, samples, water)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_header import (
    BoreholePdfHeader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_interval import DigitisedInterval
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_sample import DigitisedSample
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_water_level import (
    DigitisedWaterLevel,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issues_have_errors,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel


@dataclass
class DigitisedBorehole:
    """What the PDF digitiser read for one borehole.

    Kept parallel to ``DovBoringFileEntry`` so phase 2 feeds the same
    file-import use case: ``header`` -> ``Borehole``, ``intervals`` -> the
    layers of one lithological-description ``Observation`` (description
    only, no codes), ``samples`` -> ``Sample`` rows (``sample_number`` =
    ``sample_id``), ``water_levels[0].depth_m`` ->
    ``Borehole.water_table_depth_m``, ``provenance`` -> the stored
    provenance of the import.

    Parameters
    ----------
    key : str
        ``"<name>@p<first page>"`` as the triage listed it.
    header : BoreholePdfHeader
        The merged header.
    intervals : list of DigitisedInterval
        The layers top to bottom, joined over sheets.
    samples : list of DigitisedSample
        Sample marks top to bottom.
    water_levels : list of DigitisedWaterLevel
        Printed water levels.
    provenance : dict
        ``source`` ("pdf-digitised"), ``digitiser_version``,
        ``report_file_name``, ``report_sha256``, ``profile``, ``pages``,
        ``text_sources`` (page -> "text"/"ocr"), ``sheets`` (per-sheet column
        positions, axis fit and labels), ``ocr_available``.
    issues : list of ValidationIssue
        Every finding; each names the page it concerns.
    """

    key: str
    header: BoreholePdfHeader
    intervals: list[DigitisedInterval] = field(default_factory=list)
    samples: list[DigitisedSample] = field(default_factory=list)
    water_levels: list[DigitisedWaterLevel] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    def to_dict(self) -> dict[str, Any]:
        """Return the borehole as a JSON-ready dict."""
        return {
            "key": self.key,
            "header": self.header.to_dict(),
            "intervals": [i.to_dict() for i in self.intervals],
            "samples": [s.to_dict() for s in self.samples],
            "water_levels": [w.to_dict() for w in self.water_levels],
            "provenance": self.provenance,
            "issues": [
                {
                    "level": i.level.value,
                    "code": i.code,
                    "message": i.message,
                    "params": i.params,
                }
                for i in self.issues
            ],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DigitisedBorehole:
        """Return the borehole a :meth:`to_dict` dict describes.

        Parameters
        ----------
        data : dict
            From :meth:`to_dict` (possibly through JSON).

        Returns
        -------
        DigitisedBorehole
            The borehole.
        """
        return cls(
            key=data["key"],
            header=BoreholePdfHeader.from_dict(data["header"]),
            intervals=[DigitisedInterval.from_dict(i) for i in data["intervals"]],
            samples=[DigitisedSample.from_dict(s) for s in data["samples"]],
            water_levels=[DigitisedWaterLevel.from_dict(w) for w in data["water_levels"]],
            provenance=dict(data["provenance"]),
            issues=[
                ValidationIssue(
                    level=ValidationLevel(i["level"]),
                    code=i["code"],
                    message=i["message"],
                    params=dict(i["params"]),
                )
                for i in data["issues"]
            ],
        )
