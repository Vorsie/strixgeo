"""Digitised sounding -> the parse result every CPT importer persists.

Owner answers 2026-09-30, pinned in his words:

1. "clipped points stay at the axis maximum with a clipped flag, the printed
   arrow value kept as a note, never interpolated";
3. "elevation-axis sheets: depth = printed ground level - elevation,
   provenance 'derived from plotted elevation' on the CPT";
4. "vector sheets store the vertices as the scans (no resampling); raster
   traces are resampled to 0.02 m";
6. OCR is optional; a sounding read without it says so (PDF_OCR_UNAVAILABLE).

Plus the brief: header name = sounding id, XY from the sheet, Z = ground level,
date, CPT type from the curves present; a sounding without XY cannot be placed
(PDF_NO_XY) unless the user typed it.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding_adapter import (
    DigitisedSoundingAdapter,
)
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header import PdfImportHeader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

REPORT = PdfReportIdentity(file_name="camz-001.pdf", file_sha="f" * 64, ocr_available=True)


def _calibration(reference: DepthReference = DepthReference.DEPTH_BELOW_GROUND) -> PageCalibration:
    return PageCalibration(
        page_number=231,
        coordinate_space="pdf-pt",
        dpi=None,
        depth_reference=reference,
        panels=(),
        ground_level_m=6.02,
        sounding_id="110",
    )


def _curve(
    kind: PanelKind,
    depth: list[float],
    value: list[float],
    clipped: list[bool] | None = None,
    source: GraphKind = GraphKind.VECTOR,
) -> DigitisedCurve:
    return DigitisedCurve(
        kind=kind,
        depth_m=np.array(depth, dtype=float),
        value=np.array(value, dtype=float),
        clipped=np.array(clipped or [False] * len(depth), dtype=bool),
        source=source,
    )


def _sounding(
    curves: list[DigitisedCurve],
    reference: DepthReference = DepthReference.DEPTH_BELOW_GROUND,
    annotations: tuple[tuple[float, str], ...] = (),
) -> DigitisedSounding:
    return DigitisedSounding(
        sounding_id="110",
        page_numbers=(231,),
        calibrations=(_calibration(reference),),
        curves={c.kind: c for c in curves},
        annotations=annotations,
    )


def _header(**overrides: object) -> PdfImportHeader:
    values: dict[str, object] = {
        "test_id": "110",
        "project_id": "CAMZ-001",
        "x": 66980.21,
        "y": 224746.0,
        "epsg": 31370,
        "ground_level_m": 6.02,
        "z_epsg": 5710,
        "test_date": "28-2-2024",
    }
    values.update(overrides)
    return PdfImportHeader(**values)  # type: ignore[arg-type]


def _codes(result: object) -> dict[str, ValidationLevel]:
    return {i.code: i.level for i in result.issues}  # type: ignore[attr-defined]


def test_clipped_points_stay_at_the_axis_maximum_with_a_flag_and_the_printed_value() -> None:
    """Clipped qc stays at 32 MPa, is counted, and the arrow label is kept as a note."""
    qc = _curve(
        PanelKind.QC, [1.0, 1.02, 1.04, 1.06], [20.0, 32.0, 32.0, 25.0], [False, True, True, False]
    )
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding([qc], annotations=((1.03, "38.10"),)), _header(), REPORT
    )
    assert result.data["qc_mpa"].to_list() == [20.0, 32.0, 32.0, 25.0]
    assert _codes(result)["PDF_CLIPPED_POINTS"] is ValidationLevel.WARNING
    clipped = result.import_provenance["clipped"]["qc"]
    assert clipped["count"] == 2
    assert clipped["intervals_m"] == [[1.02, 1.04]]
    assert result.import_provenance["printed_values"] == [[1.03, "38.10"]]


def test_vector_sheets_store_the_vertices_as_the_scans() -> None:
    """Vector: the qc vertices ARE the scans; fs is read at those depths, exactly."""
    depths = [0.52, 0.55, 0.61, 0.66]
    qc = _curve(PanelKind.QC, depths, [3.0, 4.0, 5.0, 6.0])
    fs = _curve(PanelKind.FS, depths, [0.01, 0.02, 0.03, 0.04])
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc, fs]), _header(), REPORT)
    assert result.data["depth_m"].to_list() == depths
    assert result.data["fs_mpa"].to_list() == [0.01, 0.02, 0.03, 0.04]
    assert result.import_provenance["series_sampling"] == "vector vertices (no resampling)"


def test_raster_traces_are_resampled_to_two_centimetres() -> None:
    """Raster: the traced rows are resampled onto a 0.02 m grid."""
    qc = _curve(
        PanelKind.QC, [1.0, 1.013, 1.047, 1.1], [2.0, 2.0, 3.0, 3.0], source=GraphKind.RASTER
    )
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc]), _header(), REPORT)
    steps = np.diff(result.data["depth_m"].to_numpy())
    assert np.allclose(steps, 0.02)
    assert result.import_provenance["series_sampling"] == "raster trace resampled to 0.02 m"


def test_depth_from_an_elevation_axis_is_stamped_as_derived() -> None:
    """Elevation axis: the depth is marked 'derived from plotted elevation'."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [3.0, 4.0])
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding([qc], DepthReference.ELEVATION), _header(), REPORT
    )
    assert result.import_provenance["depth_source"] == "derived from plotted elevation"
    assert "PDF_DEPTH_FROM_ELEVATION" in _codes(result)


