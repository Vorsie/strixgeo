"""Unit tests for the OrganicContent lab test."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.lab.organic_content import OrganicContent


class TestOrganicContentConstructionAndValidation:
    def test_minimal_construction(self) -> None:
        oc = OrganicContent(sample_id=uuid4())
        assert oc.carbon_pct is None
        assert oc.matter_pct is None

    def test_carbon_only(self) -> None:
        # DOV typically reports OC only — leave OM None rather than auto-deriving
        oc = OrganicContent(sample_id=uuid4(), carbon_pct=2.5)
        assert oc.carbon_pct == 2.5
        assert oc.matter_pct is None

    def test_matter_only(self) -> None:
        # Some labs report OM directly via loss on ignition
        oc = OrganicContent(
            sample_id=uuid4(),
            matter_pct=5.0,
            method="Loss on ignition",
        )
        assert oc.matter_pct == 5.0
        assert oc.carbon_pct is None

    def test_both_reported(self) -> None:
        oc = OrganicContent(
            sample_id=uuid4(),
            carbon_pct=2.5,
            matter_pct=4.3,
        )
        assert oc.carbon_pct == 2.5
        assert oc.matter_pct == 4.3

    def test_negative_carbon_rejected(self) -> None:
        with pytest.raises(ValueError, match="carbon_pct must be in"):
            OrganicContent(sample_id=uuid4(), carbon_pct=-0.1)

    def test_negative_matter_rejected(self) -> None:
        with pytest.raises(ValueError, match="matter_pct must be in"):
            OrganicContent(sample_id=uuid4(), matter_pct=-0.1)

    def test_carbon_above_100_rejected(self) -> None:
        with pytest.raises(ValueError, match="carbon_pct must be in"):
            OrganicContent(sample_id=uuid4(), carbon_pct=100.1)

    def test_matter_above_100_rejected(self) -> None:
        with pytest.raises(ValueError, match="matter_pct must be in"):
            OrganicContent(sample_id=uuid4(), matter_pct=100.1)
