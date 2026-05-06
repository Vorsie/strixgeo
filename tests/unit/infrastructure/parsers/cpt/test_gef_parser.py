"""Unit tests for GEFParser — header, data, type detection, normalisation, validation."""
from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_HEADER = (
    "#TESTID= CPT-01\n"
    "#XYID= 32000, 200000.0, 100000.0\n"
    "#ZID= 32001, 5.0\n"
    "#COLUMN= 3\n"
    "#COLUMNINFO= 1, m, depth, 1\n"
    "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
    "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
)

_BASE_DATA = "0.20; 1.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"


def _gef(header: str = _BASE_HEADER, data: str = _BASE_DATA) -> str:
    return header + "#EOH=\n" + data


def _codes(result) -> set[str]:
    return {i.code for i in result.issues}


def _error_codes(result) -> set[str]:
    return {i.code for i in result.issues if i.level == ValidationLevel.ERROR}


def _warning_codes(result) -> set[str]:
    return {i.code for i in result.issues if i.level == ValidationLevel.WARNING}


@pytest.fixture
def parser() -> GEFParser:
    return GEFParser()


# ---------------------------------------------------------------------------
# Header parsing
# ---------------------------------------------------------------------------

class TestHeaderParsing:
    def test_test_id_parsed(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.header.test_id == "CPT-01"

    def test_xyid_parsed(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.header.epsg == 32000
        assert result.header.x == pytest.approx(200000.0)
        assert result.header.y == pytest.approx(100000.0)

    def test_zid_parsed(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.header.z_epsg == 32001
        assert result.header.z == pytest.approx(5.0)

    def test_project_id_trailing_comma_stripped(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#PROJECTID= P-001,\n"
        result = parser.parse(_gef(header=header))
        assert result.header.project_id == "P-001"

    def test_measurementvar_net_area_ratio(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#MEASUREMENTVAR= 3, 0.80\n"
        result = parser.parse(_gef(header=header))
        assert result.header.net_area_ratio == pytest.approx(0.80)

    def test_measurementvar_pre_drill(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#MEASUREMENTVAR= 13, 1.5\n"
        result = parser.parse(_gef(header=header))
        assert result.header.pre_drill_m == pytest.approx(1.5)

    def test_measurementvar_cone_type_mechanical(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#MEASUREMENTVAR= 12, 1\n"
        result = parser.parse(_gef(header=header))
        assert result.header.cone_type_code == 1

    def test_inline_semicolon_comment_stripped(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-02; this is a comment\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        result = parser.parse(_gef(header=header))
        assert result.header.test_id == "CPT-02"

    def test_missing_eoh_raises_parse_error(self, parser: GEFParser) -> None:
        with pytest.raises(ParseError, match="EOH"):
            parser.parse(_BASE_HEADER)


# ---------------------------------------------------------------------------
# Data parsing
# ---------------------------------------------------------------------------

class TestDataParsing:
    def test_semicolon_separated_rows_loaded(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert len(result.data) == 3

    def test_whitespace_separated_rows_loaded(self, parser: GEFParser) -> None:
        data = "0.20 1.0 0.05\n0.40 1.5 0.06\n0.60 2.0 0.07\n"
        result = parser.parse(_gef(data=data))
        assert len(result.data) == 3

    def test_empty_data_raises_parse_error(self, parser: GEFParser) -> None:
        with pytest.raises(ParseError, match="no data rows"):
            parser.parse(_gef(data=""))

    def test_comment_and_blank_lines_skipped(self, parser: GEFParser) -> None:
        data = "\n! comment\n0.20; 1.0; 0.05\n\n0.40; 1.5; 0.06\n"
        result = parser.parse(_gef(data=data))
        assert len(result.data) == 2

    def test_void_values_become_null(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#COLUMNVOID= 3, -9999.0\n"
        data = "0.20; 1.0; -9999.0\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert result.data["fs_mpa"][0] is None
        assert result.data["fs_mpa"][1] is not None


# ---------------------------------------------------------------------------
# CPT type detection
# ---------------------------------------------------------------------------

class TestCPTTypeDetection:
    def test_cptu_detected_from_qty6(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 4\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
            "#COLUMNINFO= 4, MPa, pore pressure u2, 6\n"
            "#MEASUREMENTVAR= 3, 0.80\n"
        )
        data = "0.20; 1.0; 0.05; 0.01\n0.40; 1.5; 0.06; 0.01\n0.60; 2.0; 0.07; 0.01\n"
        result = parser.parse(_gef(header=header, data=data))
        assert result.cpt_type == CPTType.CPTU

    def test_cpte_detected_when_fs_present_no_u2(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.cpt_type == CPTType.CPTE

    def test_cptm_detected_from_mechanical_cone_type(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#MEASUREMENTVAR= 12, 1\n"
        result = parser.parse(_gef(header=header))
        assert result.cpt_type == CPTType.CPTM


# ---------------------------------------------------------------------------
# Column renaming and depth fallback
# ---------------------------------------------------------------------------

class TestColumnRenaming:
    def test_standard_columns_present_after_rename(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert {"depth_m", "qc_mpa", "fs_mpa"}.issubset(result.data.columns)

    def test_penetration_length_renamed_to_depth(self, parser: GEFParser) -> None:
        # qty 11 = penetration length; no qty 1 depth column
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, penetration length, 11\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "depth_m" in result.data.columns
        assert "length_m" not in result.data.columns


# ---------------------------------------------------------------------------
# Unit normalisation
# ---------------------------------------------------------------------------

class TestUnitNormalisation:
    def test_kpa_normalised_to_mpa(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, kPa, cone resistance, 2\n"
        )
        data = "0.20; 1000.0\n0.40; 2000.0\n0.60; 3000.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert result.data["qc_mpa"][0] == pytest.approx(1.0)

    def test_bar_normalised_to_mpa(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, bar, cone resistance, 2\n"
        )
        data = "0.20; 10.0\n0.40; 20.0\n0.60; 30.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert result.data["qc_mpa"][0] == pytest.approx(1.0)

    def test_mpa_values_unchanged(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.data["qc_mpa"][0] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Rf calculation
# ---------------------------------------------------------------------------

class TestRfCalculation:
    def test_rf_calculated_from_qc_and_fs(self, parser: GEFParser) -> None:
        # row 0: fs=0.05, qc=1.0 → Rf = 5.0%
        result = parser.parse(_gef())
        assert result.data["rf_pct"][0] == pytest.approx(5.0)

    def test_rf_null_when_qc_is_zero(self, parser: GEFParser) -> None:
        data = "0.20; 0.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(data=data))
        assert result.data["rf_pct"][0] is None

    def test_rf_not_recalculated_when_already_present(self, parser: GEFParser) -> None:
        # qty 4 = rf_pct already in data; _calculate_rf should be skipped
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 4\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
            "#COLUMNINFO= 4, %, friction ratio, 4\n"
        )
        data = "0.20; 1.0; 0.05; 9.9\n0.40; 1.5; 0.06; 9.9\n0.60; 2.0; 0.07; 9.9\n"
        result = parser.parse(_gef(header=header, data=data))
        assert result.data["rf_pct"][0] == pytest.approx(9.9)


# ---------------------------------------------------------------------------
# Validation — coordinates
# ---------------------------------------------------------------------------

class TestValidationCoordinates:
    def test_no_coordinates_raises_warning(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "NO_COORDINATES" in _codes(result)

    def test_zero_coordinates_raises_warning(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 0.0, 0.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "ZERO_COORDINATES" in _codes(result)

    def test_missing_epsg_raises_warning(self, parser: GEFParser) -> None:
        # Empty EPSG field → epsg=None, but x/y present
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= , 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "NO_EPSG" in _codes(result)

    def test_missing_elevation_raises_info(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "NO_ELEVATION" in _codes(result)

    def test_valid_coordinates_produce_no_coordinate_issues(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert not {"NO_COORDINATES", "ZERO_COORDINATES", "NO_EPSG", "NO_ELEVATION"} & _codes(result)


# ---------------------------------------------------------------------------
# Validation — required columns
# ---------------------------------------------------------------------------

class TestValidationColumns:
    def test_missing_qc_is_error(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 1\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
        )
        data = "0.20\n0.40\n0.60\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "MISSING_COLUMN" in _error_codes(result)

    def test_missing_u2_for_cptu_is_error(self, parser: GEFParser) -> None:
        # qty 6 in column_map triggers CPTU, but col 4 not in data (COLUMN= 3)
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 3\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
            "#COLUMNINFO= 4, MPa, pore pressure, 6\n"
        )
        data = "0.20; 1.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "MISSING_COLUMN" in _error_codes(result)

    def test_u2_not_required_for_cpte(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.cpt_type == CPTType.CPTE
        assert "MISSING_COLUMN" not in _error_codes(result)


# ---------------------------------------------------------------------------
# Validation — depth monotonicity
# ---------------------------------------------------------------------------

class TestValidationDepth:
    def test_decreasing_depth_is_error(self, parser: GEFParser) -> None:
        data = "0.20; 1.0; 0.05\n0.40; 1.5; 0.06\n0.30; 2.0; 0.07\n"
        result = parser.parse(_gef(data=data))
        assert "DEPTH_NOT_MONOTONIC" in _error_codes(result)

    def test_equal_depths_are_error(self, parser: GEFParser) -> None:
        data = "0.20; 1.0; 0.05\n0.20; 1.5; 0.06\n0.40; 2.0; 0.07\n"
        result = parser.parse(_gef(data=data))
        assert "DEPTH_NOT_MONOTONIC" in _error_codes(result)

    def test_strictly_increasing_depth_is_ok(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert "DEPTH_NOT_MONOTONIC" not in _codes(result)


# ---------------------------------------------------------------------------
# Validation — value checks
# ---------------------------------------------------------------------------

class TestValidationValues:
    def test_negative_qc_is_warning(self, parser: GEFParser) -> None:
        data = "0.20; -0.5; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(data=data))
        assert "NEGATIVE_VALUES" in _warning_codes(result)

    def test_null_values_reported_as_info(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#COLUMNVOID= 3, -9999.0\n"
        data = "0.20; 1.0; -9999.0\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "NULL_VALUES" in _codes(result)

    def test_pre_drill_reported_from_mvar13(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#MEASUREMENTVAR= 13, 1.5\n"
        data = "0.20; 1.0; 0.05\n1.00; 1.5; 0.06\n1.80; 2.0; 0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "PRE_DRILL" in _codes(result)

    def test_pre_drill_inferred_when_data_starts_deep(self, parser: GEFParser) -> None:
        # first depth > 0.5 m and no MVAR 13 → inferred pre-drill
        data = "1.00; 1.0; 0.05\n1.40; 1.5; 0.06\n1.80; 2.0; 0.07\n"
        result = parser.parse(_gef(data=data))
        assert "PRE_DRILL" in _codes(result)

    def test_cptu_without_net_area_ratio_is_warning(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 4\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
            "#COLUMNINFO= 4, MPa, pore pressure u2, 6\n"
            # no MEASUREMENTVAR 3 (net area ratio)
        )
        data = "0.20; 1.0; 0.05; 0.01\n0.40; 1.5; 0.06; 0.01\n0.60; 2.0; 0.07; 0.01\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "NO_NET_AREA_RATIO" in _warning_codes(result)

    def test_rf_out_of_range_is_warning(self, parser: GEFParser) -> None:
        # fs=0.50, qc=1.0 → Rf = 50% (outside 0.05–15%)
        data = "0.20; 1.0; 0.50\n0.40; 1.5; 0.60\n0.60; 2.0; 0.70\n"
        result = parser.parse(_gef(data=data))
        assert "RF_OUT_OF_RANGE" in _warning_codes(result)

    def test_qc_spikes_detected(self, parser: GEFParser) -> None:
        # row 1: qc=10.0 is 10× neighbours (1.0) → spike
        data = (
            "0.20; 1.0; 0.05\n"
            "0.40; 10.0; 0.05\n"
            "0.60; 1.0; 0.05\n"
            "0.80; 1.0; 0.05\n"
            "1.00; 1.0; 0.05\n"
        )
        result = parser.parse(_gef(data=data))
        assert "QC_SPIKES" in _warning_codes(result)


# ---------------------------------------------------------------------------
# parse_bytes
# ---------------------------------------------------------------------------

class TestParseBytes:
    def test_utf8_bytes_decoded_correctly(self, parser: GEFParser) -> None:
        result = parser.parse_bytes(_gef().encode("utf-8"))
        assert len(result.data) == 3

    def test_non_utf8_bytes_decoded_via_fallback(self, parser: GEFParser) -> None:
        # é and è are invalid UTF-8 single bytes — triggers windows-1252 fallback
        gef = _gef().replace("CPT-01", "CPT-\xe9l\xe8ve")
        result = parser.parse_bytes(gef.encode("latin-1"))
        assert len(result.data) == 3
