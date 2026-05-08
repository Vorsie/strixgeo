"""Unit tests for the WaterContent lab test."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.lab.water_content import WaterContent


class TestWaterContentConstructionAndValidation:
    def test_minimal_construction(self) -> None:
        wc = WaterContent(sample_id=uuid4())
        assert wc.content_pct is None
        assert wc.method is None

    def test_typical_clay_value(self) -> None:
        # Soft normally consolidated clay: w ~ 30-50 %
        wc = WaterContent(
            sample_id=uuid4(),
            content_pct=42.0,
            method="Oven drying",
        )
        assert wc.content_pct == 42.0
        assert wc.method == "Oven drying"

    def test_peat_value_above_100_allowed(self) -> None:
        # Peat / organic soil: w can easily exceed 100 % since w = m_water / m_dry
        wc = WaterContent(sample_id=uuid4(), content_pct=350.0)
        assert wc.content_pct == 350.0

    def test_dry_soil_zero_allowed(self) -> None:
        wc = WaterContent(sample_id=uuid4(), content_pct=0.0)
        assert wc.content_pct == 0.0

    def test_negative_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            WaterContent(sample_id=uuid4(), content_pct=-0.1)

    def test_excessive_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            WaterContent(sample_id=uuid4(), content_pct=1001.0)
