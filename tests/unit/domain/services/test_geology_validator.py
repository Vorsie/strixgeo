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
    FormationSurfaceInput,
    GeologyValidator,
)
from groundmodel.domain.services.tin_surface import TinSurface


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


# ---------------------------------------------------------------------------
# validate_no_crossings — cross-formation superposition rule
# ---------------------------------------------------------------------------


def _surface(
    name: str,
    display_order: int,
    vertices: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int]],
) -> FormationSurfaceInput:
    """Build a FormationSurfaceInput with a fresh formation_id."""
    return FormationSurfaceInput(
        formation_id=uuid7(),
        name=name,
        display_order=display_order,
        surface=TinSurface(vertices=vertices, triangles=triangles),
    )


# A single triangle covering the unit square — used as a base for
# stacking-test fixtures.
_UNIT_TRIANGLES: list[tuple[int, int, int]] = [(0, 1, 2)]


def test_no_crossings_when_younger_sits_above_older_everywhere() -> None:
    """The geological happy path — younger formation's surface is
    everywhere above the older formation's surface within the shared
    footprint. Zero issues.
    """
    older = _surface(
        "Older",
        display_order=0,
        vertices=[(0.0, 0.0, 0.0), (10.0, 0.0, 0.0), (5.0, 10.0, 0.0)],
        triangles=_UNIT_TRIANGLES,
    )
    younger = _surface(
        "Younger",
        display_order=10,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([older, younger])
    assert issues == []


def test_crossing_flagged_when_younger_dips_below_older() -> None:
    """Younger formation's vertex sits below older's interpolated
    elevation at the same (x, y) — superposition violated. One
    ``formation_crossing`` issue with the worst-delta in depth_m.
    """
    older = _surface(
        "Older",
        display_order=0,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    # Younger's middle vertex is at z=2 — that's 3 m BELOW older's
    # interpolated z=5 at the same (x, y).
    younger = _surface(
        "Younger",
        display_order=10,
        vertices=[(0.0, 0.0, 8.0), (10.0, 0.0, 8.0), (5.0, 10.0, 2.0)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([older, younger])
    assert [i.kind for i in issues] == ["formation_crossing"]
    issue = issues[0]
    assert issue.formation_ids == (older.formation_id, younger.formation_id)
    assert issue.depth_m is not None
    assert issue.depth_m >= 3.0 - 1e-6


def test_crossing_uses_stratigraphic_order_regardless_of_input_order() -> None:
    """Pair (younger, older) and (older, younger) produce the same issue —
    the validator orients by display_order, not input position.
    """
    older = _surface(
        "Older",
        display_order=0,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    younger = _surface(
        "Younger",
        display_order=10,
        vertices=[(0.0, 0.0, 8.0), (10.0, 0.0, 8.0), (5.0, 10.0, 2.0)],
        triangles=_UNIT_TRIANGLES,
    )
    forwards = GeologyValidator().validate_no_crossings([older, younger])
    reversed_ = GeologyValidator().validate_no_crossings([younger, older])
    assert len(forwards) == 1
    assert len(reversed_) == 1
    assert forwards[0].formation_ids == reversed_[0].formation_ids


def test_no_crossing_when_surfaces_dont_overlap_in_xy() -> None:
    """Two formations with disjoint (x, y) footprints can't cross —
    every sample point falls outside the other's TIN.
    """
    far_east = _surface(
        "Older",
        display_order=0,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    far_west = _surface(
        "Younger",
        display_order=10,
        vertices=[
            (1000.0, 1000.0, 0.0),
            (1010.0, 1000.0, 0.0),
            (1005.0, 1010.0, 0.0),
        ],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([far_east, far_west])
    assert issues == []


def test_sub_centimetre_overlap_within_tolerance_is_not_a_crossing() -> None:
    """Younger 5 mm below older counts as touching, not crossing —
    interpolation noise + survey accuracy don't justify a violation.
    """
    older = _surface(
        "Older",
        display_order=0,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    younger = _surface(
        "Younger",
        display_order=10,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 4.995)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([older, younger])
    assert issues == []


def test_equal_mean_elevation_pairs_are_skipped() -> None:
    """Two formations with identical mean surface elevation have no
    defined superposition relationship — the validator skips the
    pair rather than guessing which is older. (display_order is
    NOT consulted; geological age derives from the data.)
    """
    a = _surface(
        "A",
        display_order=5,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    b = _surface(
        "B",
        display_order=10,
        # Identical mean elevation (= 5.0) — different vertices but
        # the same area-averaged depth.
        vertices=[(0.0, 0.0, 4.0), (10.0, 0.0, 5.0), (5.0, 10.0, 6.0)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([a, b])
    assert issues == []


def test_validator_ignores_display_order_uses_mean_elevation() -> None:
    """Regression: ``display_order`` describes UI list order, NOT
    geological age. A natural top-down workflow assigns
    ``display_order = 0`` to the youngest formation (the surface unit
    encountered first when describing a borehole). Under that
    convention every project would false-flag a crossing.

    Fixture: the SHALLOWER surface carries the LOWER ``display_order``
    (i.e. user's "top-down" creation order) — opposite to any
    "lower = older" convention. The data is geologically consistent
    (deeper surface IS older). The validator must produce zero
    issues.
    """
    # display_order says this is OLDEST (=0), but the surface sits
    # NEAR THE TOP (high elevation = young in reality).
    shallow_but_labelled_old = _surface(
        "Antropogeen",
        display_order=0,
        vertices=[(0.0, 0.0, 9.5), (10.0, 0.0, 9.6), (5.0, 10.0, 9.7)],
        triangles=_UNIT_TRIANGLES,
    )
    # display_order says this is YOUNGEST (=3), but it sits DEEP
    # (low elevation = old in reality).
    deep_but_labelled_young = _surface(
        "Roubaix",
        display_order=3,
        vertices=[(0.0, 0.0, -15.0), (10.0, 0.0, -14.8), (5.0, 10.0, -15.2)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings(
        [shallow_but_labelled_old, deep_but_labelled_young]
    )
    # Zero crossings — the data is geologically consistent regardless
    # of the inverted display_order labels.
    assert issues == []


def test_surface_without_triangles_is_skipped() -> None:
    """A formation with only 1-2 contacts has no surface to cross
    — skip the pair rather than raise.
    """
    real = _surface(
        "Real",
        display_order=0,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    incomplete = _surface(
        "Incomplete",
        display_order=10,
        vertices=[(0.0, 0.0, 0.0), (10.0, 0.0, 0.0)],  # 2 points, no triangles
        triangles=[],
    )
    issues = GeologyValidator().validate_no_crossings([real, incomplete])
    assert issues == []


def test_empty_input_returns_empty_list() -> None:
    """No formations → nothing to compare → empty list."""
    issues = GeologyValidator().validate_no_crossings([])
    assert issues == []
