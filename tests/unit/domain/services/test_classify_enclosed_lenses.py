"""Unit tests for classify_enclosed_lenses.

A contact stack is a depth-sorted list of formation ids (one per contact).
The helper marks which units between contacts are enclosed lenses and which
are the host halves wrapping them.  Pure function — no DB, no I/O.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.classify_enclosed_lenses import (
    classify_enclosed_lenses,
)


def _fid(n: int) -> UUID:
    """Deterministic stand-in formation id."""
    return UUID(int=n)


SAND = _fid(1)
SILT = _fid(2)
CLAY = _fid(3)


def test_single_lens_sand_silt_sand_clay() -> None:
    """SAND·SILT·SAND·CLAY: silt (unit 1) is a lens; both sands (0, 2) are
    host halves; the deepest clay frames no unit."""
    result = classify_enclosed_lenses([SAND, SILT, SAND, CLAY])
    assert result.lens_units == {1}
    assert result.host_half_units == {0, 2}


def test_lens_with_host_to_bottom() -> None:
    """SAND·SILT·SAND with the lower sand as the deepest contact: silt is
    still a lens; only the upper sand (0) is a framed host-half — the lower
    sand frames no unit (no contact below it)."""
    result = classify_enclosed_lenses([SAND, SILT, SAND])
    assert result.lens_units == {1}
    assert result.host_half_units == {0}


def test_clay_lens_host_to_bottom() -> None:
    """CLAY·SAND·CLAY (clay to the bottom): the sand is a lens-in-clay;
    upper clay (0) is the only framed host-half."""
    result = classify_enclosed_lenses([CLAY, SAND, CLAY])
    assert result.lens_units == {1}
    assert result.host_half_units == {0}


def test_stacked_lenses_sand_matrix() -> None:
    """SAND·SILT·SAND·SILT·SAND·CLAY: both silts are lenses; the three sands
    are host halves.  Sand recurs (count 3 > silt 2) so it is the matrix —
    the middle sand is NOT mis-classified as a lens-in-silt."""
    result = classify_enclosed_lenses([SAND, SILT, SAND, SILT, SAND, CLAY])
    assert result.lens_units == {1, 3}
    assert result.host_half_units == {0, 2, 4}


def test_minority_is_lens_silt_matrix() -> None:
    """SILT·SAND·SILT·SAND·SILT·CLAY: sand is the minority (count 2 < silt 3)
    so the sands (1, 3) are lenses in the silt matrix."""
    result = classify_enclosed_lenses([SILT, SAND, SILT, SAND, SILT, CLAY])
    assert result.lens_units == {1, 3}
    assert result.host_half_units == {0, 2, 4}


def test_tie_counts_not_a_lens() -> None:
    """SAND·SILT·SAND·SILT·CLAY: sand count 2 equals silt count 2 → the
    matrix is ambiguous → nothing is flagged (conservative)."""
    result = classify_enclosed_lenses([SAND, SILT, SAND, SILT, CLAY])
    assert result.lens_units == set()
    assert result.host_half_units == set()


def test_no_lens_when_all_neighbours_distinct() -> None:
    """CLAY·SAND·SILT·CLAY: every interior unit has distinct neighbours →
    no lens."""
    result = classify_enclosed_lenses([CLAY, SAND, SILT, CLAY])
    assert result.lens_units == set()
    assert result.host_half_units == set()


def test_short_stacks_have_no_lens() -> None:
    """One or two contacts cannot frame an interior (enclosed) unit."""
    assert classify_enclosed_lenses([]).lens_units == set()
    assert classify_enclosed_lenses([SAND]).lens_units == set()
    assert classify_enclosed_lenses([SAND, SILT]).lens_units == set()
    assert classify_enclosed_lenses([SAND, SILT]).host_half_units == set()


def test_determinism() -> None:
    """Same input → same output (sets compare equal regardless of order)."""
    stack = [SAND, SILT, SAND, SILT, SAND, CLAY]
    first = classify_enclosed_lenses(stack)
    second = classify_enclosed_lenses(stack)
    assert first == second
