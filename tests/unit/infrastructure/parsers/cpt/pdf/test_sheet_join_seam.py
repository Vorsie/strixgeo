"""The seam between two sheets of one sounding is read from the printed depth axes.

Owner direction (2026-10-07): "you can just look at start-depth on page 1 and
end depth on page 2 based on the axes". Sheet 1's depth axis ends at D1 (its
calibrated axis maximum), sheet 2's axis starts at D2 (its minimum).

* D2 <= D1: the sheets overlap on [D2, D1]. A gap in the drawn curve inside
  that overlap, or across the sheet boundary, is a plotting artefact of the
  join, never drilled (CAMZ-001 2.3, soundings 68 and 69 at ~33.5 m: sheet 1
  is drawn to its axis end, sheet 2 draws on from there).
* D2 > D1: the axes leave [D1, D2] uncovered. No sheet could draw it, so it is
  unknown, not drilled: ``sheet_axis_gaps_m`` and a ``SHEET_AXIS_GAP`` note.
* A pen lift INSIDE one sheet's own axis range stays overboring (drilled),
  exactly as before: sounding 80, the curve stops at 31.2 m while the sheet's
  axis runs on to ~33 m.

``sheet_joins_m`` records the axis pair (D1, D2) of each join. The values
across the seam stay as they are: no interpolation is added across it.
"""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import (
    join_sheets,
    merge_continuations,
)
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding_adapter import (
    DigitisedSoundingAdapter,
)
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header import PdfImportHeader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity

REPORT = PdfReportIdentity(file_name="camz-001.pdf", file_sha="f" * 64, ocr_available=True)

# The printed depth axes of a two-sheet sounding of the CAMZ-001 reports:
# sheet 1 runs to ~33.5 m, sheet 2 repeats the last ~0.85 m.
AXIS_1 = (-0.35, 33.5)
AXIS_2 = (32.65, 66.5)


def _run(top: float, base: float, step: float = 0.02) -> list[float]:
    """Return the scans from ``top`` to ``base`` inclusive, ``step`` apart."""
    n = round((base - top) / step)
    return [round(top + i * step, 4) for i in range(n + 1)]


def _curve(kind: PanelKind, *strokes: list[float]) -> DigitisedCurve:
    """Return a vector curve drawn as ``strokes`` (one per pen-down), value growing with depth."""
    d = np.array([x for stroke in strokes for x in stroke], dtype=float)
    chain = np.array([i for i, stroke in enumerate(strokes) for _ in stroke], dtype=int)
    return DigitisedCurve(
        kind=kind,
        depth_m=d,
        value=1.0 + d,
        clipped=np.zeros(len(d), dtype=bool),
        source=GraphKind.VECTOR,
        chain=chain,
    )


def _qc_panel(axis: tuple[float, float]) -> PanelCalibration:
    """Return a qc panel whose printed depth axis runs from ``axis[0]`` to ``axis[1]``."""
    frame = FrameRect(x0=0.0, y0=100.0, x1=200.0, y1=800.0)
    return PanelCalibration(
        kind=PanelKind.QC,
        frame=frame,
        value_scale=AxisScale(0.0, 0.0, 200.0, 40.0),
        depth_scale=AxisScale(frame.y0, axis[0], frame.y1, axis[1]),
        unit="MPa",
    )


def _sheet(page: int, axis: tuple[float, float] | None, *strokes: list[float]) -> DigitisedSounding:
    """Return one sheet of sounding 68: its printed depth axis and the qc ``strokes``."""
    cal = PageCalibration(
        page_number=page,
        coordinate_space="pdf-pt",
        dpi=None,
        depth_reference=DepthReference.DEPTH_BELOW_GROUND,
        panels=(_qc_panel(axis),) if axis is not None else (),
        ground_level_m=6.02,
        sounding_id="68",
    )
    return DigitisedSounding(
        sounding_id="68",
        page_numbers=(page,),
        calibrations=(cal,),
        curves={PanelKind.QC: _curve(PanelKind.QC, *strokes)},
    )


def _header() -> PdfImportHeader:
    return PdfImportHeader(
        test_id="68",
        project_id="23.15-002",
        x=66980.21,
        y=224746.0,
        epsg=31370,
        ground_level_m=6.02,
        z_epsg=5710,
    )


