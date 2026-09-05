"""Unit tests for GEFParser — header, data, type detection, normalisation, validation."""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
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
        # 32000 is the GEF code; 31370 is what it means. Both are kept —
        # see TestCoordinateSystemCodeIsNotAnEpsgCode.
        assert result.header.xy_code == 32000
        assert result.header.epsg == 31370
        assert result.header.x == pytest.approx(200000.0)
        assert result.header.y == pytest.approx(100000.0)

    def test_zid_parsed(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.header.z_code == 32001
        assert result.header.z_epsg == 5710
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

    def test_rf_source_is_computed_when_derived(self, parser: GEFParser) -> None:
        # Base GEF has qc + fs but no qty 4, so the parser computes Rf.
        result = parser.parse(_gef())
        assert result.rf_source is DerivedValueSource.COMPUTED

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
        # Source-provided Rf must be tagged MEASURED, not COMPUTED.
        assert result.rf_source is DerivedValueSource.MEASURED

    def test_rf_source_none_when_only_qc(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        result = parser.parse(_gef(header=header, data="0.20; 1.0\n0.40; 1.5\n"))
        assert "rf_pct" not in result.data.columns
        assert result.rf_source is None

    def test_qty_15_routes_to_qt_mpa_for_cptu(self, parser: GEFParser) -> None:
        # qty 15 = CPTU corrected cone resistance (qt = qc + u2(1-a))
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 4\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
            "#COLUMNINFO= 4, MPa, qt corrected, 15\n"
        )
        data = "0.20; 1.0; 0.05; 1.02\n0.40; 1.5; 0.06; 1.55\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "qt_mpa" in result.data.columns
        assert "q_total_mpa" not in result.data.columns
        assert result.data["qt_mpa"][0] == pytest.approx(1.02)

    def test_qty_128_routes_to_q_total_mpa_for_cptm(self, parser: GEFParser) -> None:
        # qty 128 = CPTM totaalweerstand (totally different physical quantity
        # from qty 15) — must land in its own column, never qt_mpa.
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#MEASUREMENTVAR= 12, 1.0\n"
            "#COLUMN= 3\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, totaalweerstand, 128\n"
        )
        data = "0.20; 1.0; 1.20\n0.40; 1.5; 1.80\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "q_total_mpa" in result.data.columns
        assert "qt_mpa" not in result.data.columns
        assert result.data["q_total_mpa"][0] == pytest.approx(1.20)


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
        assert not {"NO_COORDINATES", "ZERO_COORDINATES", "NO_EPSG", "NO_ELEVATION"} & _codes(
            result
        )


