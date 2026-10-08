"""Printed-table reports: "the import takes the EXACT printed values from the tables".

Owner test 2026-10-08: a test report prints every sounding as a graph sheet
(one pasted picture) AND as a numeric table, a row per 0.20 m (D, TAW, qc,
Fs, "Rf, %", "Inclinatie, °", then the calculated φ' and C). The triage must
find every sounding, join the table sheets by their "<report> - <id>"
header, and the import must store the printed values as printed: no raster
digitising, no resampling. The calculated columns are never imported (the
platform does not ingest design parameters). The "voorgeduwd ... tot een
diepte van N m" remark is the pre-drill (owner vocabulary: voorboring); a
missing block of depths INSIDE the table is a drilled interval and stays a
gap, never interpolated (owner ruling "a", 2026-10-04).
"""

from __future__ import annotations

import functools

import pytest

from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding_adapter import (
    DigitisedSoundingAdapter,
)
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header import PdfImportHeader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note_constants import (
    NOTE_DRILLED_INTERVALS,
)

from . import _synthetic_table_pdf as synth

_SHA = "0" * 64


@functools.cache
def _default_triage() -> tuple[PdfReportDigest, dict[str, DigitisedSounding]]:
    """Triage the default synthetic report once (read-only results, shared)."""
    return PdfReportTriager(ocr=False).run(synth.table_report(), _SHA)


def _triage(
    spec: synth.TableReportSpec | None = None,
) -> tuple[PdfReportDigest, dict[str, DigitisedSounding]]:
    """Triage the synthetic report without OCR."""
    if spec is None:
        return _default_triage()
    return PdfReportTriager(ocr=False).run(synth.table_report(spec), _SHA)


def _only(digest: PdfReportDigest) -> ReportSounding:
    """Return the one listed sounding."""
    assert len(digest.campaign) == 1, digest.to_dict()
    return digest.campaign[0]


def _imported(
    spec: synth.TableReportSpec | None = None,
) -> tuple[ReportSounding, GEFParseResult]:
    """Triage, then adapt the sounding exactly as the import does."""
    digest, soundings = _triage(spec)
    listed = _only(digest)
    header = PdfImportHeader(
        test_id=listed.sounding_id or listed.key,
        project_id=listed.project_id or "PDF",
        x=listed.x,
        y=listed.y,
        epsg=listed.epsg,
        ground_level_m=listed.ground_level_m,
        z_epsg=listed.z_epsg,
        test_date=listed.test_date,
        sources={"x": "sheet"},
    )
    identity = PdfReportIdentity(file_name="report.pdf", file_sha=_SHA, ocr_available=False)
    result = DigitisedSoundingAdapter().to_parse_result(soundings[listed.key], header, identity)
    return listed, result


def test_the_triage_finds_the_sounding_from_its_printed_table() -> None:
    """The graph sheet and the two table sheets are one sounding, read from the table."""
    digest, soundings = _triage()
    listed = _only(digest)
    assert listed.sounding_id == synth.SOUNDING
    assert listed.graph_kind is GraphKind.TABLE
    assert listed.page_numbers == (1, 2, 3)
    assert listed.digitised
    assert "printed-table" in digest.profiles
    assert set(soundings) == {listed.key}


def test_the_sheet_header_gives_kind_date_position_and_report_number() -> None:
    """Header: CPT-E, the printed date, GPS X/Y in the system the report names."""
    listed, result = _imported()
    assert listed.test_date == "04-07-2022"
    assert listed.x == pytest.approx(synth.X)
    assert listed.y == pytest.approx(synth.Y)
    # The report names Lambert 72 and TAW once; the sheets print "GPS X/Y".
    assert listed.epsg == 31370
    assert listed.z_epsg == 5710
    # The report number is the GEF-compatible project id of the sounding.
    assert listed.project_number == synth.REPORT
    assert result.header.project_id == synth.REPORT
    assert result.header.test_id == synth.SOUNDING
    assert result.cpt_type is CPTType.CPTE


