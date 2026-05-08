"""Unit tests for the Sample entity."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.borehole.sample import Sample


class TestSampleConstruction:
    def test_minimal_construction(self) -> None:
        bh = uuid4()
        s = Sample(borehole_id=bh, depth_top_m=2.0, depth_base_m=3.0)
        assert s.borehole_id == bh
        assert s.depth_top_m == 2.0
        assert s.depth_base_m == 3.0
        assert s.description == ""
        assert s.sample_type is None
        assert s.id is not None

    def test_full_construction(self) -> None:
        s = Sample(
            borehole_id=uuid4(),
            depth_top_m=18.0,
            depth_base_m=19.0,
            description="grain size sample",
            sample_number="19",
            sample_type="geroerd",
            composition="Enkelvoudig monster",
            instrument="pulsboor",
        )
        assert s.sample_number == "19"
        assert s.instrument == "pulsboor"

    def test_spot_sample_equal_depths_allowed(self) -> None:
        # DOV uses equal van/tot for spot samples — see grondmonsters.0 in our probe
        s = Sample(borehole_id=uuid4(), depth_top_m=79.0, depth_base_m=79.0)
        assert s.depth_top_m == s.depth_base_m


class TestSampleValidation:
    def test_negative_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="depth_top_m cannot be negative"):
            Sample(borehole_id=uuid4(), depth_top_m=-0.1, depth_base_m=1.0)

    def test_base_below_top_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be >= depth_top_m"):
            Sample(borehole_id=uuid4(), depth_top_m=2.0, depth_base_m=1.0)
