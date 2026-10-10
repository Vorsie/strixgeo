"""PdfBoreholeImportEntry: one digitised borehole shaped for the borehole import."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_file_sample import DovFileSample
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issues_have_errors,
)


@dataclass
class PdfBoreholeImportEntry:
    """A ``DigitisedBorehole`` in the shapes the borehole ORM builders persist.

    The PDF twin of ``DovBoringFileEntry``: the same builders write it, so a
    borehole read off a PDF and one read from a DOV XML file are the same rows.

    Parameters
    ----------
    key : str
        The triage key (``"<name>@p<first page>"``).
    project_id : str
        Source project id of the dedup key: the printed project code, else
        ``"PDF"``.
    test_id : str
        The printed borehole name: with ``project_id`` the dedup key.
    name : str
        Display name (the printed name).
    borehole_key : UUID
        Id of a new row (a refresh keeps the stored id).
    borehole : BoreholeParseResult or None
        Header (no drill segments, no field log); None when the sheets print
        no position (the borehole cannot be stored).
    observation : Observation or None
        The lithological description, one layer per interval with its
        description verbatim and no codes; None when no interval has depths.
    samples : list of DovFileSample
        The sample bars as drawn (id verbatim in ``sample_number``).
    sample_labels : dict
        ``sample_key`` -> the printed sample number before the dash ("S10").
    provenance : dict
        What ``borehole.import_provenance`` stores.
    issues : list of ValidationIssue
        The parse findings plus the import flags.
    blocked : bool
        True when the read leaves nothing to store (no position or no ground
        level).
    """

    key: str
    project_id: str
    test_id: str
    name: str
    borehole_key: UUID
    borehole: BoreholeParseResult | None
    observation: Observation | None
    samples: list[DovFileSample] = field(default_factory=list)
    sample_labels: dict[UUID, str | None] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    issues: list[ValidationIssue] = field(default_factory=list)
    blocked: bool = False

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def n_layers(self) -> int:
        """Return how many description layers the entry stores."""
        return len(self.observation.layers) if self.observation is not None else 0
