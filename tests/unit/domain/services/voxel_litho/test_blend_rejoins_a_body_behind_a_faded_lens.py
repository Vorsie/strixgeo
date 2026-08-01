"""A body split only by a lens that has faded away must come back together.

Owner's reading 2026-08-01, and it is the right one: where a cross-section draws sand
lenses inside a silt and the facing tie-section draws one thick silt, the sections do not
disagree. The lenses simply do not reach the tie. Under the reach ruling (#256) they thin
out on the way there, which is what should happen.

What should ALSO happen is that the silt closes behind them. Once the lens between two
pieces of one body has faded to nothing, those pieces touch, and two touching pieces of
one body are one piece.

They were not being joined. ``_section_stack_at`` merges touching same-body slices when
it reads a SINGLE section — ``_merge_contiguous``, added for #257 — but ``_blend_stacks``
returned its layout unmerged, so the same situation got opposite treatment depending on
which path produced it. Measured on the owner's model before the fix: 715 of 4,110
sampled blended columns (17.4 %) held touching pieces of one body, 880 joins in all, with
zero leftover zero-thickness slivers holding them apart.

Phrased in the ground's vocabulary: a silt with a sand lens in it is still one silt where
the lens has died out.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.label_voxels import _blend_stacks, _Entry


def _thickness_of(stack: list[_Entry], body: str) -> float:
    """Total metres of one body in a blended stack."""
    return sum(e.top_elev - e.base_elev for e in stack if e.body_id == body)


def _intervals_of(stack: list[_Entry], body: str) -> int:
    """How many separate intervals one body occupies."""
    return sum(1 for e in stack if e.body_id == body)


def _silt_cut_by_a_spent_lens() -> tuple[list[_Entry], list[_Entry]]:
    """Section A shows the silt cut by a lens with NO thickness; section B shows it whole.

    Taken from the real column at (88 296.3, 164 767.3), where the sand body 019ea3e1 is
    interrupted on one section by lens entries recorded at ``2.650 -> 2.650`` — a lens
    sliced exactly at its own apex, so it has zero thickness and is not there.

    That zero-thickness entry is why the existing merge does not help: it sits BETWEEN
    the two pieces in the list, and ``_merge_contiguous`` only joins slices that are
    adjacent. The pieces touch, the thing between them is nothing, and they stay two.
    """
    stack1 = [
        _Entry("silt", "SILT", 10.0, 6.0, "quad"),
        _Entry("spent", "ZAND", 6.0, 6.0, "lens"),
        _Entry("silt", "SILT", 6.0, 2.0, "quad"),
    ]
    stack2 = [_Entry("silt", "SILT", 10.0, 2.0, "quad")]
    return stack1, stack2


def test_the_silt_is_one_interval_when_only_nothing_divides_it() -> None:
    """The pieces touch and what lies between them has no thickness, so it is one silt.

    This is the owner's reading of 2026-08-01: the sections do not disagree, the lens
    simply does not reach the far one. Where the lens has nothing left, the silt closes.
    """
    stack1, stack2 = _silt_cut_by_a_spent_lens()

    blended = _blend_stacks(stack1, stack2, 0.5, reach_to_evidence=True)

    assert _intervals_of(blended, "silt") == 1


def test_the_silt_stays_split_while_the_lens_is_still_there() -> None:
    """A lens with real thickness genuinely divides the silt, and must keep dividing it.

    The guard that the merge does not swallow a lens that has not died yet.
    """
    stack1 = [
        _Entry("silt", "SILT", 10.0, 6.0, "quad"),
        _Entry("lens", "ZAND", 6.0, 5.0, "lens"),
        _Entry("silt", "SILT", 5.0, 2.0, "quad"),
    ]
    stack2 = [_Entry("silt", "SILT", 10.0, 2.0, "quad")]

    blended = _blend_stacks(stack1, stack2, 0.5, reach_to_evidence=True)

    assert _intervals_of(blended, "lens") == 1
    assert _intervals_of(blended, "silt") == 2


def test_rejoining_moves_no_material() -> None:
    """Merging is bookkeeping, not geology: the same metres of silt either way."""
    stack1, stack2 = _silt_cut_by_a_spent_lens()

    blended = _blend_stacks(stack1, stack2, 0.5, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "silt"), 8.0, abs_tol=1e-9)


def test_a_body_that_genuinely_comes_back_lower_stays_two_intervals() -> None:
    """A re-entrant body is not a cut one, and must not be fused.

    Here the silt returns beneath a clay that BOTH sections carry, so the two pieces
    never touch and remain what the sections drew: two.
    """
    stack1 = [
        _Entry("silt", "SILT", 10.0, 6.0, "quad"),
        _Entry("klei", "KLEI", 6.0, 4.0, "quad"),
        _Entry("silt", "SILT", 4.0, 2.0, "quad"),
    ]
    stack2 = [
        _Entry("silt", "SILT", 10.0, 6.0, "quad"),
        _Entry("klei", "KLEI", 6.0, 4.0, "quad"),
        _Entry("silt", "SILT", 4.0, 2.0, "quad"),
    ]

    blended = _blend_stacks(stack1, stack2, 0.5, reach_to_evidence=True)

    assert _intervals_of(blended, "silt") == 2