def test_a_depth_axis_sheet_keeps_its_plotted_depth() -> None:
    """Depth axis: the depth is the plotted depth, no elevation issue."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [3.0, 4.0])
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc]), _header(), REPORT)
    assert result.import_provenance["depth_source"] == "plotted depth"
    assert "PDF_DEPTH_FROM_ELEVATION" not in _codes(result)


def test_the_header_comes_from_the_sheet() -> None:
    """Name = sounding id; XY, Z, datum and date from the sheet; Z provenance 'pdf'."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [3.0, 4.0])
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc]), _header(), REPORT)
    h = result.header
    assert (h.test_id, h.project_id) == ("110", "CAMZ-001")
    assert (h.x, h.y, h.epsg) == (66980.21, 224746.0, 31370)
    assert (h.z, h.z_epsg) == (6.02, 5710)
    assert h.file_date == "2024-02-28"
    assert result.elevation_source is ElevationSource.PDF
    assert result.import_provenance["source"] == "pdf-digitised"
    assert result.import_provenance["report_file_name"] == "camz-001.pdf"
    assert result.import_provenance["pages"] == [231]


def test_a_sounding_without_a_position_cannot_be_placed() -> None:
    """No XY read and none typed: PDF_NO_XY at ERROR level."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [3.0, 4.0])
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding([qc]), _header(x=None, y=None, epsg=None), REPORT
    )
    assert _codes(result)["PDF_NO_XY"] is ValidationLevel.ERROR


@pytest.mark.parametrize(
    ("kinds", "cpt_type"),
    [
        ((PanelKind.QC, PanelKind.FS, PanelKind.U2), CPTType.CPTU),
        ((PanelKind.QC, PanelKind.FS), CPTType.CPTE),
        ((PanelKind.QC,), CPTType.UNKNOWN),
    ],
)
def test_the_cpt_type_follows_the_curves_present(
    kinds: tuple[PanelKind, ...], cpt_type: CPTType
) -> None:
    """u2 present -> CPTU; fs without u2 -> CPTE; qc alone is not claimed as a type."""
    curves = [_curve(k, [1.0, 2.0], [3.0, 0.1]) for k in kinds]
    result = DigitisedSoundingAdapter().to_parse_result(_sounding(curves), _header(), REPORT)
    assert result.cpt_type is cpt_type


def test_a_printed_friction_ratio_is_read_and_a_missing_one_computed() -> None:
    """Rf off the sheet is 'measured'; without an Rf panel it is computed from fs/qc."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [4.0, 5.0])
    fs = _curve(PanelKind.FS, [1.0, 2.0], [0.04, 0.1])
    rf = _curve(PanelKind.RF, [1.0, 2.0], [1.1, 2.1])
    read = DigitisedSoundingAdapter().to_parse_result(_sounding([qc, fs, rf]), _header(), REPORT)
    assert read.rf_source is DerivedValueSource.MEASURED
    assert read.data["rf_pct"].to_list() == [1.1, 2.1]
    computed = DigitisedSoundingAdapter().to_parse_result(_sounding([qc, fs]), _header(), REPORT)
    assert computed.rf_source is DerivedValueSource.COMPUTED
    assert computed.data["rf_pct"].to_list() == pytest.approx([1.0, 2.0])


