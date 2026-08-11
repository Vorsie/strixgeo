"""SL — the geo-bound clamp lives on the millimetre grid (audit F13).

The build's splits are mm-rounded; the geo bounds arrive raw from TIN
interpolation. Clamping rounded edges against raw bounds put the band above and
the band below a segment boundary on different values of one physical depth:
72 of 479 adjacent pairs on the owner's live model carried a sub-millimetre
no-band sliver, and the drag-merge 422d at 35 of those boundaries because the
landing "fell outside the pair".

The property under test is the one the model needs: two segments sharing a
boundary — however unrounded the TIN made it — produce bands that MEET, exactly.
"""

from __future__ import annotations

from groundmodel.application.subdivide_all_bodies import _mm_clamped_intervals
from groundmodel.domain.services.geotech_subdivision import GeotechSplit


def test_sl1_bands_either_side_of_an_unrounded_boundary_meet_exactly() -> None:
    """SL1 — the audit's sliver, reproduced and forbidden.

    The shared boundary is 3.3335 m (a value TIN interpolation genuinely
    produces; ``round(3.3335, 3) == 3.333`` in floats). Pre-fix, the upper
    segment's last band ended at min(3.333, 3.3335) = 3.333 while the lower
    segment's first began at max(3.333…rounded-clamp…, 3.3335) = 3.3335 —
    half a millimetre of ground owned by no band.
    """
    boundary = 3.3335
    upper_splits = [GeotechSplit(0.0, round(boundary, 3), 6)]
    lower_splits = [GeotechSplit(round(boundary, 3), 8.0, 7)]

    upper_intervals, _ = _mm_clamped_intervals(upper_splits, 0.0, boundary)
    lower_intervals, _ = _mm_clamped_intervals(lower_splits, boundary, 8.0)

    assert upper_intervals, "the upper segment must keep its band"
    assert lower_intervals, "the lower segment must keep its band"
    assert upper_intervals[-1][1] == lower_intervals[0][0], (
        "the two segments share one physical boundary; their bands must meet "
        f"exactly, got a gap of {lower_intervals[0][0] - upper_intervals[-1][1]:.6f} m"
    )


def test_sl2_interior_boundaries_and_classes_pass_through_untouched() -> None:
    """SL2 — the clamp only ever moves the OUTER edges; interior tiling survives."""
    splits = [GeotechSplit(2.0, 3.5, 6), GeotechSplit(3.5, 5.0, 7), GeotechSplit(5.0, 6.0, 8)]
    intervals, classes = _mm_clamped_intervals(splits, 2.0004, 5.9997)
    assert intervals == [(2.0, 3.5), (3.5, 5.0), (5.0, 6.0)]
    assert classes == [6, 7, 8]


def test_sl3_a_sub_millimetre_extent_yields_no_interval_rather_than_a_sliver() -> None:
    """SL3 — a segment thinner than the grid produces nothing to write."""
    splits = [GeotechSplit(4.0, 4.0, 6)]
    intervals, classes = _mm_clamped_intervals(splits, 4.00001, 4.00048)
    assert intervals == []
    assert classes == []
