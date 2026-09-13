"""Behavioural tests for ``GaplessBuildReportAssembler`` — the seven-clause gate.

Comments are phrased in the clause's own vocabulary (a promise kept / broken)
rather than dict-key terms, since that is what the assembler exists to say
plainly to the engineer.
"""

from __future__ import annotations

from uuid import uuid4

from groundmodel.application.gapless_build_report_assembler import GaplessBuildReportAssembler
from groundmodel.application.gapless_clause_constants import (
    GAPLESS_CLAUSE_ORDER,
    GAPLESS_CLAUSE_TITLES,
    NO_2D_CLAUSES_REASON,
    NO_GRID_REASON,
)
from groundmodel.domain.services.voxel_litho.voxel_types import LabelReport, SectionReconciliation

_MODEL_ID = uuid4()


def _clean_2d_clauses() -> list[dict]:
    """A renderer payload where all four 2-D clauses passed."""
    return [
        {"key": "area-conservation", "status": "pass", "entries": []},
        {"key": "edge-reach", "status": "pass", "entries": []},
        {"key": "cause-closure", "status": "pass", "entries": []},
        {"key": "section-closure", "status": "pass", "entries": []},
    ]


def _clean_label_report() -> LabelReport:
    """A LabelReport with nothing to complain about (clauses 5+6 pass)."""
    return LabelReport(in_footprint_columns=100, empty_in_footprint_columns=0)


def _clean_reconciliation() -> tuple[SectionReconciliation, ...]:
    """A SectionReconciliation where the 3-D model matches its section exactly."""
    return (
        SectionReconciliation(
            section_index=0,
            start_x=0.0,
            start_y=0.0,
            end_x=10.0,
            end_y=0.0,
            swept_2d_m2=100.0,
            swept_3d_m2=100.0,
            budget_m2=1.0,
            divergence_m2=0.0,
            allowance_m2=6.0,
            violated=False,
            worst_sample_along_m=5.0,
            worst_sample_divergence_m=0.0,
            samples_outside_footprint=0,
            samples_total=4,
        ),
    )


def test_all_seven_clauses_are_always_present_and_in_order() -> None:
    """A clean build's report still names every one of the seven clauses."""
    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=_clean_label_report(),
        reconciliations=_clean_reconciliation(),
    )

    assert [c["key"] for c in report["clauses"]] == list(GAPLESS_CLAUSE_ORDER)
    assert [c["number"] for c in report["clauses"]] == list(range(1, 8))


def test_a_renderer_clause_is_restamped_with_the_backend_title() -> None:
    """The renderer sends substance only; the backend supplies number + title."""
    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=_clean_label_report(),
        reconciliations=_clean_reconciliation(),
    )

    area = next(c for c in report["clauses"] if c["key"] == "area-conservation")
    assert area["number"] == 1
    assert area["title"] == GAPLESS_CLAUSE_TITLES["area-conservation"]


def test_missing_2d_input_reports_four_not_evaluated_clauses() -> None:
    """No renderer payload at all (a litho build) — clauses 1-4 say honestly why."""
    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=None,
        label_report=_clean_label_report(),
        reconciliations=_clean_reconciliation(),
    )

    two_d = [
        c
        for c in report["clauses"]
        if c["key"] in {"area-conservation", "edge-reach", "cause-closure", "section-closure"}
    ]
    assert len(two_d) == 4
    for clause in two_d:
        assert clause["status"] == "not-evaluated"
        assert clause["not_evaluated_reason"] == NO_2D_CLAUSES_REASON


def test_no_grid_reports_three_not_evaluated_3d_clauses() -> None:
    """The checksum-skip path never labels a grid — clauses 5-7 say so, not pass."""
    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=None,
        reconciliations=None,
    )

    three_d = [
        c
        for c in report["clauses"]
        if c["key"] in {"column-totality", "stack-voids", "section-reconciliation"}
    ]
    assert len(three_d) == 3
    for clause in three_d:
        assert clause["status"] == "not-evaluated"
        assert clause["not_evaluated_reason"] == NO_GRID_REASON
    assert report["verdict"] == "incomplete"


def test_a_fully_measured_clean_build_passes() -> None:
    """Every clause measured and kept: the verdict is a clean pass."""
    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=_clean_label_report(),
        reconciliations=_clean_reconciliation(),
    )

    assert report["verdict"] == "pass"
    assert all(c["status"] == "pass" for c in report["clauses"])


def test_any_failed_clause_makes_the_whole_verdict_fail() -> None:
    """Clause 5 broken (an empty in-footprint column) fails the whole report."""
    broken_report = LabelReport(in_footprint_columns=50, empty_in_footprint_columns=3)

    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=broken_report,
        reconciliations=_clean_reconciliation(),
    )

    assert report["verdict"] == "fail"
    column_totality = next(c for c in report["clauses"] if c["key"] == "column-totality")
    assert column_totality["status"] == "fail"
    assert len(column_totality["entries"]) == 1
    assert "3" in column_totality["entries"][0]["label"]


