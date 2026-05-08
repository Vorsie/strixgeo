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

    def test_base_equal_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be greater than top_m"):
            DrillSegment(top_m=1.0, base_m=1.0, method="spade")

    def test_base_below_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be greater than top_m"):
            DrillSegment(top_m=2.0, base_m=1.0, method="spade")

    def test_empty_method_rejected(self) -> None:
        with pytest.raises(ValueError, match="method cannot be empty"):
            DrillSegment(top_m=0.0, base_m=1.0, method="")