def test_ground_level_is_the_printed_level_plus_the_printed_depth() -> None:
    """Ground level = TAW + D of the rows; recorded as derived from the table."""
    listed, result = _imported()
    assert listed.ground_level_m == pytest.approx(synth.GROUND_LEVEL)
    table = result.import_provenance["printed_table"]
    assert table["ground_level_m"] == pytest.approx(synth.GROUND_LEVEL)
    assert table["first_row"] == {"depth_m": 1.01, "level_m": 4.84}
    assert table["level_mismatches"] == []


def test_the_import_takes_the_exact_printed_values() -> None:
    """Every stored row is a printed row: same depths, same values, no resampling."""
    _, result = _imported()
    data = result.data
    depths = data["depth_m"].to_list()
    assert depths == synth.default_depths()
    for row in data.iter_rows(named=True):
        d = row["depth_m"]
        assert row["qc_mpa"] == pytest.approx(synth.qc_of(d))
        assert row["fs_mpa"] == pytest.approx(synth.fs_of(d))
        assert row["rf_pct"] == pytest.approx(synth.rf_of(d))
    assert result.import_provenance["graph_kind"] == "printed-table"
    assert result.import_provenance["printed_table"]["source_kind"] == "printed-table"


def test_the_calculated_columns_are_never_imported() -> None:
    """φ' and C are calculated values: not stored, only their presence noted."""
    _, result = _imported()
    assert set(result.data.columns) == {"depth_m", "qc_mpa", "fs_mpa", "rf_pct"}
    table = result.import_provenance["printed_table"]
    assert table["derived_columns_ignored"] == ["φ'", "C"]
    # Inclination is measured but the CPT has no column for it.
    assert table["columns_not_stored"] == ["Inclinatie, °"]


def test_the_voorgeduwd_remark_is_the_pre_drill_not_a_drilled_interval() -> None:
    """'voorgeduwd ... tot een diepte van 1 m' = pre-drill 1 m; the table starts below it."""
    _, result = _imported()
    assert result.import_provenance["pre_drill_m"] == pytest.approx(1.0)
    assert result.import_provenance["printed_table"]["pre_drill_m"] == pytest.approx(1.0)
    assert all(top > 1.01 for top, _ in result.import_provenance["drilled_intervals_m"])


def test_a_missing_block_of_depths_inside_the_table_is_a_drilled_gap() -> None:
    """Rows 4.21-4.61 are not printed: drilled 4.01-4.81, no row and no value inside."""
    listed, result = _imported()
    assert result.import_provenance["drilled_intervals_m"] == [[4.01, 4.81]]
    depths = result.data["depth_m"].to_list()
    assert not any(4.01 < d < 4.81 for d in depths)
    assert NOTE_DRILLED_INTERVALS in [n.code for n in listed.notes]
    assert any(i.code == "PDF_DRILLED_INTERVALS" for i in result.issues)


def test_a_page_break_inside_the_table_is_not_a_gap() -> None:
    """5.01 ends sheet 2, 5.21 starts sheet 3: one regular step, nothing drilled there."""
    _, result = _imported()
    for top, base in result.import_provenance["drilled_intervals_m"]:
        assert not top <= 5.01 < 5.21 <= base


def test_a_printed_rf_that_its_own_fs_and_qc_cannot_give_is_flagged_and_kept() -> None:
    """Rf kept as printed; flagged when outside fs / qc x 100 within the printed rounding."""
    spec = synth.TableReportSpec(overrides={(6.01, "Rf, %"): "9,99"})
    _, result = _imported(spec)
    rows = {r["depth_m"]: r for r in result.data.iter_rows(named=True)}
    assert rows[6.01]["rf_pct"] == pytest.approx(9.99)
    flagged = [i for i in result.issues if i.code == "PDF_TABLE_RF_MISMATCH"]
    assert len(flagged) == 1
    assert flagged[0].params["depths_m"] == [6.01]
    # The plain synthetic table is consistent: nothing flagged.
    _, clean = _imported()
    assert not [i for i in clean.issues if i.code == "PDF_TABLE_RF_MISMATCH"]