class TestValidationCrsBounds:
    """Coordinates outside the declared CRS's area raise a WARNING that names
    the EPSG and the values (owner ruling 2026-09-05)."""

    def test_coordinates_outside_the_declared_systems_area_raise_warning(
        self, parser: GEFParser
    ) -> None:
        # GEF code 32000 → EPSG:31370 (Belgian Lambert 72), but the values are
        # an Amsterdam RD New easting/northing — far north of Belgium.
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 121000.0, 487000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "COORDINATES_OUTSIDE_CRS_BOUNDS" in _warning_codes(result)
        # The message names the system and the offending values.
        message = next(
            i.message for i in result.issues if i.code == "COORDINATES_OUTSIDE_CRS_BOUNDS"
        )
        assert "31370" in message
        assert "121000" in message and "487000" in message

    def test_coordinates_inside_the_area_raise_nothing(self, parser: GEFParser) -> None:
        # The base header's (200000, 100000) is a valid Belgian Lambert 72 point.
        result = parser.parse(_gef())
        assert "COORDINATES_OUTSIDE_CRS_BOUNDS" not in _codes(result)

    def test_swapped_x_and_y_are_flagged(self, parser: GEFParser) -> None:
        # (265000, 145000) is a real far-east Belgian point; the file wrote the
        # easting and northing the wrong way round.
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 145000.0, 265000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "COORDINATES_OUTSIDE_CRS_BOUNDS" in _warning_codes(result)

    def test_unknown_system_skips_the_check_no_double_report(self, parser: GEFParser) -> None:
        # Code 99999 is neither a known GEF code nor a supported EPSG → epsg is
        # None. The unresolved-code story is UNKNOWN_CRS_CODE's; the bounds check
        # must stay silent so the reader is not sent looking twice.
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 99999, 121000.0, 487000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        )
        data = "0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"
        result = parser.parse(_gef(header=header, data=data))
        assert "UNKNOWN_CRS_CODE" in _codes(result)
        assert "COORDINATES_OUTSIDE_CRS_BOUNDS" not in _codes(result)

    def test_zero_coordinates_skip_the_bounds_check_no_double_report(
        self, parser: GEFParser
    ) -> None:
        # (0, 0) is already told by ZERO_COORDINATES; the bounds check must not
        # pile a second warning on the same fact.
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
        assert "COORDINATES_OUTSIDE_CRS_BOUNDS" not in _codes(result)


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
            "0.20; 1.0; 0.05\n0.40; 10.0; 0.05\n0.60; 1.0; 0.05\n0.80; 1.0; 0.05\n1.00; 1.0; 0.05\n"
        )
        result = parser.parse(_gef(data=data))
        assert "QC_SPIKES" in _warning_codes(result)

    def test_hybrid_method_detected_on_step_size_change(self, parser: GEFParser) -> None:
        # 20 rows at 0.01 m step (electric), then 20 rows at 0.20 m step (mechanical)
        electric = "".join(f"{0.01 * i:.2f}; 1.0; 0.05\n" for i in range(1, 21))
        mechanical = "".join(f"{0.20 + 0.20 * i:.2f}; 2.0; 0.08\n" for i in range(20))
        data = electric + mechanical
        result = parser.parse(_gef(data=data))
        assert "HYBRID_METHOD" in _warning_codes(result)

    def test_uniform_step_size_no_hybrid_flag(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert "HYBRID_METHOD" not in _codes(result)


# ---------------------------------------------------------------------------
# Validation — partial u2
# ---------------------------------------------------------------------------


class TestValidationPartialU2:
    _CPTU_HEADER = (
        "#TESTID= CPT-01\n"
        "#XYID= 32000, 200000.0, 100000.0\n"
        "#ZID= 32001, 5.0\n"
        "#COLUMN= 4\n"
        "#COLUMNINFO= 1, m, depth, 1\n"
        "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
        "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
        "#COLUMNINFO= 4, MPa, pore pressure u2, 6\n"
        "#COLUMNVOID= 4, -9999.0\n"
        "#MEASUREMENTVAR= 3, 0.80\n"
    )

    def test_partial_u2_flagged_when_u2_starts_deep(self, parser: GEFParser) -> None:
        # First 10 rows: u2 void; last 10 rows: u2 real — transition at 1.00 m
        data = "".join(f"{0.10 * i:.2f}; 1.0; 0.05; -9999.0\n" for i in range(1, 11)) + "".join(
            f"{1.00 + 0.10 * i:.2f}; 1.0; 0.05; 0.02\n" for i in range(10)
        )
        result = parser.parse(_gef(header=self._CPTU_HEADER, data=data))
        assert "PARTIAL_U2" in _warning_codes(result)

    def test_no_partial_u2_when_u2_present_from_start(self, parser: GEFParser) -> None:
        data = "0.10; 1.0; 0.05; 0.02\n0.20; 1.5; 0.06; 0.02\n0.30; 2.0; 0.07; 0.02\n"
        result = parser.parse(_gef(header=self._CPTU_HEADER, data=data))
        assert "PARTIAL_U2" not in _codes(result)

    def test_no_partial_u2_when_u2_void_only_in_predrill_zone(self, parser: GEFParser) -> None:
        header = self._CPTU_HEADER + "#MEASUREMENTVAR= 13, 0.5\n"
        # u2 void up to 0.60 m (just past the 0.5 m pre-drill + 0.5 m tolerance)
        data = "".join(f"{0.10 * i:.2f}; 1.0; 0.05; -9999.0\n" for i in range(1, 7)) + "".join(
            f"{0.60 + 0.10 * i:.2f}; 1.0; 0.05; 0.02\n" for i in range(5)
        )
        result = parser.parse(_gef(header=header, data=data))
        assert "PARTIAL_U2" not in _codes(result)

    def test_no_partial_u2_for_cpte(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert "PARTIAL_U2" not in _codes(result)

    def test_no_partial_u2_when_u2_entirely_void(self, parser: GEFParser) -> None:
        # All u2 void — NULL_VALUES covers this; PARTIAL_U2 should not fire
        data = "0.10; 1.0; 0.05; -9999.0\n0.20; 1.5; 0.06; -9999.0\n0.30; 2.0; 0.07; -9999.0\n"
        result = parser.parse(_gef(header=self._CPTU_HEADER, data=data))
        assert "PARTIAL_U2" not in _codes(result)


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


class TestPenetrationLengthVsCorrectedDepth:
    """GEF quantity 1 is *sondeerlengte*; quantity 11 is the corrected depth.

    In the GEF-CPT-Report standard, quantity 1 is the penetration length —
    the length of rod pushed into the ground, measured along the (possibly
    inclined) rod. Quantity 11 is the inclination-corrected vertical depth
    below ground level. Because the rod always deviates, the corrected
    depth is the *shallower* of the two, and it is the one an engineer
    means by "depth".

    A real DOV file states this in its own header:
    ``#COLUMNINFO= 1, m, Lengte, 1`` and ``#COLUMNINFO= 5, m, Diepte, 11``
    — Lengte (length) is quantity 1, Diepte (depth) is quantity 11 — with a
    last row of 20.22 (Lengte) against 20.212 (Diepte).
    """

    _BOTH_HEADER = (
        "#TESTID= CPT-01\n"
        "#XYID= 32000, 200000.0, 100000.0\n"
        "#ZID= 32001, 5.0\n"
        "#COLUMN= 3\n"
        "#COLUMNINFO= 1, m, Lengte, 1\n"
        "#COLUMNINFO= 2, MPa, Conusweerstand, 2\n"
        "#COLUMNINFO= 3, m, Diepte, 11\n"
    )
    # Lengte (pushed) always ≥ Diepte (vertical), exactly as the real file reads.
    _BOTH_DATA = "20.18; 26.0; 20.172\n20.20; 26.1; 20.192\n20.22; 26.8; 20.212\n"

    def test_corrected_depth_is_the_depth_column(self, parser: GEFParser) -> None:
        result = parser.parse(_gef(header=self._BOTH_HEADER, data=self._BOTH_DATA))
        # The corrected value (Diepte, qty 11) is what "depth" means.
        assert result.data["depth_m"][2] == pytest.approx(20.212)

    def test_penetration_length_is_the_length_column(self, parser: GEFParser) -> None:
        result = parser.parse(_gef(header=self._BOTH_HEADER, data=self._BOTH_DATA))
        assert result.data["length_m"][2] == pytest.approx(20.22)

    def test_depth_is_never_deeper_than_penetration_length(self, parser: GEFParser) -> None:
        result = parser.parse(_gef(header=self._BOTH_HEADER, data=self._BOTH_DATA))
        depths = result.data["depth_m"].to_list()
        lengths = result.data["length_m"].to_list()
        assert all(d <= ln for d, ln in zip(depths, lengths, strict=True))

    def test_length_only_file_falls_back_to_length_and_says_so(self, parser: GEFParser) -> None:
        # Only quantity 1 (penetration length) — genuinely uncorrected. The
        # parser may use it as depth, but must tell the engineer it did.
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, Lengte, 1\n"
            "#COLUMNINFO= 2, MPa, Conusweerstand, 2\n"
        )
        result = parser.parse(_gef(header=header, data="0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"))
        assert "depth_m" in result.data.columns
        assert "UNCORRECTED_DEPTH" in _codes(result)

    def test_corrected_depth_only_file_is_not_flagged_uncorrected(self, parser: GEFParser) -> None:
        # Only quantity 11 — already inclination-corrected, nothing to warn about.
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, Diepte, 11\n"
            "#COLUMNINFO= 2, MPa, Conusweerstand, 2\n"
        )
        result = parser.parse(_gef(header=header, data="0.20; 1.0\n0.40; 1.5\n0.60; 2.0\n"))
        assert "depth_m" in result.data.columns
        assert "UNCORRECTED_DEPTH" not in _codes(result)