def test_a_hairline_void_is_not_something_the_engineer_can_act_on() -> None:
    """A 15-34 mm interior void is snap-round residue, not a hole to report.

    Owner finding (installer #35, project fhdh): clause 6 flagged "4 column
    stacks carry an interior void over 15 mm, worst 33.5 mm".  A void that small
    is below the voxel height and below anything an engineer can see or act on,
    so the clause must PASS and merely note the residue, not report a violation.
    """
    residue_only = LabelReport(
        in_footprint_columns=100,
        empty_in_footprint_columns=0,
        hairline_gaps_over_limit=4,
        hairline_gaps_actionable=0,
        hairline_worst_m=0.0335,
    )

    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=residue_only,
        reconciliations=_clean_reconciliation(),
    )

    stack_voids = next(c for c in report["clauses"] if c["key"] == "stack-voids")
    assert stack_voids["status"] == "pass"
    assert report["verdict"] == "pass"


def test_an_interior_void_the_engineer_can_act_on_still_fails() -> None:
    """A void at or above the action threshold is a real hole and must be reported."""
    real_hole = LabelReport(
        in_footprint_columns=100,
        empty_in_footprint_columns=0,
        hairline_gaps_over_limit=5,
        hairline_gaps_actionable=2,
        hairline_worst_m=0.60,
    )

    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=real_hole,
        reconciliations=_clean_reconciliation(),
    )

    stack_voids = next(c for c in report["clauses"] if c["key"] == "stack-voids")
    assert stack_voids["status"] == "fail"
    assert len(stack_voids["entries"]) == 1
    assert "2" in stack_voids["entries"][0]["label"]


def test_an_unevaluated_clause_with_no_failure_is_incomplete_not_pass() -> None:
    """Nothing failed, but a 2-D clause is missing: the verdict must not read clean."""
    partial_2d = _clean_2d_clauses()[:3]  # section-closure missing

    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=partial_2d,
        label_report=_clean_label_report(),
        reconciliations=_clean_reconciliation(),
    )

    assert report["verdict"] == "incomplete"


def test_a_violated_section_reconciliation_names_the_section_by_index_and_endpoints() -> None:
    """Clause 7 identifies a section by payload index + line endpoints, never a guess."""
    violated = (
        SectionReconciliation(
            section_index=2,
            start_x=100.0,
            start_y=200.0,
            end_x=150.0,
            end_y=250.0,
            swept_2d_m2=50.0,
            swept_3d_m2=10.0,
            budget_m2=1.0,
            divergence_m2=40.0,
            allowance_m2=3.5,
            violated=True,
            worst_sample_along_m=12.5,
            worst_sample_divergence_m=8.0,
            samples_outside_footprint=0,
            samples_total=4,
        ),
    )

    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=_clean_2d_clauses(),
        label_report=_clean_label_report(),
        reconciliations=violated,
    )

    clause = next(c for c in report["clauses"] if c["key"] == "section-reconciliation")
    assert clause["status"] == "fail"
    label = clause["entries"][0]["label"]
    assert "section 2" in label
    assert "100.0, 200.0" in label
    assert "150.0, 250.0" in label
    assert "12.5" in label  # worst sample's along-line position


def test_the_assembled_report_validates_against_the_wire_schema() -> None:
    """The dict the assembler produces is exactly what the API boundary expects.

    The application layer must not import the Pydantic schema, so this is the
    only place that can catch a field-name drift between the two before it
    reaches a real client — a broken shape here would surface as a 500 at the
    router, not a assembler-level bug.
    """
    from groundmodel.api.schemas.project.gapless_build_report import GaplessBuildReportSchema

    broken_report = LabelReport(in_footprint_columns=10, empty_in_footprint_columns=1)
    violated = (
        SectionReconciliation(
            section_index=0,
            start_x=0.0,
            start_y=0.0,
            end_x=10.0,
            end_y=0.0,
            swept_2d_m2=50.0,
            swept_3d_m2=10.0,
            budget_m2=1.0,
            divergence_m2=40.0,
            allowance_m2=3.5,
            violated=True,
            worst_sample_along_m=None,
            worst_sample_divergence_m=0.0,
            samples_outside_footprint=4,
            samples_total=4,
        ),
    )

    report = GaplessBuildReportAssembler().assemble(
        _MODEL_ID,
        gapless_2d=None,
        label_report=broken_report,
        reconciliations=violated,
    )

    validated = GaplessBuildReportSchema.model_validate(report)
    assert validated.verdict == "fail"
    assert len(validated.clauses) == 7


def test_each_failing_clause_logs_its_own_line(caplog) -> None:
    """A gate whose failures are only visible in the UI is half a gate."""
    broken_report = LabelReport(in_footprint_columns=10, empty_in_footprint_columns=2)

    with caplog.at_level("WARNING"):
        GaplessBuildReportAssembler().assemble(
            _MODEL_ID,
            gapless_2d=_clean_2d_clauses(),
            label_report=broken_report,
            reconciliations=_clean_reconciliation(),
        )

    warnings = "\n".join(r.message for r in caplog.records if r.levelname == "WARNING")
    assert "column-totality" in warnings
    assert "FAILED" in warnings
