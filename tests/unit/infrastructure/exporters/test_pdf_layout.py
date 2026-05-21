"""Unit pins for ``packed_column_positions`` — debt #52 slice 1 layout helper."""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.exporters.pdf_layout import (
    DEFAULT_MAX_NUDGE_M,
    packed_column_positions,
)


def test_p1_empty_input_returns_empty() -> None:
    """Defensive: zero-column layout returns empty list, no crash."""
    assert packed_column_positions([], []) == []


def test_p2_mismatched_lengths_raise() -> None:
    """``true_xs`` and ``band_widths_m`` must align in length."""
    with pytest.raises(ValueError, match="same length"):
        packed_column_positions([0.0, 1.0], [10.0])


def test_p3_already_spaced_columns_are_unchanged() -> None:
    """Bands that don't overlap stay at their true positions."""
    # Three columns at 0, 100, 200 with 10m bands — far apart, no nudge.
    out = packed_column_positions([0.0, 100.0, 200.0], [10.0, 10.0, 10.0])
    assert out == pytest.approx([0.0, 100.0, 200.0])


def test_p4_overlapping_columns_pack_with_gap() -> None:
    """Columns at the same x with 10 m bands → second nudges to the right
    by exactly band-width so they touch edge-to-edge."""
    out = packed_column_positions([0.0, 0.0], [10.0, 10.0])
    # First column at 0, second nudged so centre-to-centre = band width.
    assert out[0] == pytest.approx(0.0)
    assert out[1] == pytest.approx(10.0)


def test_p5_nudge_is_capped_at_max_nudge_m() -> None:
    """Many same-x columns: each subsequent one tries to nudge, but the
    cap binds — column N can move at most ``max_nudge_m`` from its true
    position regardless of how many columns precede it."""
    # 10 columns all at x=0, 10 m bands. Without the cap, column 9 would
    # land at x=90. With a cap of 35 m, column 9 lands at 35 (its hard
    # limit) and overlaps the previous bands beyond that point.
    n = 10
    out = packed_column_positions([0.0] * n, [10.0] * n, max_nudge_m=35.0)
    # First column unaffected.
    assert out[0] == pytest.approx(0.0)
    # By the time we get past column 3 (centre 30) the cap starts to
    # bind.  Every column at or after that lands at its cap.
    for i, x in enumerate(out):
        assert x <= 35.0 + 1e-9, f"column {i} exceeded cap"
    assert out[-1] == pytest.approx(35.0)


def test_p6_output_preserves_input_order() -> None:
    """Out-of-order input is sorted internally for the pack, but the
    returned list is aligned with the caller's input order."""
    # Input: column 0 is at x=100, column 1 at x=0. After packing,
    # column 1 (the leftward one) stays at 0 and column 0 stays at 100
    # — but the OUTPUT list must have output[0] = column-0's position.
    out = packed_column_positions([100.0, 0.0], [10.0, 10.0])
    assert out[0] == pytest.approx(100.0)
    assert out[1] == pytest.approx(0.0)


def test_p7_edge_gap_respected() -> None:
    """``edge_gap_m`` widens the per-pair clearance."""
    # Two same-x columns, 10 m bands, 5 m gap → centre-to-centre = 15.
    out = packed_column_positions([0.0, 0.0], [10.0, 10.0], edge_gap_m=5.0)
    assert out[1] - out[0] == pytest.approx(15.0)


def test_p8_default_cap_matches_owner_directive() -> None:
    """The 35 m default is the owner-directed cap and must not drift
    silently."""
    assert DEFAULT_MAX_NUDGE_M == 35.0
