"""Unit tests for the CaCO3Content lab test."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.lab.caco3_content import CaCO3Content


class TestCaCO3ConstructionAndValidation:
    def test_minimal_construction(self) -> None:
        gs = CaCO3Content(sample_id=uuid4())
        assert gs.content_pct is None
        assert gs.method is None

    def test_typical_value(self) -> None:
        gs = CaCO3Content(
            sample_id=uuid4(),
            content_pct=15.0,
            method="Calcimetrie",
        )
        assert gs.content_pct == 15.0
        assert gs.method == "Calcimetrie"

    def test_zero_allowed(self) -> None:
        gs = CaCO3Content(sample_id=uuid4(), content_pct=0.0)
        assert gs.content_pct == 0.0

    def test_full_allowed(self) -> None:
        gs = CaCO3Content(sample_id=uuid4(), content_pct=100.0)
        assert gs.content_pct == 100.0

    def test_negative_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            CaCO3Content(sample_id=uuid4(), content_pct=-0.1)

    def test_above_100_rejected(self) -> None:
        with pytest.raises(ValueError, match="must be in"):
            CaCO3Content(sample_id=uuid4(), content_pct=100.1)
