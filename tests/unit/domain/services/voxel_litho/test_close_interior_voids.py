"""The builder closes an interior void; clause 6 reports only what it could not.

Owner, installer #40, model-check clause 6 (*"89 kolomstapel(s) bevatten een
leegte boven 100 mm; ergste 154.5 mm"*): *"this is nothing the user can fix,
this is due to the model ... on the cross sections everything is filled so the
model shouldn't have any slivers"*.

A void between two labelled voxels in one column stack — below the ground/bed
and above the model floor — is a sub-voxel sliver a sloped 2-D contact left when
the column read it at a fraction.  The builder closes it, taking the label of
the THICKER neighbour (the UPPER one when they are equally thick), so a
complete-2-D model shows no slivers, and clause 6 reports ONLY a void the
builder could not close.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from groundmodel.domain.services.voxel_litho.label_voxels import (
    _close_interior_voids,
    _Entry,
    _interior_gaps,
    label_voxels,
)

# Reuse the two-section fixture family from the behavioural label_voxels suite.
_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("_lv_fixtures", _HERE / "test_label_voxels.py")
assert _spec and _spec.loader
_fx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fx)


def _spans(stack: list[_Entry]) -> list[tuple[str, float, float]]:
    """The (formation, top, base) of every entry, so a run reads plainly."""
    return [(e.formation_id, round(e.top_elev, 3), round(e.base_elev, 3)) for e in stack]


def test_a_void_between_two_labelled_voxels_in_one_stack_is_closed_by_the_builder():
    """A 2 m void between two entries is filled — the stack tiles afterwards.

    The thicker neighbour wins: the lower entry is 6 m, the upper 2 m, so the
    void takes the LOWER label and the lower entry grows UP through it.
    """
    stack = [
        _Entry("upper", "KLEI", top_elev=10.0, base_elev=8.0),  # 2 m
        _Entry("lower", "ZAND", top_elev=6.0, base_elev=0.0),  # 6 m — thicker
    ]
    assert _interior_gaps(stack) == [(6.0, 8.0)]  # the void, before

    closed = _close_interior_voids(stack)

    assert _interior_gaps(closed) == []  # no interior void, after
    # The lower (thicker) neighbour grew up through the void: ZAND now 8 → 0.
    assert _spans(closed) == [("KLEI", 10.0, 8.0), ("ZAND", 8.0, 0.0)]


def test_the_void_takes_the_upper_neighbour_when_the_two_are_equally_thick():
    """Equal thickness → the UPPER neighbour wins and grows down (owner's rule)."""
    stack = [
        _Entry("upper", "KLEI", top_elev=10.0, base_elev=4.0),  # 6 m
        _Entry("lower", "ZAND", top_elev=-4.0, base_elev=-10.0),  # 6 m — equal
    ]
    assert _interior_gaps(stack) == [(-4.0, 4.0)]

    closed = _close_interior_voids(stack)

    assert _interior_gaps(closed) == []
    # Equal thickness: the void is KLEI (the upper), which grew down to -4.
    assert _spans(closed) == [("KLEI", 10.0, -4.0), ("ZAND", -4.0, -10.0)]


def test_a_stack_that_already_tiles_is_returned_unchanged():
    """No interior void → a strict no-op (the byte-identical guarantee)."""
    stack = [
        _Entry("a", "KLEI", top_elev=10.0, base_elev=4.0),
        _Entry("b", "ZAND", top_elev=4.0, base_elev=-10.0),
    ]
    assert _close_interior_voids(stack) == stack


def test_a_below_td_void_is_not_interior_and_is_left_unknown():
    """A gap below the deepest entry is a below-TD unknown, not an interior void.

    Owner ruling 2026-07-30: *"leave it unknown"*.  ``_interior_gaps`` returns
    only gaps sandwiched between two entries, so a bottom gap is never a
    candidate — the deepest entry keeps its base and the interval below it stays
    void.
    """
    stack = [_Entry("a", "KLEI", top_elev=10.0, base_elev=2.0)]
    # No entry below → nothing is interior, nothing to close.
    assert _interior_gaps(stack) == []
    assert _close_interior_voids(stack) == stack


def test_clause_6_reports_only_the_voids_the_builder_could_not_close():
    """After the builder closes its interior voids, clause 6's actionable count is 0.

    Section A draws KLEI over an UNKNOWN middle over KLEI; extended sideways
    (read beyond the sections) that leaves an interior void between the two KLEI
    bodies.  Before the fix clause 6 flagged it (the model showed a sliver); the
    builder now folds it into the thicker neighbour, so clause 6 reports ONLY
    what it could not close — nothing here.
    """
    domain = _fx._domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_fx._section_with_an_unfilled_middle(), _fx._section_b()])

    assert grid.report.hairline_gaps_actionable == 0
