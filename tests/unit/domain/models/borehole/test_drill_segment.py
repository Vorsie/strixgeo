"""Unit tests for the DrillSegment value object."""

import pytest

from groundmodel.domain.models.borehole.drill_segment import DrillSegment


class TestDrillSegmentConstruction:
    def test_valid_segment(self) -> None:
        seg = DrillSegment(top_m=0.5, base_m=2.0, method="edelmanboring")
        assert seg.top_m == 0.5
        assert seg.base_m == 2.0
        assert seg.method == "edelmanboring"

    def test_top_zero_allowed(self) -> None:
        seg = DrillSegment(top_m=0.0, base_m=0.5, method="spade")
        assert seg.top_m == 0.0

    def test_is_frozen(self) -> None:
        seg = DrillSegment(top_m=0.0, base_m=1.0, method="spade")
        with pytest.raises(Exception):
            seg.method = "kerboor"  # type: ignore[misc]


class TestDrillSegmentValidation:
    def test_negative_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="top_m cannot be negative"):
            DrillSegment(top_m=-0.1, base_m=1.0, method="spade")

    def test_base_equal_top_constructs_successfully(self) -> None:
        # The cross-field invariant base_m > top_m is enforced in the
        # parser (DovBoringParser.parse_drill_segments) as a
        # ValidationIssue, not by raising here — debt #15 +
        # CLAUDE.md "Data Integrity Rules §5".
        seg = DrillSegment(top_m=1.0, base_m=1.0, method="spade")
        assert seg.top_m == seg.base_m

    def test_base_below_top_constructs_successfully(self) -> None:
        # Same — inverted interval is a parser-level ValidationIssue,
        # not a dataclass-level raise.
        seg = DrillSegment(top_m=2.0, base_m=1.0, method="spade")
        assert seg.top_m == 2.0
        assert seg.base_m == 1.0

    def test_empty_method_rejected(self) -> None:
        # Single-field guards (non-emptiness here, non-negativity
        # above) stay on the dataclass — they're not cross-field.
        with pytest.raises(ValueError, match="method cannot be empty"):
            DrillSegment(top_m=0.0, base_m=1.0, method="")
