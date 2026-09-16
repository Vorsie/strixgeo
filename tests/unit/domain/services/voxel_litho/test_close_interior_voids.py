"""The builder closes a SUB-VOXEL interior void; clause 6 reports the rest.

Owner ruling (installer #41 dogfeed, 2026-09-16): *"Clause 6: close interior
voids smaller than voxel height? Sounds about right."*

The size rule that replaces the old close-everything pass: a void between two
labelled voxels in one column stack that is SMALLER than one voxel height is a
sampling sliver a sloped 2-D contact left when the column read it at a fraction,
and the builder closes it by extending the THICKER neighbour (the UPPER one when
they are equally thick).  A void of ONE VOXEL HEIGHT OR MORE is a real gap: the
builder leaves it unknown and clause 6 (stack-voids) reports it.  A below-TD void
is never interior, so it is left unknown either way (owner ruling 2026-07-30).
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


def test_a_void_smaller_than_one_voxel_height_is_closed_by_the_builder():
    """A void shorter than one voxel is a sliver — the thicker neighbour grows into it.

    The void (0 -> 1 m, one metre tall) is smaller than the 2 m voxel height, so
    the builder closes it.  The lower ZAND is 10 m and the upper KLEI 9 m, so the
    lower (thicker) neighbour wins and grows UP through the void.
    """
    dz = 2.0
    stack = [
        _Entry("upper", "KLEI", top_elev=10.0, base_elev=1.0),  # 9 m
        _Entry("lower", "ZAND", top_elev=0.0, base_elev=-10.0),  # 10 m — thicker
    ]
    assert _interior_gaps(stack) == [(0.0, 1.0)]  # a 1 m void, before

    closed = _close_interior_voids(stack, dz)

    assert _interior_gaps(closed) == []  # no interior void, after
    # The lower (thicker) neighbour grew up through the void: ZAND now 1 -> -10.
    assert _spans(closed) == [("KLEI", 10.0, 1.0), ("ZAND", 1.0, -10.0)]


def test_the_void_takes_the_upper_neighbour_when_the_two_are_equally_thick():
    """Equal thickness -> the UPPER neighbour wins and grows down (owner's rule).

    The void (-4 -> 4, eight metres) is closed here because the voxel height is
    twenty metres, so it stays a sliver in this test; the thicker-neighbour rule
    is what is under test, not the size threshold.
    """
    dz = 20.0
    stack = [
        _Entry("upper", "KLEI", top_elev=10.0, base_elev=4.0),  # 6 m
        _Entry("lower", "ZAND", top_elev=-4.0, base_elev=-10.0),  # 6 m — equal
    ]
    assert _interior_gaps(stack) == [(-4.0, 4.0)]

    closed = _close_interior_voids(stack, dz)

    assert _interior_gaps(closed) == []
    # Equal thickness: the void is KLEI (the upper), which grew down to -4.
    assert _spans(closed) == [("KLEI", 10.0, -4.0), ("ZAND", -4.0, -10.0)]


def test_a_void_of_one_voxel_height_or_more_stays_and_is_reported_by_clause_6():
    """A gap at or above one voxel is a real hole: left unknown and reported.

    Direct: a 3 m void with a 2 m voxel height is untouched by the builder.
    Integration: section A draws KLEI over an UNKNOWN 8 m middle over KLEI;
    extended sideways (read beyond the sections) that leaves an interior void
    between the two KLEI bodies.  At the 2 m voxel height the void is far larger
    than one voxel, so the builder leaves it and clause 6 reports it.
    """
    dz = 2.0
    stack = [
        _Entry("upper", "KLEI", top_elev=10.0, base_elev=3.0),  # 7 m
        _Entry("lower", "ZAND", top_elev=0.0, base_elev=-10.0),  # 10 m
    ]
    assert _interior_gaps(stack) == [(0.0, 3.0)]  # a 3 m void

    stays = _close_interior_voids(stack, dz)

    assert _interior_gaps(stays) == [(0.0, 3.0)]  # unchanged — one voxel or more
    assert stays == stack  # a strict no-op

    domain = _fx._domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_fx._section_with_an_unfilled_middle(), _fx._section_b()])

    # The 8 m void is far larger than one voxel, so clause 6 reports it.
    assert grid.report.hairline_gaps_actionable > 0


def test_a_below_td_void_is_left_unknown():
    """A gap below the deepest entry is a below-TD unknown, not an interior void.

    Owner ruling 2026-07-30: *"leave it unknown"*.  ``_interior_gaps`` returns
    only gaps sandwiched between two entries, so a bottom gap is never a
    candidate — the deepest entry keeps its base and the interval below it stays
    void, whatever the voxel height.
    """
    dz = 2.0
    stack = [_Entry("a", "KLEI", top_elev=10.0, base_elev=2.0)]
    # No entry below -> nothing is interior, nothing to close.
    assert _interior_gaps(stack) == []
    assert _close_interior_voids(stack, dz) == stack


def test_a_stack_that_already_tiles_is_returned_unchanged():
    """No interior void -> a strict no-op (the byte-identical guarantee)."""
    dz = 2.0
    stack = [
        _Entry("a", "KLEI", top_elev=10.0, base_elev=4.0),
        _Entry("b", "ZAND", top_elev=4.0, base_elev=-10.0),
    ]
    assert _close_interior_voids(stack, dz) == stack
