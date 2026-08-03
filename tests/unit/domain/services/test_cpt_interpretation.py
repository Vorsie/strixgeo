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
    """Ic classification names the soil Robertson's bands name.

    The old table was one step too coarse in every band and invented a
    "Sensitive fine-grained" class above Ic 3.60 — zone 1 is read off the
    Qtn-Fr chart, not off Ic, so no Ic value may produce it (audit
    2026-08-02).  The cases below are written in the domain's own words: an
    Ic of 3.2 is a CLAY, an Ic of 2.8 is a SILT MIXTURE.
    """

    @pytest.mark.parametrize(
        "ic, expected",
        [
            (3.7, "Organic soils: clay to peat"),
            (3.2, "Clays: silty clay to clay"),
            (2.8, "Silt mixtures: clayey silt to silty clay"),
            (2.3, "Sand mixtures: silty sand to sandy silt"),
            (1.6, "Sands: clean sand to silty sand"),
            (1.0, "Gravelly sand to dense sand"),
        ],
    )
    def test_classification_zones(self, ic: float, expected: str) -> None:
        assert classify_soil_ic(ic) == expected

    def test_no_ic_value_is_ever_sensitive_fine_grained(self) -> None:
        # Sweep the whole plausible Ic range: zone 1 must be unreachable.
        labels = {classify_soil_ic(ic / 100.0) for ic in range(1, 601)}
        assert not any("Sensitive" in label for label in labels)

    def test_boundary_at_3_60_is_organic(self) -> None:
        # Bands are half-open [min, max): a value on a breakpoint belongs to
        # the band above it.
        assert classify_soil_ic(3.60) == "Organic soils: clay to peat"

    def test_boundary_at_1_31_is_sands(self) -> None:
        assert classify_soil_ic(1.31) == "Sands: clean sand to silty sand"


class TestCalculateIcSeries:
    # depths, qc, fs chosen so net_qc >> sigma_v — stress effect is small,
    # results are predictable without knowing the exact normalised value.

    def test_basic_series_all_valid(self) -> None:
        depths = [1.0, 2.0, 3.0]
        qc = [20.0, 5.0, 0.5]
        # fs chosen to produce positive Fr in every row
        fs = [0.1, 0.15, 0.04]
        result = calculate_ic_series(depths, qc, fs)
        assert len(result) == 3
        assert all(v is not None for v in result)

    def test_none_fs_yields_none(self) -> None:
        assert calculate_ic_series([1.0], [10.0], [None]) == [None]

    def test_zero_qc_yields_none(self) -> None:
        assert calculate_ic_series([1.0], [0.0], [0.05]) == [None]

    def test_zero_fs_yields_none(self) -> None:
        # fs=0 → Fr=0 → log10(0) is undefined
        assert calculate_ic_series([1.0], [10.0], [0.0]) == [None]

    def test_mixed_valid_and_none(self) -> None:
        result = calculate_ic_series([1.0, 2.0, 3.0], [10.0, 5.0, 20.0], [0.1, None, 0.2])
        assert len(result) == 3
        assert result[0] is not None
        assert result[1] is None
        assert result[2] is not None

    def test_low_qc_high_friction_gives_high_ic(self) -> None:
        # Low qc, high fs → clay-like → Ic > 2.6
        result = calculate_ic_series([2.0], [0.5], [0.05], gwt_m=1.0)
        assert result[0] is not None
        assert result[0] > 2.6

    def test_high_qc_low_friction_gives_low_ic(self) -> None:
        # High qc, low fs → sand → Ic < 2.0
        result = calculate_ic_series([2.0], [20.0], [0.04], gwt_m=1.0)
        assert result[0] is not None
        assert result[0] < 2.0