class TestCoordinateSystemCodeIsNotAnEpsgCode:
    """``#XYID``/``#ZID`` carry GEF coordinate-system codes, not EPSG codes.

    GEF 32000 is Belgian Lambert 72 (EPSG:31370) and GEF 31000 is Dutch RD
    (EPSG:28992) — the numbers are from the GEF codelist and mean nothing to
    PostGIS or proj4. The raw code is kept as the source-format token it is;
    ``epsg`` carries the translation. A code we cannot identify yields **no**
    EPSG rather than a plausible-looking wrong one.
    """

    def _header(self, xyid: str, zid: str = "#ZID= 32001, 5.0\n") -> str:
        return (
            "#TESTID= CPT-01\n"
            f"{xyid}"
            f"{zid}"
            "#COLUMN= 2\n"
            "#COLUMNINFO= 1, m, Diepte, 11\n"
            "#COLUMNINFO= 2, MPa, Conusweerstand, 2\n"
        )

    def test_gef_32000_is_belgian_lambert_72(self, parser: GEFParser) -> None:
        gef = _gef(header=self._header("#XYID= 32000, 200000.0, 100000.0\n"), data="0.2; 1.0\n")
        result = parser.parse(gef)
        assert result.header.epsg == 31370

    def test_raw_gef_code_is_kept_verbatim(self, parser: GEFParser) -> None:
        gef = _gef(header=self._header("#XYID= 32000, 200000.0, 100000.0\n"), data="0.2; 1.0\n")
        result = parser.parse(gef)
        assert result.header.xy_code == 32000

    def test_gef_31000_is_dutch_rd(self, parser: GEFParser) -> None:
        gef = _gef(header=self._header("#XYID= 31000, 155000.0, 463000.0\n"), data="0.2; 1.0\n")
        result = parser.parse(gef)
        assert result.header.epsg == 28992

    def test_a_real_epsg_in_the_field_passes_through(self, parser: GEFParser) -> None:
        # Non-DOV writers emit a true EPSG here; 31370 is not a GEF code, so
        # it can only mean EPSG.
        gef = _gef(header=self._header("#XYID= 31370, 200000.0, 100000.0\n"), data="0.2; 1.0\n")
        result = parser.parse(gef)
        assert result.header.epsg == 31370

    def test_unknown_code_yields_no_epsg_and_says_so(self, parser: GEFParser) -> None:
        gef = _gef(header=self._header("#XYID= 99999, 200000.0, 100000.0\n"), data="0.2; 1.0\n")
        result = parser.parse(gef)
        assert result.header.xy_code == 99999
        assert result.header.epsg is None
        assert "UNKNOWN_CRS_CODE" in _codes(result)

    def test_zid_32001_is_mtaw(self, parser: GEFParser) -> None:
        gef = _gef(header=self._header("#XYID= 32000, 200000.0, 100000.0\n"), data="0.2; 1.0\n")
        result = parser.parse(gef)
        assert result.header.z_code == 32001
        assert result.header.z_epsg == 5710


