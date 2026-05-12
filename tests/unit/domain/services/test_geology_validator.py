"""Unit tests for the geological-model no-gaps validator.

The integration tests in ``tests/integration/db/test_geology_repository.py``
exercise the loader path (DB rows → validator inputs); these unit
tests pin the pure domain logic so a future refactor of the
loader can't quietly change the rules.
"""

from __future__ import annotations

from uuid6 import uuid7

from groundmodel.domain.services.geology_validator import (
    ContactDepth,
    GeologyValidator,
)


def _contact(depth_m: float) -> ContactDepth:
    """Build a ContactDepth with a fresh id."""
    return ContactDepth(id=uuid7(), depth_top_m=depth_m)


def test_empty_contact_list_returns_no_contacts() -> None:
    """A model with no picks for a borehole reports the empty state."""
    issues = GeologyValidator().validate_no_gaps([], borehole_total_depth_m=10.0)
    assert [i.kind for i in issues] == ["no_contacts"]


def test_clean_stratigraphy_reports_no_issues() -> None:
    """Surface + 2 m contact on a 10 m borehole is clean."""
    issues = GeologyValidator().validate_no_gaps(
        [_contact(0.0), _contact(2.0)],
        borehole_total_depth_m=10.0,
    )
    assert issues == []


def test_missing_surface_contact_flagged() -> None:
    """A single contact at 3 m leaves the top of the hole unassigned."""
    issues = GeologyValidator().validate_no_gaps(
        [_contact(3.0)],
        borehole_total_depth_m=10.0,
    )
    assert any(i.kind == "missing_surface_contact" for i in issues)


def test_surface_tolerance_accepts_near_zero_pick() -> None:
    """A pick within the 0.10 m tolerance counts as surface."""
    issues = GeologyValidator().validate_no_gaps(
        [_contact(0.05)],
        borehole_total_depth_m=10.0,
    )
    assert not any(i.kind == "missing_surface_contact" for i in issues)


def test_duplicate_depth_flagged() -> None:
    """Two contacts at the exact same depth get reported as ambiguous."""
    issues = GeologyValidator().validate_no_gaps(
        [_contact(0.0), _contact(0.0)],
        borehole_total_depth_m=10.0,
    )
    assert any(i.kind == "duplicate_depth" for i in issues)


def test_contact_below_test_depth_flagged() -> None:
    """A contact deeper than the borehole's test depth is reported."""
    issues = GeologyValidator().validate_no_gaps(
        [_contact(0.0), _contact(99.0)],
        borehole_total_depth_m=5.0,
    )
    assert any(i.kind == "contact_below_test" for i in issues)


def test_below_test_check_skipped_when_total_depth_unknown() -> None:
    """No ``contact_below_test`` issues when borehole depth is None."""
    issues = GeologyValidator().validate_no_gaps(
        [_contact(0.0), _contact(99.0)],
        borehole_total_depth_m=None,
    )
    assert not any(i.kind == "contact_below_test" for i in issues)


def test_input_order_does_not_matter() -> None:
    """The validator sorts contacts internally — caller order is free."""
    issues_ordered = GeologyValidator().validate_no_gaps(
        [_contact(0.0), _contact(2.0)],
        borehole_total_depth_m=10.0,
    )
    issues_reversed = GeologyValidator().validate_no_gaps(
        [_contact(2.0), _contact(0.0)],
        borehole_total_depth_m=10.0,
    )
    assert issues_ordered == issues_reversed == []


def test_issue_carries_contact_id_for_editor_highlight() -> None:
    """``contact_ids`` references the offending row(s) so the editor can highlight them."""
    bad = _contact(3.0)
    issues = GeologyValidator().validate_no_gaps([bad], borehole_total_depth_m=10.0)
    surface = next(i for i in issues if i.kind == "missing_surface_contact")
    assert surface.contact_ids == (bad.id,)