def _two_sheets(
    upper: list[list[float]],
    lower: list[list[float]],
    axis_1: tuple[float, float] | None = AXIS_1,
    axis_2: tuple[float, float] | None = AXIS_2,
) -> DigitisedSounding:
    """Return the sounding merge_continuations makes of sheets 214 and 216."""
    (merged,) = merge_continuations([_sheet(214, axis_1, *upper), _sheet(216, axis_2, *lower)])
    assert merged.page_numbers == (214, 216)
    return merged


# Sounding 68 on the 2.3 print: sheet 1 drawn to 33.492 m (its axis ends at
# 33.5 m); sheet 2 repeats from 32.65 m and draws one stroke whose vertices
# jump from 33.01 to 33.967 m.
SHEET_1 = _run(0.012, 33.492)
SHEET_2 = _run(32.65, 33.01) + _run(33.967, 40.0, step=0.017)

# The axis-gap case: sheet 1's axis ends at 33.5 m, sheet 2's starts at 34.0 m.
GAP_AXIS_1 = (-0.35, 33.5)
GAP_AXIS_2 = (34.0, 67.0)


def _axis_gap_sounding() -> DigitisedSounding:
    """Return two sheets, each drawn over its whole axis, whose axes leave 33.5-34.0 m."""
    return _two_sheets([_run(0.02, 33.5)], [_run(34.0, 40.0)], axis_1=GAP_AXIS_1, axis_2=GAP_AXIS_2)


# --- overlap: D2 <= D1 --------------------------------------------------------


def test_a_gap_across_the_sheet_boundary_inside_the_overlap_is_not_drilled() -> None:
    """Sounding 68: the gap 33.49-33.97 m across sheet 1's axis end is a join artefact."""
    assert _two_sheets([SHEET_1], [SHEET_2]).drilled_intervals() == []


def test_join_sheets_also_reads_the_seam_from_the_axes() -> None:
    """The listed-sounding join (import path) follows the same rule."""
    joined = join_sheets([_sheet(216, AXIS_2, SHEET_2), _sheet(214, AXIS_1, SHEET_1)])
    assert joined.drilled_intervals() == []


def test_the_join_is_recorded_as_the_printed_axis_pair() -> None:
    """``sheet_joins_m`` = (sheet 1's axis end D1, sheet 2's axis start D2)."""
    merged = _two_sheets([SHEET_1], [SHEET_2])
    assert merged.sheet_joins_m == ((33.5, 32.65),)
    assert merged.sheet_axis_gaps_m == ()


# --- exact abutment: D2 == D1 -------------------------------------------------


def test_sheets_that_abut_exactly_leave_no_drilled_gap_and_no_axis_gap() -> None:
    """D2 == D1 = 33.5 m: the 7 cm between the two drawings is the join, not drilled."""
    merged = _two_sheets(
        [_run(0.02, 33.47)], [_run(33.54, 40.0)], axis_1=(-0.35, 33.5), axis_2=(33.5, 67.0)
    )
    assert merged.sheet_joins_m == ((33.5, 33.5),)
    assert merged.sheet_axis_gaps_m == ()
    assert merged.drilled_intervals() == []


# --- axis gap: D2 > D1 --------------------------------------------------------


def test_a_stretch_no_axis_covers_is_an_axis_gap_not_drilled() -> None:
    """D1 = 33.5, D2 = 34.0: no sheet could draw 33.5-34.0 m; unknown, never drilled."""
    merged = _axis_gap_sounding()
    assert merged.sheet_joins_m == ((33.5, 34.0),)
    assert merged.sheet_axis_gaps_m == ((33.5, 34.0),)
    assert merged.drilled_intervals() == []


def test_the_axis_gap_names_the_sheets_it_lies_between() -> None:
    """The note says sheet 1 ends at D1 and sheet 2 starts at D2."""
    assert _axis_gap_sounding().sheet_axis_gaps() == [(1, 33.5, 34.0)]


def test_the_axis_gap_is_carried_into_the_import_provenance() -> None:
    """Provenance ``sheet_axis_gaps_m`` lists it; no PDF_DRILLED_INTERVALS issue."""
    result = DigitisedSoundingAdapter().to_parse_result(_axis_gap_sounding(), _header(), REPORT)
    assert result.import_provenance["sheet_axis_gaps_m"] == [[33.5, 34.0]]
    assert result.import_provenance["drilled_intervals_m"] == []
    assert "PDF_DRILLED_INTERVALS" not in {i.code for i in result.issues}