def test_a_level_that_does_not_match_ground_minus_depth_is_flagged() -> None:
    """TAW printed 1 m off on one row: the row is kept, the mismatch listed."""
    spec = synth.TableReportSpec(overrides={(7.01, "TAW"): "-0,16"})
    _, result = _imported(spec)
    assert result.import_provenance["printed_table"]["level_mismatches"] == [[7.01, -0.16]]
    assert any(i.code == "PDF_TABLE_LEVEL_MISMATCH" for i in result.issues)


def test_a_malformed_row_is_left_out_and_named() -> None:
    """A row whose qc is not a number is not stored; the issue names page and text."""
    spec = synth.TableReportSpec(overrides={(2.01, "qc"): "x,yz"})
    _, result = _imported(spec)
    assert 2.01 not in result.data["depth_m"].to_list()
    rejected = [i for i in result.issues if i.code == "PDF_TABLE_ROWS_REJECTED"]
    assert len(rejected) == 1
    assert rejected[0].params["rows"][0]["page"] == 2
    assert "x,yz" in rejected[0].params["rows"][0]["text"]


def test_a_missing_cell_is_empty_not_invented() -> None:
    """A blank Rf cell stays empty (null); the row is still stored."""
    spec = synth.TableReportSpec(overrides={(3.01, "Rf, %"): ""})
    _, result = _imported(spec)
    rows = {r["depth_m"]: r for r in result.data.iter_rows(named=True)}
    assert rows[3.01]["rf_pct"] is None
    assert rows[3.01]["qc_mpa"] == pytest.approx(synth.qc_of(3.01))


def test_a_cpt_m_table_stores_qc_only_and_names_the_total_force_column() -> None:
    """CPT-M (proef type TM4): qc stored, Qt (total force, kN) not converted, listed."""
    spec = synth.TableReportSpec(cone="M", sounding="CPTE002")
    listed, result = _imported(spec)
    assert listed.sounding_id == "CPTE002"
    assert result.cpt_type is CPTType.CPTM
    assert set(result.data.columns) == {"depth_m", "qc_mpa"}
    table = result.import_provenance["printed_table"]
    assert table["test_type"] == "TM4"
    assert table["columns_not_stored"] == ["Qt"]


def test_a_closed_cone_remark_breaks_the_curve_between_its_rows() -> None:
    """'gesloten punt vanaf 7,32 m tot 7,34 m : geen meetwaarden': no line drawn across it."""
    spec = synth.TableReportSpec(
        remarks=[
            "Opmerking: voorgeduwd met vaste punt tot een diepte van 1 m : geen meetwaarden",
            "gesloten punt vanaf 7,32 m tot 7,34 m : geen meetwaarden",
        ]
    )
    _, result = _imported(spec)
    table = result.import_provenance["printed_table"]
    assert table["no_measurement_intervals_m"] == [[7.32, 7.34]]
    assert [7.21, 7.41] in result.import_provenance["drilled_intervals_m"]


def test_a_calculation_table_of_the_same_sounding_is_ignored() -> None:
    """A bearing-capacity table (Gnd, Pb, qd) is calculated output: never a data sheet."""
    spec = synth.TableReportSpec(calculation_page=True)
    listed, result = _imported(spec)
    assert listed.page_numbers == (1, 2, 3)
    assert result.import_provenance["printed_table"]["calculation_pages_ignored"] == [4]


def test_without_a_named_coordinate_system_the_position_is_left_for_the_user() -> None:
    """No system named anywhere: X/Y not placed (never guessed); the import asks for them."""
    spec = synth.TableReportSpec(system_line=False)
    listed, result = _imported(spec)
    assert listed.epsg is None
    assert any(i.code == "PDF_NO_XY" for i in result.issues)


def test_a_row_whose_depth_is_not_a_number_does_not_end_the_table() -> None:
    """A garbled depth cell rejects that row only; the rows below it on the sheet are read."""
    spec = synth.TableReportSpec(overrides={(2.01, "D"): "2,O1"})
    _, result = _imported(spec)
    depths = result.data["depth_m"].to_list()
    assert 2.01 not in depths
    assert 2.21 in depths and 5.01 in depths
    rejected = [i for i in result.issues if i.code == "PDF_TABLE_ROWS_REJECTED"]
    assert rejected and "2,O1" in rejected[0].params["rows"][0]["text"]
