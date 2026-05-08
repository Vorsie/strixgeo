"""Unit tests for the AtterbergLimits lab test."""

from uuid import uuid4

import pytest

from groundmodel.domain.models.lab.atterberg_limits import AtterbergLimits


class TestAtterbergConstruction:
    def test_minimal_construction(self) -> None:
        ab = AtterbergLimits(sample_id=uuid4())
        assert ab.liquid_limit_pct is None
        assert ab.plastic_limit_pct is None
        assert ab.non_plastic is None
        assert ab.plasticity_index_pct is None

    def test_typical_clay(self) -> None:
        # Typical CL clay: LL=45, PL=22, PI=23
        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=45.0,
            plastic_limit_pct=22.0,
        )
        assert ab.plasticity_index_pct == pytest.approx(23.0)

    def test_high_plasticity_clay(self) -> None:
        # High-plasticity clay (CH): LL=85, PL=30, PI=55
        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=85.0,
            plastic_limit_pct=30.0,
        )
        assert ab.plasticity_index_pct == pytest.approx(55.0)

    def test_method_and_date(self) -> None:
        from datetime import date as date_type

        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=40.0,
            plastic_limit_pct=20.0,
            method="Casagrande",
            test_date=date_type(2025, 6, 13),
        )
        assert ab.method == "Casagrande"


class TestAtterbergPlasticityIndex:
    def test_pi_none_when_ll_missing(self) -> None:
        ab = AtterbergLimits(sample_id=uuid4(), plastic_limit_pct=20.0)
        assert ab.plasticity_index_pct is None

    def test_pi_none_when_pl_missing(self) -> None:
        ab = AtterbergLimits(sample_id=uuid4(), liquid_limit_pct=40.0)
        assert ab.plasticity_index_pct is None

    def test_pi_none_when_non_plastic(self) -> None:
        # Even with both limits set, non_plastic=True suppresses PI
        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=25.0,
            plastic_limit_pct=22.0,
            non_plastic=True,
        )
        assert ab.plasticity_index_pct is None

    def test_pi_returned_when_non_plastic_false(self) -> None:
        # non_plastic=False is a positive plastic statement; PI computed normally
        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=40.0,
            plastic_limit_pct=20.0,
            non_plastic=False,
        )
        assert ab.plasticity_index_pct == pytest.approx(20.0)

    def test_pi_can_be_negative_returned_as_measured(self) -> None:
        # Anomalous lab result (PL > LL) — return as-measured, don't clamp
        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=20.0,
            plastic_limit_pct=22.0,
        )
        assert ab.plasticity_index_pct == pytest.approx(-2.0)


class TestAtterbergValidation:
    def test_negative_ll_rejected(self) -> None:
        with pytest.raises(ValueError, match="liquid_limit_pct must be in"):
            AtterbergLimits(sample_id=uuid4(), liquid_limit_pct=-1.0)

    def test_excessive_ll_rejected(self) -> None:
        with pytest.raises(ValueError, match="liquid_limit_pct must be in"):
            AtterbergLimits(sample_id=uuid4(), liquid_limit_pct=1001.0)

    def test_negative_pl_rejected(self) -> None:
        with pytest.raises(ValueError, match="plastic_limit_pct must be in"):
            AtterbergLimits(sample_id=uuid4(), plastic_limit_pct=-0.1)

    def test_extreme_bentonite_ll_accepted(self) -> None:
        # Bentonites can read LL above 500 — must be accepted
        ab = AtterbergLimits(
            sample_id=uuid4(),
            liquid_limit_pct=600.0,
            plastic_limit_pct=50.0,
        )
        assert ab.plasticity_index_pct == pytest.approx(550.0)
