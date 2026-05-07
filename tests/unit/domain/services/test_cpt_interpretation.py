"""Unit tests for CPT interpretation functions."""

import pytest

from groundmodel.domain.services.cpt_interpretation import (
    calculate_ic,
    calculate_ic_series,
    classify_soil_ic,
)


class TestCalculateIc:
    def test_clay_range(self) -> None:
        # qtn=10, fr=1.0 → sqrt((3.47-1)² + (0+1.22)²) = sqrt(6.1009+1.4884) ≈ 2.755
        assert calculate_ic(10.0, 1.0) == pytest.approx(2.755, abs=0.001)

    def test_sand_mixture_range(self) -> None:
        # qtn=100, fr=1.0 → sqrt((3.47-2)² + (0+1.22)²) = sqrt(2.1609+1.4884) ≈ 1.910
        assert calculate_ic(100.0, 1.0) == pytest.approx(1.910, abs=0.001)

    def test_clean_sand_range(self) -> None:
        # qtn=400, fr=0.5 → sqrt((3.47-2.602)² + (-0.301+1.22)²) ≈ 1.264
        assert calculate_ic(400.0, 0.5) == pytest.approx(1.264, abs=0.001)

    def test_returns_float(self) -> None:
        assert isinstance(calculate_ic(50.0, 1.0), float)


class TestClassifySoilIc:
    @pytest.mark.parametrize(
        "ic, expected",
        [
            (3.7, "Sensitive fine-grained"),
            (3.2, "Organic soils"),
            (2.8, "Clays: silty clay to clay"),
            (2.3, "Silt mixtures: clayey silt to silty clay"),
            (1.6, "Sand mixtures: silty sand to sandy silt"),
            (1.0, "Sands: clean sand to silty sand"),
        ],
    )
    def test_classification_zones(self, ic: float, expected: str) -> None:
        assert classify_soil_ic(ic) == expected

    def test_boundary_at_3_60_is_organic(self) -> None:
        assert classify_soil_ic(3.60) == "Organic soils"

    def test_boundary_at_1_31_is_sands(self) -> None:
        assert classify_soil_ic(1.31) == "Sands: clean sand to silty sand"


class TestCalculateIcSeries:
    def test_basic_series_all_valid(self) -> None:
        result = calculate_ic_series([20.0, 5.0, 0.5], [0.5, 3.0, 8.0])
        assert len(result) == 3
        assert all(v is not None for v in result)

    def test_none_rf_yields_none(self) -> None:
        assert calculate_ic_series([10.0], [None]) == [None]

    def test_zero_rf_yields_none(self) -> None:
        assert calculate_ic_series([10.0], [0.0]) == [None]

    def test_zero_qc_yields_none(self) -> None:
        assert calculate_ic_series([0.0], [1.0]) == [None]

    def test_mixed_valid_and_none(self) -> None:
        result = calculate_ic_series([10.0, 20.0, 5.0], [1.0, None, 3.0])
        assert len(result) == 3
        assert result[0] is not None
        assert result[1] is None
        assert result[2] is not None

    def test_output_matches_direct_calculate_ic(self) -> None:
        qc, rf = 10.0, 1.0
        series_result = calculate_ic_series([qc], [rf])
        assert series_result[0] == pytest.approx(calculate_ic(qc / 0.1, rf), abs=1e-9)