# --- in-sheet lift guard: stays drilled ---------------------------------------


def test_a_curve_that_stops_inside_its_own_axis_stays_drilled() -> None:
    """80: sheet 1 stops at 31.2 m while its axis runs on to ~33 m: overboring."""
    merged = _two_sheets(
        [_run(0.02, 31.2)], [_run(32.98, 40.0)], axis_1=(-0.83, 33.02), axis_2=(32.17, 66.02)
    )
    assert merged.drilled_intervals() == [(31.2, 32.98)]


def test_an_early_stop_on_sheet_1_stays_drilled_even_when_sheet_2_draws_through() -> None:
    """Sheet 1's axis runs to 33.5 m but its curve stops at 33.2 m: in-sheet, drilled."""
    lower = [_run(32.65, 33.01) + _run(33.967, 40.0, step=0.017)]
    merged = _two_sheets([_run(0.02, 33.2)], lower)
    assert merged.drilled_intervals() == [(33.2, 33.967)]


def test_a_pen_lift_the_continuation_draws_inside_its_own_axis_stays_drilled() -> None:
    """76b: sheet 2 lifts its own pen 32.96-33.44 m, inside its own axis: drilled."""
    lower = [_run(32.28, 32.96), _run(33.44, 40.0)]
    merged = _two_sheets([_run(0.02, 32.96)], lower, axis_1=(-0.72, 33.13), axis_2=(32.28, 66.13))
    assert merged.drilled_intervals() == [(32.96, 33.44)]


def test_the_same_gap_inside_one_sheet_is_still_drilled() -> None:
    """Guard: a pen lift inside one sheet stays a drilled interval."""
    one_sheet = _sheet(214, (-0.35, 66.5), SHEET_1, _run(33.967, 40.0))
    assert one_sheet.sheet_joins_m == ()
    assert one_sheet.drilled_intervals() == [(33.492, 33.967)]


def test_a_drilled_gap_deeper_on_the_continuation_sheet_is_still_drilled() -> None:
    """Only the join gap goes: a pen lift well inside sheet 2 stays drilled."""
    lower = [_run(32.65, 33.01) + _run(33.967, 36.007, step=0.017), _run(36.6, 40.0)]
    assert _two_sheets([SHEET_1], lower).drilled_intervals() == [(36.007, 36.6)]


def test_a_join_without_a_read_axis_keeps_its_gap_drilled() -> None:
    """No printed axis read: nothing says the gap is the join, so it stays drilled."""
    merged = _two_sheets([SHEET_1], [SHEET_2], axis_1=None, axis_2=None)
    assert merged.sheet_joins_m == ()
    assert merged.drilled_intervals() == [(33.492, 33.967)]


# --- values and provenance ----------------------------------------------------


def test_no_value_is_interpolated_across_the_seam() -> None:
    """The rows across the seam continue as before: no value is invented between the sheets."""
    frame = _two_sheets([SHEET_1], [SHEET_2]).to_frame()
    inside = frame.filter((frame["depth_m"] > 33.5) & (frame["depth_m"] < 33.96))
    assert inside.height > 0
    assert inside["qc_mpa"].is_nan().all()


def test_the_join_is_carried_into_the_import_provenance() -> None:
    """Provenance ``sheet_joins_m`` lists the axis pair; no PDF_DRILLED_INTERVALS issue."""
    merged = _two_sheets([SHEET_1], [SHEET_2])
    result = DigitisedSoundingAdapter().to_parse_result(merged, _header(), REPORT)
    assert result.import_provenance["sheet_joins_m"] == [[33.5, 32.65]]
    assert result.import_provenance["sheet_axis_gaps_m"] == []
    assert result.import_provenance["drilled_intervals_m"] == []
    assert "PDF_DRILLED_INTERVALS" not in {i.code for i in result.issues}


def test_a_one_sheet_sounding_has_no_join_in_the_provenance() -> None:
    """One sheet: ``sheet_joins_m`` and ``sheet_axis_gaps_m`` are empty lists."""
    result = DigitisedSoundingAdapter().to_parse_result(
        _sheet(214, AXIS_1, SHEET_1), _header(), REPORT
    )
    assert result.import_provenance["sheet_joins_m"] == []
    assert result.import_provenance["sheet_axis_gaps_m"] == []
