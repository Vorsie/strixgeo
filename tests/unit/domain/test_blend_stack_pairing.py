"""Unit tests for re-entrant body pairing in the blend — debt #248.

When a body occurs more than once in a section's stack (a clay that appears twice
down the column), the blend must decide WHICH occurrence on section A corresponds
to WHICH on section B before it can interpolate their thicknesses.

It paired them by ARRAY RANK — ``left[k]`` with ``right[k]`` after sorting by
elevation. Rank is an artifact of sort order, not evidence, so a shallow
occurrence could be paired with a deep one and their thicknesses averaged.

Measured on the real model 2 m from ``GEO-23/125-S12``: the tie section carries
two KLEI entries under one body id, ``8.166/6.326`` (mid 7.25) and ``5.844/3.622``
(mid 4.73); Cross-section 1 carries one, ``5.719/3.552`` (mid 4.64). Rank paired
the tie's UPPER clay with CS1's only clay — 2.6 m apart in mid-elevation — when
the lower one sits 0.1 m away and is plainly the counterpart.

These tests target the pairing directly rather than the blended output:
:func:`_blend_stacks` lays its result out cumulatively from a blended top, so an
absolute elevation there reflects everything above it, not the pairing decision.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.label_voxels import _Entry, _pair_occurrences


def _entry(top: float, base: float) -> _Entry:
    """One vertical interval; body/formation are irrelevant to pairing."""
    return _Entry("b", "KLEI", top, base)


def _mids(
    pairs: list[tuple[_Entry | None, _Entry | None]],
) -> list[tuple[float | None, float | None]]:
    """Mid-elevation of each side of each pair, rounded for comparison."""
    return [
        (
            None if a is None else round((a.top_elev + a.base_elev) / 2, 3),
            None if b is None else round((b.top_elev + b.base_elev) / 2, 3),
        )
        for a, b in pairs
    ]


def test_the_s12_case_pairs_the_nearest_clay_not_the_first() -> None:
    """The lower tie clay (mid 4.73) is CS1's clay (mid 4.64) — not the upper."""
    left = [_entry(8.166, 6.326), _entry(5.844, 3.622)]  # mids 7.246, 4.733
    right = [_entry(5.719, 3.552)]  # mid 4.636

    pairs = _pair_occurrences(left, right)

    assert (4.733, 4.636) in _mids(pairs)
    # The upper occurrence is left without a counterpart, so it pinches.
    assert (7.246, None) in _mids(pairs)


def test_aligned_occurrences_pair_one_to_one() -> None:
    """The ordinary case is unchanged: nearest and rank agree."""
    left = [_entry(10.0, 9.0), _entry(5.0, 4.0)]
    right = [_entry(10.2, 9.1), _entry(5.1, 4.2)]

    assert _mids(_pair_occurrences(left, right)) == [(9.5, 9.65), (4.5, 4.65)]


def test_every_occurrence_appears_exactly_once() -> None:
    """Nothing is dropped and nothing is used twice — the stack must still tile."""
    left = [_entry(10.0, 9.0), _entry(5.0, 4.0), _entry(1.0, 0.0)]
    right = [_entry(9.9, 9.2)]

    pairs = _pair_occurrences(left, right)

    assert len(pairs) == 3
    assert sum(1 for a, _b in pairs if a is not None) == 3
    assert sum(1 for _a, b in pairs if b is not None) == 1


def test_more_on_the_right_than_the_left() -> None:
    """The asymmetric case must work in both directions."""
    left = [_entry(5.0, 4.0)]
    right = [_entry(10.0, 9.0), _entry(5.1, 4.1)]

    pairs = _pair_occurrences(left, right)

    assert len(pairs) == 2
    assert (4.5, 4.6) in _mids(pairs)
    assert (None, 9.5) in _mids(pairs)


def test_pairing_is_symmetric() -> None:
    """Swapping the sides yields the mirrored pairing, not a different one."""
    left = [_entry(8.166, 6.326), _entry(5.844, 3.622)]
    right = [_entry(5.719, 3.552)]

    forward = {(a, b) for a, b in _mids(_pair_occurrences(left, right))}
    backward = {(b, a) for a, b in _mids(_pair_occurrences(right, left))}

    assert forward == backward


def test_empty_sides() -> None:
    """One side empty means every occurrence on the other is one-sided."""
    assert _mids(_pair_occurrences([_entry(5.0, 4.0)], [])) == [(4.5, None)]
    assert _mids(_pair_occurrences([], [_entry(5.0, 4.0)])) == [(None, 4.5)]
    assert _pair_occurrences([], []) == []
