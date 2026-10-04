"""A drilled interval stays a gap (owner ruling "a", 2026-10-04).

The owner's words: a gap of 0.2 to 1.3 m in a vector curve is a drilled
stretch (rods added, "voorboring" between two pushes). Interpolating across it
invents qc / fs / Rf / u2 values. "Keep the depth rows across a drilled
interval but with EMPTY values, so the chart shows a break and the litho
segmenter sees no data there; store the intervals in the import provenance and
show them as a note on the triage row."

Plus: "when the first vertex is deeper than the pre-drill tolerance below 0,
record pre_drill_m = that depth" (the GEF twin is ``#MEASUREMENTVAR 13``), and
never invent rows above it.

How a drilled stretch is recognised (measured on the real sheets, 2026-10-04):
the plotter LIFTS ITS PEN over it. Each push is one connected stroke; a
drilled stretch is a stroke change with a depth jump. A vertex spacing alone
cannot tell: the thinned CAMZ-005 polylines join vertices up to 0.34 m apart
inside one stroke where the GEF has data, while CAMZ-001 has drilled
stretches from 0.10 m. Such a thinned step is one push and is interpolated
as before.
"""

from __future__ import annotations

import numpy as np

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
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import merge_intervals
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

REPORT = PdfReportIdentity(file_name="camz-001.pdf", file_sha="f" * 64, ocr_available=True)


def _run(top: float, base: float, step: float = 0.02) -> list[float]:
    """Return the scans from ``top`` to ``base`` inclusive, ``step`` apart."""
    n = round((base - top) / step)
    return [round(top + i * step, 4) for i in range(n + 1)]


def _curve(
    kind: PanelKind, *strokes: list[float], source: GraphKind = GraphKind.VECTOR
) -> DigitisedCurve:
    """Return a curve drawn as ``strokes`` (one per push), value growing with depth."""
    d = np.array([x for stroke in strokes for x in stroke], dtype=float)
    chain = np.array([i for i, stroke in enumerate(strokes) for _ in stroke], dtype=int)
    return DigitisedCurve(
        kind=kind,
        depth_m=d,
        value=1.0 + d,
        clipped=np.zeros(len(d), dtype=bool),
        source=source,
        chain=chain if source is GraphKind.VECTOR else None,
    )


def _sounding(*curves: DigitisedCurve) -> DigitisedSounding:
    cal = PageCalibration(
        page_number=231,
        coordinate_space="pdf-pt",
        dpi=None,
        depth_reference=DepthReference.DEPTH_BELOW_GROUND,
        panels=(),
        ground_level_m=6.02,
        sounding_id="110",
    )
    return DigitisedSounding(
        sounding_id="110",
        page_numbers=(231,),
        calibrations=(cal,),
        curves={c.kind: c for c in curves},
    )


def _header() -> PdfImportHeader:
    return PdfImportHeader(
        test_id="110",
        project_id="23.15-002",
        x=66980.21,
        y=224746.0,
        epsg=31370,
        ground_level_m=6.02,
        z_epsg=5710,
    )


# Pushed from 0.02 to 1.0 m, pen lifted (drilled) from 1.0 to 1.6 m, pushed on to 2.0 m.
PUSH_1 = _run(0.02, 1.0)
PUSH_2 = _run(1.6, 2.0)


# ---------------------------------------------------------------------------
# to_frame: a drilled stretch becomes empty rows, one push is interpolated
# ---------------------------------------------------------------------------


def test_a_drilled_gap_of_0_6_m_keeps_its_rows_with_empty_values() -> None:
    """Pen lifted over 0.6 m = drilled: the rows stay, their values are empty."""
    frame = _sounding(_curve(PanelKind.QC, PUSH_1, PUSH_2)).to_frame()
    inside = frame.filter((frame["depth_m"] > 1.0) & (frame["depth_m"] < 1.6))
    assert inside.height == 29  # 1.02 .. 1.58: the depth rows are kept
    assert inside["qc_mpa"].is_nan().all()  # ... with no invented value


def test_a_vertex_spacing_of_0_04_m_is_one_curve_and_is_interpolated() -> None:
    """0.04 m between vertices of one stroke is the thinned polyline of one push."""
    frame = _sounding(_curve(PanelKind.QC, _run(0.04, 2.0, step=0.04))).to_frame()
    assert not frame["qc_mpa"].is_nan().any()
    row = frame.filter(frame["depth_m"] == 0.06)
    assert abs(row["qc_mpa"][0] - 1.06) < 1e-9


def test_a_thinned_step_of_0_3_m_inside_one_stroke_is_not_drilled() -> None:
    """CAMZ-005: one stroke joins vertices 0.3 m apart where the GEF has data."""
    sounding = _sounding(_curve(PanelKind.QC, _run(0.02, 1.0) + _run(1.3, 2.0)))
    assert sounding.drilled_intervals() == []
    frame = sounding.to_frame()
    assert not frame["qc_mpa"].is_nan().any()


def test_a_pen_lift_without_a_missing_scan_is_not_drilled() -> None:
    """A new stroke one scan deeper (0.02 m): no measurement is missing."""
    sounding = _sounding(_curve(PanelKind.QC, _run(0.02, 1.0), _run(1.02, 2.0)))
    assert sounding.drilled_intervals() == []


# ---------------------------------------------------------------------------
# drilled_intervals: per sounding, read from the qc curve, merged
# ---------------------------------------------------------------------------


def test_the_drilled_intervals_of_one_curve() -> None:
    """One pen lift over 0.6 m: one interval, last vertex above to first below."""
    assert _sounding(_curve(PanelKind.QC, PUSH_1, PUSH_2)).drilled_intervals() == [(1.0, 1.6)]


