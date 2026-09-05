"""Result container for a completed borehole parse — analogous to GEFParseResult."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.domain.models.borehole.drill_segment import DrillSegment
from groundmodel.domain.models.borehole.field_log_interval import FieldLogInterval
from groundmodel.infrastructure.parsers.validation.validation_issue import (
    ValidationIssue,
    issue_warnings,
    issues_have_errors,
)


@dataclass
class BoreholeParseResult:
    """Result of parsing a single DOV ``boring`` XML body.

    Carries the borehole header plus the two interval collections that live
    inside the XML's ``<details>`` block (drill segments + field log). Things
    that don't live in the XML — the WFS-row drill_method summary, the
    ``app_project_id``, the observation streams pulled from separate
    interpretation XMLs, the lab samples pulled from grondmonsters WFS — are
    merged in at the orchestration layer (``ImportBoreholeDov``, Phase C). The
    parser stays single-responsibility: bytes in, structured borehole data
    out.

    Mirrors ``GEFParseResult`` deliberately: same shape, same
    ``has_errors`` / ``warnings`` properties, same ``issues`` list of
    ``ValidationIssue``. Reusing the validation primitives keeps a single
    issue model across both ingestion pipelines so the API can render a
    single union of validation findings without translating between two
    schemas.

    Parameters
    ----------
    borehole : Borehole
        Domain entity assembled from the boring XML header. ``drill_method``
        (the WFS-row summary) is left ``None`` here — the orchestrator fills
        it from the WFS feature row.
    drill_segments : list[DrillSegment]
        One entry per interval in ``<details>/<boormethode>``. Source-ordered
        along ``top_m``.
    field_log : list[FieldLogInterval]
        Driller's per-interval observations from the ``<kleur>``,
        ``<vochtgehalte>``, and ``<consistentie>`` children of ``<details>``.
        Mixed kinds in one list — discriminated by ``FieldLogInterval.kind``.
    issues : list[ValidationIssue]
        Validation findings produced during parsing — missing coordinates,
        invalid intervals, absent depth, etc.

    Notes
    -----
    Per CLAUDE.md "Data Integrity Rules" §5, cross-field invariants
    (``Borehole.total_depth_m`` vs ``max(drill_segments.base_m)``,
    field-log intervals within ``[0, total_depth_m]``, …) are flagged as
    ``ValidationIssue`` rather than raised — the domain has to accept the
    occasionally-messy real-world data so the rest of the pipeline can run.
    """

    borehole: Borehole
    drill_segments: list[DrillSegment] = field(default_factory=list)
    field_log: list[FieldLogInterval] = field(default_factory=list)
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR severity."""
        return issues_have_errors(self.issues)

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Return all WARNING-level issues."""
        return issue_warnings(self.issues)
