"""Result of parsing one local DOV borehole XML file."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_entry import (
    DovBoringFileEntry,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue


@dataclass
class DovBoringFileParseResult:
    """Every boring of one file, plus findings that belong to no single boring.

    Parameters
    ----------
    borings : list[DovBoringFileEntry]
        One entry per ``<boring>``, in file order.
    issues : list[ValidationIssue]
        File-level findings — an interpretation naming a boring the file does
        not hold (INTERPRETATION_WITHOUT_BORING).
    """

    borings: list[DovBoringFileEntry] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)