class TestRecordAndColumnSeparators:
    """A GEF declaring its own separators is a valid GEF and must import.

    ``#RECORDSEPARATOR=`` names the character that terminates every data
    record; ``#COLUMNSEPARATOR=`` names the character between values. Both
    are common in Dutch GEF exports. A file that declares them is not
    malformed, so not one of its rows may be dropped.
    """

    def test_record_separator_terminated_rows_all_import(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#RECORDSEPARATOR= !\n"
        data = "0.20; 1.0; 0.05!\n0.40; 1.5; 0.06!\n0.60; 2.0; 0.07!\n"
        result = parser.parse(_gef(header=header, data=data))
        assert len(result.data) == 3

    def test_column_separator_pipe_splits_values(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#COLUMNSEPARATOR= |\n"
        data = "0.20|1.0|0.05\n0.40|1.5|0.06\n0.60|2.0|0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert len(result.data) == 3
        assert result.data["qc_mpa"][1] == pytest.approx(1.5)

    def test_both_separators_declared_together(self, parser: GEFParser) -> None:
        header = _BASE_HEADER + "#COLUMNSEPARATOR= |\n#RECORDSEPARATOR= !\n"
        data = "0.20|1.0|0.05!\n0.40|1.5|0.06!\n0.60|2.0|0.07!\n"
        result = parser.parse(_gef(header=header, data=data))
        assert len(result.data) == 3

    def test_semicolon_column_separator_declaration_is_not_read_as_a_comment(
        self, parser: GEFParser
    ) -> None:
        # Real DOV files write ``#COLUMNSEPARATOR=;`` — the ``;`` is the
        # declared value, not the start of an inline comment.
        header = _BASE_HEADER + "#COLUMNSEPARATOR=;\n"
        result = parser.parse(_gef(header=header))
        assert result.header.column_separator == ";"
        assert len(result.data) == 3

    def test_a_separator_that_could_be_part_of_a_number_is_not_honoured(
        self, parser: GEFParser
    ) -> None:
        # Splitting on '-' would read the void value -9999.0 as +9999.0 — a
        # sign flip nothing downstream would catch. The declaration loses.
        header = _BASE_HEADER + "#COLUMNSEPARATOR= -\n#COLUMNVOID= 3, -9999.0\n"
        data = "0.20; 1.0; -9999.0\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert result.data["fs_mpa"][0] is None
        assert result.data["fs_mpa"][1] == pytest.approx(0.06)

    def test_a_record_separator_that_is_also_a_column_separator_is_not_honoured(
        self, parser: GEFParser
    ) -> None:
        """A record separator that also splits values is refused, not applied."""
        # A file declaring ``#RECORDSEPARATOR=;`` declares the SAME character
        # DOV declares as its column separator. Honouring it would cut every
        # data line after its first value: the frame still comes back with its
        # full set of correctly-named columns (padded with None), so the parser
        # would report success on a file it silently emptied. The declaration
        # loses; the values are read to the end of the line.
        header = _BASE_HEADER + "#RECORDSEPARATOR=;\n"
        result = parser.parse(_gef(header=header))
        assert len(result.data) == 3
        assert result.data["qc_mpa"][1] == pytest.approx(1.5)
        assert result.data["fs_mpa"][2] == pytest.approx(0.07)

    def test_a_record_separator_that_could_be_part_of_a_number_is_not_honoured(
        self, parser: GEFParser
    ) -> None:
        """A record separator that can occur inside a number is refused too."""
        # Same rule as the column separator: cutting the record at '-' throws
        # away every value that follows a minus sign on the line. Here the void
        # marker sits in the MIDDLE column, so honouring the declaration would
        # also lose the perfectly good sleeve friction behind it.
        header = _BASE_HEADER + "#RECORDSEPARATOR= -\n#COLUMNVOID= 2, -9999.0\n"
        data = "0.20; -9999.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
        result = parser.parse(_gef(header=header, data=data))
        assert len(result.data) == 3
        assert result.data["qc_mpa"][0] is None
        assert result.data["fs_mpa"][0] == pytest.approx(0.05)

    def test_unparseable_rows_name_the_offending_line_not_an_empty_file(
        self, parser: GEFParser
    ) -> None:
        # When every row is dropped the diagnostic must point at the rows,
        # not claim the file has none.
        data = "0.20; 1.0; 0.05@\n0.40; 1.5; 0.06@\n"
        with pytest.raises(ParseError, match="none could be parsed"):
            parser.parse(_gef(data=data))


class TestDuplicateQuantityNumbers:
    """Two columns declaring the same quantity is a refusal, not a crash.

    A duplicated ``#COLUMNINFO`` line, or two pore-pressure channels both
    tagged quantity 6, means the file does not say which column is which.
    The import must be refused with the duplicated quantity named — never an
    unhandled Polars error that escapes past every ``ParseError`` handler.
    """

    def test_duplicate_quantity_is_refused_by_name(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 4\n"
            "#COLUMNINFO= 1, m, Diepte, 11\n"
            "#COLUMNINFO= 2, MPa, Conusweerstand, 2\n"
            "#COLUMNINFO= 3, MPa, waterspanning u2, 6\n"
            "#COLUMNINFO= 4, MPa, waterspanning u2 tweede filter, 6\n"
        )
        data = "0.20; 1.0; 0.01; 0.02\n0.40; 1.5; 0.01; 0.02\n"
        with pytest.raises(ParseError, match="quantity 6"):
            parser.parse(_gef(header=header, data=data))

    def test_duplicate_refusal_names_the_columns(self, parser: GEFParser) -> None:
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 3\n"
            "#COLUMNINFO= 1, m, Diepte, 11\n"
            "#COLUMNINFO= 2, MPa, Conusweerstand, 2\n"
            "#COLUMNINFO= 3, MPa, Conusweerstand nogmaals, 2\n"
        )
        data = "0.20; 1.0; 1.0\n0.40; 1.5; 1.5\n"
        with pytest.raises(ParseError, match="columns 2, 3"):
            parser.parse(_gef(header=header, data=data))


class TestColumnCountCap:
    """A ``#COLUMN=`` that declares an absurd column count is refused, not allocated.

    The attack: a ~200-byte GEF file that declares a huge column count drives
    the padded-frame allocation (one ``None`` per declared column per row) into
    the tens of GB and OOMs the backend, costing an engineer their session.
    The cap turns that into a refused parse — an ERROR ``ValidationIssue`` on
    the result, the same mechanism ``MISSING_COLUMN`` already uses — and the
    frame is built from the columns the data actually has, so nothing large is
    ever allocated.
    """

    def test_million_columns_is_refused_not_allocated(self, parser: GEFParser) -> None:
        """A declared million columns is refused, never allocated."""
        header = (
            "#TESTID= CPT-01\n"
            "#XYID= 32000, 200000.0, 100000.0\n"
            "#ZID= 32001, 5.0\n"
            "#COLUMN= 1000000\n"
            "#COLUMNINFO= 1, m, depth, 1\n"
            "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
            "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
        )
        result = parser.parse(_gef(header=header))
        # Refused via the ERROR-issue mechanism, never a raw allocation.
        assert result.has_errors
        assert "TOO_MANY_COLUMNS" in _error_codes(result)
        # Proof nothing huge was allocated: the frame fell back to the data's
        # real width (3 columns + a derived rf_pct = 4), far below both the
        # declared million and the 512 cap — a clamp-to-cap would read 512, a
        # missing guard would read 1_000_000.
        assert result.data.width < 100

    def test_realistic_column_count_is_not_refused(self, parser: GEFParser) -> None:
        """A real GEF's column count is nowhere near the cap and parses clean."""
        # A legitimate file at the base 3-column shape must parse without the cap
        # biting — the cap only refuses the absurd declaration, never a real GEF.
        result = parser.parse(_gef())
        assert "TOO_MANY_COLUMNS" not in _error_codes(result)


class TestElevationSourceStamping:
    """Pin the ``elevation_source`` stamp on every GEF parse (debt #8).

    A GEF file's ``#ZID=`` header is the canonical source of Z for the
    file-import path. When it's present the parser stamps ``GEF``;
    when it's absent (rare, but parsable) the stamp is ``NONE`` so the
    row surfaces through the same "needs-Z" affordance as a DOV row
    without ``Z_mTAW``.
    """

    def test_gef_z_present_stamps_gef(self, parser: GEFParser) -> None:
        result = parser.parse(_gef())
        assert result.header.z == 5.0
        assert result.elevation_source == ElevationSource.GEF

    def test_gef_z_absent_stamps_none(self, parser: GEFParser) -> None:
        header_without_zid = _BASE_HEADER.replace("#ZID= 32001, 5.0\n", "")
        result = parser.parse(_gef(header=header_without_zid))
        assert result.header.z is None
        assert result.elevation_source == ElevationSource.NONE


class TestNonFiniteValues:
    """A GEF line can carry ``nan`` / ``inf`` / ``-inf`` tokens (``float()`` reads
    them straight in). A non-finite number poisons everything downstream — a NaN
    depth sorts undefined and an inf coordinate breaks every spatial query — so
    the parser replaces every non-finite SERIES value with null, and a non-finite
    ``depth_m`` (an unusable anchor, not just a missing reading) is additionally
    flagged as an ERROR.
    """

    @pytest.mark.parametrize("token", ["nan", "inf", "-inf"])
    def test_non_finite_depth_is_nulled_and_flagged_error(
        self, parser: GEFParser, token: str
    ) -> None:
        """A non-finite depth is nulled AND raises an ERROR-level issue."""
        data = f"{token}; 1.0; 0.05\n0.40; 1.5; 0.06\n"
        result = parser.parse(_gef(data=data))
        depths = result.data["depth_m"].to_list()
        assert depths[0] is None, f"non-finite depth ({token}) must be nulled, got {depths[0]!r}"
        assert all(d is None or math.isfinite(d) for d in depths)
        assert "NON_FINITE_DEPTH" in _error_codes(result), (
            f"a non-finite depth ({token}) must raise an ERROR issue; "
            f"errors were {_error_codes(result)}"
        )

    @pytest.mark.parametrize("token", ["nan", "inf", "-inf"])
    def test_non_finite_measurement_is_nulled_and_warned_not_errored(
        self, parser: GEFParser, token: str
    ) -> None:
        """A non-finite qc reading is nulled and flagged WARNING — not ERROR.

        A missing reading is a hole, not a corrupt anchor: the row is still
        placeable at its (finite) depth.
        """
        data = f"0.20; {token}; 0.05\n0.40; 1.5; 0.06\n"
        result = parser.parse(_gef(data=data))
        qc = result.data["qc_mpa"].to_list()
        assert qc[0] is None, f"non-finite qc ({token}) must be nulled, got {qc[0]!r}"
        assert "NON_FINITE_VALUES" in _warning_codes(result)
        assert "NON_FINITE_DEPTH" not in _error_codes(result)

    def test_finite_values_produce_no_non_finite_issue(self, parser: GEFParser) -> None:
        """The normal case pays nothing — no non-finite issue, values intact."""
        result = parser.parse(_gef())
        assert "NON_FINITE_DEPTH" not in _error_codes(result)
        assert "NON_FINITE_VALUES" not in _warning_codes(result)
        assert result.data["depth_m"].to_list() == [0.2, 0.4, 0.6]