def test_a_sounding_read_without_ocr_says_so() -> None:
    """A raster sounding read without OCR carries PDF_OCR_UNAVAILABLE."""
    qc = _curve(PanelKind.QC, [1.0, 1.1], [2.0, 3.0], source=GraphKind.RASTER)
    no_ocr = PdfReportIdentity(file_name="scan.pdf", file_sha="a" * 64, ocr_available=False)
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc]), _header(), no_ocr)
    assert "PDF_OCR_UNAVAILABLE" in _codes(result)


def test_a_sounding_without_a_qc_curve_is_refused() -> None:
    """qc is the one curve every stored CPT needs."""
    fs = _curve(PanelKind.FS, [1.0, 2.0], [0.1, 0.2])
    with pytest.raises(ValueError, match="qc"):
        DigitisedSoundingAdapter().to_parse_result(_sounding([fs]), _header(), REPORT)


def test_a_vertex_plotted_above_the_ground_is_not_a_scan() -> None:
    """CAMZ-001 110 starts its curves a few mm above ground level: not stored as a scan."""
    qc = _curve(PanelKind.QC, [-0.0047, 0.0215, 0.0411], [-0.01, 0.016, 0.016])
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc]), _header(), REPORT)
    assert result.data["depth_m"].to_list() == [0.0215, 0.0411]
    assert result.import_provenance["points_above_ground_dropped"] == 1


def _issue(result: object, code: str) -> object:
    return next(i for i in result.issues if i.code == code)  # type: ignore[attr-defined]


def test_the_clipped_issue_carries_its_numbers_so_the_app_says_it_in_its_own_language() -> None:
    """Owner 2026-10-04: translate from code + params. Clipped = curve, count, axis max."""
    qc = _curve(
        PanelKind.QC,
        [1.0, 1.02, 1.04, 1.06],
        [20.0, 31.998, 31.998, 25.0],
        [False, True, True, False],
    )
    result = DigitisedSoundingAdapter().to_parse_result(_sounding([qc]), _header(), REPORT)
    issue = _issue(result, "PDF_CLIPPED_POINTS")
    assert issue.params == {"curve": "qc", "count": 2, "axis_max": 31.998}  # type: ignore[attr-defined]


def test_the_elevation_issue_carries_the_printed_ground_level() -> None:
    """Elevation axis: the printed ground level travels as a number, not only in English."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [3.0, 4.0])
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding([qc], DepthReference.ELEVATION), _header(ground_level_m=6.05), REPORT
    )
    issue = _issue(result, "PDF_DEPTH_FROM_ELEVATION")
    assert issue.params == {"ground_level_m": 6.05}  # type: ignore[attr-defined]


def test_the_elevation_issue_without_a_printed_ground_level_carries_no_number() -> None:
    """No ground level read: no param, so the app keeps the English sentence."""
    qc = _curve(PanelKind.QC, [1.0, 2.0], [3.0, 4.0])
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding([qc], DepthReference.ELEVATION), _header(ground_level_m=None), REPORT
    )
    issue = _issue(result, "PDF_DEPTH_FROM_ELEVATION")
    assert issue.params == {}  # type: ignore[attr-defined]
