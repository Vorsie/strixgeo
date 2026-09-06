"""Unit tests for the geological-model no-gaps validator.

The integration tests in ``tests/integration/db/test_geology_repository.py``
exercise the loader path (DB rows → validator inputs); these unit
tests pin the pure domain logic so a future refactor of the
loader can't quietly change the rules.
"""

from __future__ import annotations

from uuid import UUID

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
    contact_lookup: dict[tuple[float, float], UUID] | None = None,
) -> FormationSurfaceInput:
    """Build a FormationSurfaceInput with a fresh formation_id.

    ``contact_lookup`` is optional — when omitted the validator runs
    in the legacy "I don't know which picks caused this" mode and
    emits crossings with an empty ``contact_ids``. Passing a lookup
    populates ``contact_ids`` for any vertex whose (rounded x, y)
    matches a key in the dict.
    """
    return FormationSurfaceInput(
        formation_id=uuid7(),
        name=name,
        display_order=display_order,
        surface=TinSurface(vertices=vertices, triangles=triangles),
        contact_lookup=contact_lookup or {},
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


def test_equal_display_order_pairs_are_skipped() -> None:
    """Two formations with the SAME ``display_order`` have no defined
    superposition relationship (the UI breaks such ties by name only),
    so the validator skips the pair rather than guessing which is
    older — even when their surfaces genuinely overlap.
    """
    a = _surface(
        "A",
        display_order=5,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
    )
    b = _surface(
        "B",
        # Same display_order as A — order ambiguous, nothing to validate,
        # even though b dips below a at (0, 0).
        display_order=5,
        vertices=[(0.0, 0.0, 4.0), (10.0, 0.0, 5.0), (5.0, 10.0, 6.0)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([a, b])
    assert issues == []


def test_uses_display_order_not_mean_elevation() -> None:
    """The validator orients pairs by ``display_order``, not by surface
    mean elevation (owner ruling 2026-09-06).

    Fixture where the two axes DISAGREE: the older formation (lower
    ``display_order``) carries the HIGHER surface, the younger (higher
    ``display_order``) the lower surface, so the younger sits entirely
    below the older — a genuine superposition violation. Mean
    elevation would relabel the deeper surface as the older one and
    report no crossing; ``display_order`` reports the violation. The
    validator must follow ``display_order`` and flag it.
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
        vertices=[(0.0, 0.0, 0.0), (10.0, 0.0, 0.0), (5.0, 10.0, 0.0)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([older, younger])
    assert [i.kind for i in issues] == ["formation_crossing"]
    assert issues[0].formation_ids == (older.formation_id, younger.formation_id)


def test_vlierzele_below_antropogeen_is_not_a_crossing() -> None:
    """Owner ruling 2026-09-06: "Antropogeen is younger than Pleistoceen and
    Pleistoceen is younger than Vlierzele, so a Vlierzele surface below
    Antropogeen is NOT a crossing warning".

    The age axis is ``display_order`` (lower = older, higher = younger — the
    same convention the InterpretationPane, the section bands and Build's
    ``_reorder_by_age`` use). Antropogeen carries the HIGHER ``display_order``
    (youngest, pinned by the anthropogenic rule), Vlierzele a lower one, so
    Vlierzele sitting beneath Antropogeen is correct superposition, not a
    violation.

    The trap the old mean-elevation heuristic fell into: the site was dredged
    near the canal, so Antropogeen fill spans a low zone that drags its MEAN
    surface elevation *below* Vlierzele's (Vlierzele survives only on the high
    ground). Mean elevation then mislabels Antropogeen as the older formation
    and flags the (correct) Vlierzele-below-Antropogeen geometry as a crossing.
    """
    # Antropogeen (youngest, display_order 4): high over the shared footprint
    # (z=3, above Vlierzele) PLUS a dredged low lobe far to the east (z=-20)
    # that pulls its mean elevation below Vlierzele's.
    antropogeen = _surface(
        "Antropogeen",
        display_order=4,
        vertices=[
            (0.0, 0.0, 3.0),
            (10.0, 0.0, 3.0),
            (5.0, 10.0, 3.0),
            (100.0, 0.0, -20.0),
            (110.0, 0.0, -20.0),
            (105.0, 10.0, -20.0),
        ],
        triangles=[(0, 1, 2), (3, 4, 5)],
    )
    # Lid van Vlierzele (older, display_order 2): a moderate surface (z=1) that
    # sits BELOW Antropogeen everywhere in the shared footprint.
    vlierzele = _surface(
        "Lid van Vlierzele",
        display_order=2,
        vertices=[(0.0, 0.0, 1.0), (10.0, 0.0, 1.0), (5.0, 10.0, 1.0)],
        triangles=_UNIT_TRIANGLES,
    )
    issues = GeologyValidator().validate_no_crossings([antropogeen, vlierzele])
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


def test_crossing_carries_contact_ids_from_lookup() -> None:
    """When the caller supplies a contact_lookup, the offending
    vertices' contact_ids land on the GapIssue. Both sides of the
    crossing pair contribute — the banner needs every pick to
    highlight, not just one.
    """
    older_id_a = uuid7()
    older_id_b = uuid7()
    older_id_c = uuid7()
    younger_id_a = uuid7()
    younger_id_b = uuid7()
    younger_id_c = uuid7()
    older = _surface(
        "Older",
        display_order=0,
        vertices=[(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 10.0, 5.0)],
        triangles=_UNIT_TRIANGLES,
        contact_lookup={
            (0.0, 0.0): older_id_a,
            (10.0, 0.0): older_id_b,
            (5.0, 10.0): older_id_c,
        },
    )
    # Younger's middle vertex sits 3 m below older — symmetric pass
    # at older's vertices also detects it (older's z=5 vs younger's
    # interpolated z<5 around the centre triangle).
    younger = _surface(
        "Younger",
        display_order=10,
        vertices=[(0.0, 0.0, 8.0), (10.0, 0.0, 8.0), (5.0, 10.0, 2.0)],
        triangles=_UNIT_TRIANGLES,
        contact_lookup={
            (0.0, 0.0): younger_id_a,
            (10.0, 0.0): younger_id_b,
            (5.0, 10.0): younger_id_c,
        },
    )
    issues = GeologyValidator().validate_no_crossings([older, younger])
    assert len(issues) == 1
    contact_ids = set(issues[0].contact_ids)
    # The offending younger vertex is (5, 10) — younger_id_c.
    assert younger_id_c in contact_ids
    # Older's symmetric pass also fires — at least one older contact
    # appears (the centre/edge that sits over the dipping younger
    # triangle).
    assert contact_ids & {older_id_a, older_id_b, older_id_c}


def test_crossing_without_lookup_emits_empty_contact_ids() -> None:
    """Backwards-compatibility check: when no contact_lookup is
    supplied the validator still detects the crossing but emits an
    empty ``contact_ids`` tuple. The banner remains non-clickable
    in that case (graceful degradation rather than a crash).
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
    issues = GeologyValidator().validate_no_crossings([older, younger])
    assert len(issues) == 1
    assert issues[0].contact_ids == ()
