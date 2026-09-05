"""A broken parse must never overwrite a stored CPT — not even when confirmed.

A refresh replaces the stored series with no undo. Confirmation protects the
engineer from a mistake they can see coming (the file is right, the target is
right, they just have to agree). It cannot protect them from a file that
carries nothing worth writing — so the two unusable shapes are refused BEFORE
consent is even asked for:

* a parse with zero data rows (a truncated download, a header-only export);
* a parse with ERROR-level issues (non-monotonic depths, a missing required
  column).

The GEF path happens to reject the zero-row shape one layer earlier (the parser
raises ``ParseError``), but ``persist()`` is also handed already-parsed results
by the DOV importers, which is what this guard is for. Pure — no DB.
"""

from __future__ import annotations

import polars as pl
import pytest

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import CptRefreshRefusedError


def _result(
    rows: list[tuple[float, float]], issues: list[ValidationIssue] | None = None
) -> GEFParseResult:
    """Build a parse result with the given rows and issues.

    Parameters
    ----------
    rows : list[tuple[float, float]]
        ``(depth_m, qc_mpa)`` pairs; empty for the zero-row case.
    issues : list[ValidationIssue] | None, optional
        Validation findings to attach.

    Returns
    -------
    GEFParseResult
        A result usable by the guard under test.
    """
    return GEFParseResult(
        header=GEFHeader(),
        cpt_type=CPTType.CPTU,
        data=pl.DataFrame(
            {"depth_m": [r[0] for r in rows], "qc_mpa": [r[1] for r in rows]},
            schema={"depth_m": pl.Float64, "qc_mpa": pl.Float64},
        ),
        issues=issues or [],
    )


def _use_case() -> ImportCpt:
    """Return an ImportCpt whose session the pure guard never touches."""
    return ImportCpt(None)  # type: ignore[arg-type]


def test_a_parse_with_no_rows_is_refused_with_a_named_reason() -> None:
    """Zero rows cannot replace real measurements — reason ``no_rows``."""
    with pytest.raises(CptRefreshRefusedError) as err:
        _use_case()._refuse_unusable_refresh(_result([]), "CPT-1")
    assert err.value.reason == "no_rows"
    assert "CPT-1" in str(err.value)


def test_a_parse_with_error_issues_is_refused_with_a_named_reason() -> None:
    """An ERROR-level parse cannot replace real measurements — ``parse_errors``."""
    issues = [
        ValidationIssue(ValidationLevel.ERROR, "DEPTH_NOT_MONOTONIC", "depths go backwards"),
        ValidationIssue(ValidationLevel.WARNING, "NEGATIVE_QC", "one negative qc"),
    ]
    with pytest.raises(CptRefreshRefusedError) as err:
        _use_case()._refuse_unusable_refresh(_result([(0.2, 1.0)], issues), "CPT-1")
    assert err.value.reason == "parse_errors"
    # The message has to name the defect, not just say "broken".
    assert "DEPTH_NOT_MONOTONIC" in str(err.value)


def test_a_warning_only_parse_is_allowed_through() -> None:
    """Warnings are normal on real files — they must not block a refresh."""
    issues = [ValidationIssue(ValidationLevel.WARNING, "NEGATIVE_QC", "one negative qc")]
    _use_case()._refuse_unusable_refresh(_result([(0.2, 1.0)], issues), "CPT-1")
