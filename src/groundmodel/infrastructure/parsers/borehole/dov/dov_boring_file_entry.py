"""One boring parsed out of a local DOV borehole XML file."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_file_interpretation import (
    DovFileInterpretation,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_file_sample import DovFileSample
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issues_have_errors,
)


@dataclass
class DovBoringFileEntry:
    """A boring from a local DOV file, with every interpretation that names it.

    Parameters
    ----------
    test_id : str
        DOV ``identificatie`` — the identity (``project_id="DOV"`` +
        ``test_id``), the same key the bbox import stores, so a file import and
        a bbox import of one boring meet on the same row.
    name : str
        Display name: the ``alternatieve_naam`` when DOV has one, else the
        identificatie.
    permkey : str | None
        The boring's DOV permkey (``dataidentifier/permkey``).
    borehole_key : UUID
        Provisional id the interpretations were parsed against; the use case
        uses it as the new borehole's id (a refresh maps it to the existing
        row's id instead).
    borehole : BoreholeParseResult
        Header + drill segments + field log from the boring parser.
    interpretations : list[DovFileInterpretation]
        Every interpretation of this boring in the file; the primary
        lithological description first.
    issues : list[ValidationIssue]
        Every finding for this boring: the boring parser's, the stream
        parsers', and the file-import flags. Each message names the boring.
    samples : list[DovFileSample]
        The ``<monster>`` elements of the file that name this boring and carry
        a depth interval, in file order.
    """

    test_id: str
    name: str
    permkey: str | None
    borehole_key: UUID
    borehole: BoreholeParseResult
    interpretations: list[DovFileInterpretation] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)
    samples: list[DovFileSample] = field(default_factory=list)

    @property
    def primary_lithology(self) -> DovFileInterpretation | None:
        """Return the lithological description the import uses, or None."""
        return next(
            (
                i
                for i in self.interpretations
                if i.is_primary and i.observation_type == ObservationType.LITHOLOGICAL_DESCRIPTION
            ),
            None,
        )

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)