def test_a_gap_in_fs_alone_is_not_a_drilled_interval() -> None:
    """Only the qc curve says "drilled".

    The fs curve also lifts its pen where it leaves its panel (CAMZ-001
    sounding 25 at 40.3 m) where the GEF holds data.
    """
    fs = _curve(PanelKind.FS, _run(0.02, 1.0), _run(1.6, 3.0), _run(3.4, 4.0))
    sounding = _sounding(_curve(PanelKind.QC, PUSH_1, PUSH_2), fs)
    assert sounding.drilled_intervals() == [(1.0, 1.6)]


def test_overlapping_intervals_merge_into_one() -> None:
    """The interval helper unites overlapping or touching stretches, top first."""
    assert merge_intervals([(1.5, 1.9), (1.0, 1.6), (3.0, 3.4), (3.4, 3.5)]) == [
        (1.0, 1.9),
        (3.0, 3.5),
    ]


def test_a_raster_trace_reports_no_drilled_interval() -> None:
    """A raster trace has no strokes: a gap in it is never called drilled."""
    qc = _curve(PanelKind.QC, PUSH_1, PUSH_2, source=GraphKind.RASTER)
    assert _sounding(qc).drilled_intervals() == []


def test_separate_gaps_stay_separate_and_in_depth_order() -> None:
    """Two drilled stretches far apart are two intervals, top first."""
    qc = _curve(PanelKind.QC, _run(0.02, 1.0), _run(1.6, 3.0), _run(3.4, 4.0))
    assert _sounding(qc).drilled_intervals() == [(1.0, 1.6), (3.0, 3.4)]


def test_a_continuous_sounding_has_no_drilled_interval() -> None:
    """One stroke per curve, scans 0.02 or 0.04 m apart: nothing was drilled."""
    sounding = _sounding(
        _curve(PanelKind.QC, _run(0.02, 2.0)), _curve(PanelKind.FS, _run(0.04, 2.0, step=0.04))
    )
    assert sounding.drilled_intervals() == []


# ---------------------------------------------------------------------------
# The stored series never carries an interpolated value across a drilled gap
# ---------------------------------------------------------------------------


def test_fs_is_not_interpolated_across_its_own_pen_lift() -> None:
    """qc read on, fs lifted over 1.0-1.6 m: the stored fs inside that stretch is empty."""
    qc = _curve(PanelKind.QC, _run(0.02, 2.0))
    fs = _curve(PanelKind.FS, PUSH_1, PUSH_2)
    result = DigitisedSoundingAdapter().to_parse_result(_sounding(qc, fs), _header(), REPORT)
    inside = result.data.filter((result.data["depth_m"] > 1.0) & (result.data["depth_m"] < 1.6))
    assert inside.height == 29
    assert inside["fs_mpa"].null_count() == 29


def test_the_stored_qc_series_has_no_row_inside_the_drilled_interval() -> None:
    """The stored series holds measured scans only: no qc row is invented in the gap."""
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding(_curve(PanelKind.QC, PUSH_1, PUSH_2)), _header(), REPORT
    )
    depths = result.data["depth_m"].to_list()
    assert not [d for d in depths if 1.0 < d < 1.6]
    assert result.data["qc_mpa"].null_count() == 0


# ---------------------------------------------------------------------------
# The adapter says so: one INFO issue + the provenance
# ---------------------------------------------------------------------------


def test_the_drilled_intervals_are_one_info_issue_and_in_the_provenance() -> None:
    """One PDF_DRILLED_INTERVALS INFO listing them all; provenance drilled_intervals_m."""
    qc = _curve(PanelKind.QC, _run(0.02, 1.0), _run(1.6, 3.0), _run(3.4, 4.0))
    result = DigitisedSoundingAdapter().to_parse_result(_sounding(qc), _header(), REPORT)
    issues = [i for i in result.issues if i.code == "PDF_DRILLED_INTERVALS"]
    assert len(issues) == 1
    assert issues[0].level is ValidationLevel.INFO
    assert issues[0].params == {"intervals": [[1.0, 1.6], [3.0, 3.4]]}
    assert result.import_provenance["drilled_intervals_m"] == [[1.0, 1.6], [3.0, 3.4]]


def test_a_continuous_sounding_carries_no_drilled_issue() -> None:
    """No drilled stretch: no issue, an empty list in the provenance."""
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding(_curve(PanelKind.QC, _run(0.02, 2.0))), _header(), REPORT
    )
    assert "PDF_DRILLED_INTERVALS" not in {i.code for i in result.issues}
    assert result.import_provenance["drilled_intervals_m"] == []


# ---------------------------------------------------------------------------
# The first pre-drill
# ---------------------------------------------------------------------------


def test_a_first_vertex_below_the_surface_is_the_pre_drill() -> None:
    """The curve starts at 1.2 m: provenance pre_drill_m = 1.2, no row above."""
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding(_curve(PanelKind.QC, _run(1.2, 2.0))), _header(), REPORT
    )
    assert result.import_provenance["pre_drill_m"] == 1.2
    assert min(result.data["depth_m"].to_list()) == 1.2


def test_a_curve_starting_at_the_surface_has_no_pre_drill() -> None:
    """The first scan at 0.02 m is within the tolerance: no pre-drill."""
    result = DigitisedSoundingAdapter().to_parse_result(
        _sounding(_curve(PanelKind.QC, _run(0.02, 2.0))), _header(), REPORT
    )
    assert result.import_provenance["pre_drill_m"] == 0.0
