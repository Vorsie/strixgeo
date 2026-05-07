"""Integration tests for GEFParser against real DOV CPT files.

Requires data/cpt/ (gitignored). Skipped automatically when absent.

Files under test
----------------
1778054387093.gef  CPTE (TE1) — dual depth/length cols, negative fs in top rows
1778056765226.gef  CPTU (TE2) — pre-drill 1.5 m, void u2 in top rows
1778056769825.gef  CPTM (TM4) — 34 rows, qty-128 total resistance column
1778056773736.gef  CPTM (TM1) — 1316 rows, zero-qc gap at 25.92–26.08 m
1778056778310.gef  CPTM (TM2) — pre-drill 2.2 m, total resistance all void
"""
from __future__ import annotations

from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel

DATA_DIR = Path(__file__).parents[4] / "data" / "cpt"

pytestmark = pytest.mark.skipif(
    not DATA_DIR.exists(),
    reason="DOV data files not present (data/cpt/ is gitignored)",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse(filename: str) -> GEFParseResult:
    return GEFParser().parse_bytes((DATA_DIR / filename).read_bytes())


def _codes(result: GEFParseResult) -> set[str]:
    return {i.code for i in result.issues}


def _error_codes(result: GEFParseResult) -> set[str]:
    return {i.code for i in result.issues if i.level == ValidationLevel.ERROR}


def _warning_codes(result: GEFParseResult) -> set[str]:
    return {i.code for i in result.issues if i.level == ValidationLevel.WARNING}


# ---------------------------------------------------------------------------
# Parametrised smoke tests — every file must parse and carry Belgian EPSG
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("filename", [
    "1778054387093.gef",
    "1778056765226.gef",
    "1778056769825.gef",
    "1778056773736.gef",
    "1778056778310.gef",
])
def test_all_files_parse_without_error(filename: str) -> None:
    result = _parse(filename)
    assert result.data is not None
    assert len(result.data) > 0


@pytest.mark.parametrize("filename", [
    "1778054387093.gef",
    "1778056765226.gef",
    "1778056769825.gef",
    "1778056773736.gef",
    "1778056778310.gef",
])
def test_all_files_have_belgian_lambert_epsg(filename: str) -> None:
    result = _parse(filename)
    assert result.header.epsg == 32000


@pytest.mark.parametrize("filename", [
    "1778054387093.gef",
    "1778056765226.gef",
    "1778056769825.gef",
    "1778056773736.gef",
    "1778056778310.gef",
])
def test_all_files_depth_is_monotonically_increasing(filename: str) -> None:
    result = _parse(filename)
    assert "DEPTH_NOT_MONOTONIC" not in _error_codes(result)


@pytest.mark.parametrize("filename", [
    "1778054387093.gef",
    "1778056765226.gef",
    "1778056769825.gef",
    "1778056773736.gef",
    "1778056778310.gef",
])
def test_all_files_have_no_missing_required_columns(filename: str) -> None:
    result = _parse(filename)
    assert "MISSING_COLUMN" not in _error_codes(result)


@pytest.mark.parametrize("filename", [
    "1778054387093.gef",
    "1778056765226.gef",
    "1778056769825.gef",
    "1778056773736.gef",
])
def test_single_method_files_have_no_hybrid_flag(filename: str) -> None:
    assert "HYBRID_METHOD" not in _warning_codes(_parse(filename))


# ---------------------------------------------------------------------------
# 1778054387093.gef — CPTE (TE1), GEO-25/122-S22
# Dual depth/length columns (qty 1 and qty 11), negative fs in top rows.
# ---------------------------------------------------------------------------

class TestCPTE_GEO25_S22:
    FILE = "1778054387093.gef"

    def test_type_is_cpte(self) -> None:
        assert _parse(self.FILE).cpt_type == CPTType.CPTE

    def test_metadata(self) -> None:
        h = _parse(self.FILE).header
        assert h.test_id == "GEO-25/122-S22"
        assert h.x == pytest.approx(104781.02)
        assert h.y == pytest.approx(187866.48)
        assert h.z == pytest.approx(7.37)
        assert h.net_area_ratio == pytest.approx(0.75)

    def test_row_count(self) -> None:
        assert len(_parse(self.FILE).data) == 1011

    def test_both_depth_and_length_columns_present(self) -> None:
        # qty 1 → depth_m, qty 11 → length_m; depth_m already present so no rename
        cols = _parse(self.FILE).data.columns
        assert "depth_m" in cols
        assert "length_m" in cols

    def test_negative_fs_raises_warning(self) -> None:
        # MEASUREMENTTEXT notes fs lower than expected; top rows contain negative values
        assert "NEGATIVE_VALUES" in _warning_codes(_parse(self.FILE))

    def test_no_pre_drill(self) -> None:
        # No MVAR 13; first depth 0.02 m < 0.5 m threshold
        assert "PRE_DRILL" not in _codes(_parse(self.FILE))


# ---------------------------------------------------------------------------
# 1778056765226.gef — CPTU (TE2), GEO-12/098-S1
# Pre-drill 1.5 m declared via MVAR 13; u2 voided in top rows.
# ---------------------------------------------------------------------------

class TestCPTU_GEO12_S1:
    FILE = "1778056765226.gef"

    def test_type_is_cptu(self) -> None:
        assert _parse(self.FILE).cpt_type == CPTType.CPTU

    def test_metadata(self) -> None:
        h = _parse(self.FILE).header
        assert h.test_id == "GEO-12/098-S1"
        assert h.x == pytest.approx(119917.67)
        assert h.y == pytest.approx(188616.68)
        assert h.z == pytest.approx(9.63)
        assert h.pre_drill_m == pytest.approx(1.5)
        assert h.net_area_ratio == pytest.approx(0.75)

    def test_row_count(self) -> None:
        assert len(_parse(self.FILE).data) == 1283

    def test_u2_column_present(self) -> None:
        assert "u2_mpa" in _parse(self.FILE).data.columns

    def test_u2_is_entirely_void(self) -> None:
        # u2 channel declared but -9999.0 throughout — filter likely dry or malfunctioning
        df = _parse(self.FILE).data
        assert df["u2_mpa"].null_count() == len(df)

    def test_no_partial_u2_when_u2_entirely_void(self) -> None:
        # PARTIAL_U2 only fires when u2 transitions null→non-null; all-void is a different issue
        assert "PARTIAL_U2" not in _warning_codes(_parse(self.FILE))

    def test_no_missing_required_columns(self) -> None:
        assert "MISSING_COLUMN" not in _error_codes(_parse(self.FILE))

    def test_net_area_ratio_present_no_warning(self) -> None:
        assert "NO_NET_AREA_RATIO" not in _warning_codes(_parse(self.FILE))


# ---------------------------------------------------------------------------
# 1778056769825.gef — CPTM (TM4), 1804723_S1
# Only 34 rows; qty-128 total resistance column not in standard mapping.
# ---------------------------------------------------------------------------

class TestCPTM_TM4_1804723:
    FILE = "1778056769825.gef"

    def test_type_is_cptm(self) -> None:
        assert _parse(self.FILE).cpt_type == CPTType.CPTM

    def test_metadata(self) -> None:
        h = _parse(self.FILE).header
        assert h.test_id == "1804723_S1"
        assert h.x == pytest.approx(243988.0)
        assert h.y == pytest.approx(180508.0)
        assert h.z == pytest.approx(43.06)

    def test_row_count(self) -> None:
        assert len(_parse(self.FILE).data) == 34

    def test_no_fs_column(self) -> None:
        # CPTM TM4 has no sleeve friction measurement
        assert "fs_mpa" not in _parse(self.FILE).data.columns

    def test_no_pre_drill(self) -> None:
        # MVAR 13 = 0.0; first depth 0.20 m < 0.5 m threshold
        assert "PRE_DRILL" not in _codes(_parse(self.FILE))

    def test_max_depth(self) -> None:
        assert _parse(self.FILE).data["depth_m"].max() == pytest.approx(6.80)


# ---------------------------------------------------------------------------
# 1778056773736.gef — CPTM (TM1), GEO-16/017-S01
# 1316 rows; gap at 25.92–26.08 m recorded as zero qc (not missing rows).
# ---------------------------------------------------------------------------

class TestCPTM_TM1_GEO16_S01:
    FILE = "1778056773736.gef"

    def test_type_is_cptm(self) -> None:
        assert _parse(self.FILE).cpt_type == CPTType.CPTM

    def test_metadata(self) -> None:
        h = _parse(self.FILE).header
        assert h.test_id == "GEO-16/017-S01"
        assert h.x == pytest.approx(105104.0)
        assert h.y == pytest.approx(197785.0)
        assert h.z == pytest.approx(9.8)

    def test_row_count(self) -> None:
        # Gap rows present in file as zero-qc values; total = 1316
        assert len(_parse(self.FILE).data) == 1316

    def test_max_depth_exceeds_26m(self) -> None:
        assert _parse(self.FILE).data["depth_m"].max() > 26.0

    def test_no_pre_drill(self) -> None:
        # No MVAR 13; first depth 0.16 m < 0.5 m threshold
        assert "PRE_DRILL" not in _codes(_parse(self.FILE))

    def test_depth_gap_rows_have_zero_qc(self) -> None:
        # Rows at 25.94–26.08 m have qc = 0.0 (data gap recorded as zeros)
        import polars as pl
        df = _parse(self.FILE).data
        gap = df.filter((pl.col("depth_m") >= 25.94) & (pl.col("depth_m") <= 26.08))
        assert gap.height == 8
        assert (gap["qc_mpa"] == 0.0).all()


# ---------------------------------------------------------------------------
# 1778056778310.gef — CPTM (TM2), GEO-13/001-S5
# Pre-drill 2.2 m; total resistance column entirely void (-9999.0).
# ---------------------------------------------------------------------------

class TestCPTM_TM2_GEO13_S5:
    FILE = "1778056778310.gef"

    def test_type_is_cptm(self) -> None:
        assert _parse(self.FILE).cpt_type == CPTType.CPTM

    def test_metadata(self) -> None:
        h = _parse(self.FILE).header
        assert h.test_id == "GEO-13/001-S5"
        assert h.x == pytest.approx(105209.1)
        assert h.y == pytest.approx(193875.3)
        assert h.z == pytest.approx(7.35)
        assert h.pre_drill_m == pytest.approx(2.2)

    def test_row_count(self) -> None:
        assert len(_parse(self.FILE).data) == 304

    def test_pre_drill_issue_raised(self) -> None:
        # First data row is at 2.20 m = pre-drill depth → rows within zone flagged
        assert "PRE_DRILL" in _codes(_parse(self.FILE))

    def test_hybrid_method_flagged(self) -> None:
        # Electric portion (0.01 m steps) transitions to mechanical (0.20 m steps) at ~4.60 m
        assert "HYBRID_METHOD" in _warning_codes(_parse(self.FILE))

    def test_total_resistance_voided_only_in_electric_portion(self) -> None:
        """qty 128 (totaalweerstand) maps to qt_mpa; void-masked in the electric portion."""
        import polars as pl

        df = _parse(self.FILE).data
        assert "qt_mpa" in df.columns
        # Electric CPT portion (2.20–4.59 m, 240 rows) has void total resistance
        assert df.filter(pl.col("depth_m") <= 4.59)["qt_mpa"].null_count() == 240
        # Mechanical portion (4.60 m onwards) has real total resistance measurements
        assert df.filter(pl.col("depth_m") >= 4.60)["qt_mpa"].null_count() == 0
