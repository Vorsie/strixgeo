"""A gap at a sheet join is never a drilled interval (owner ruling "a", 2026-10-07).

The owner's words: a gap in the drawn curve AT A SHEET JOIN (where a two-page
sounding's continuation sheet starts) is a plotting artefact and is NEVER a
drilled interval. Within a sheet the pen-lift rule of 2026-10-04 is unchanged:
a stroke change with a depth jump above ``VECTOR_DRILL_GAP_M`` is drilled.

The real case: on the CAMZ-001 2.3 report soundings 68 and 69 showed a
"drilled" note at 33.49-33.97 m and 33.52-33.69 m, exactly where sheet 1
(0 to ~33.5 m) hands over to sheet 2; the 2.4 print of the same soundings has
no such note. Sheet 2 of 68 starts at 32.65 m (the continuation repeats the
last ~0.84 m) and draws ONE stroke from 33.01 to 33.97 m: no pen was lifted on
either sheet, the "gap" is only the two drawings meeting.

What stays drilled (measured on both prints, 2026-10-07): a pen lift the
continuation sheet draws itself at the join (76b, 112, 84), and a stretch that
neither sheet draws because the upper curve stops before the join (80: sheet 1
ends 31.20 m, sheet 2 starts 32.97 m; 126). The 2.4 print shows those too.

The values across the seam stay as they are: no interpolation is added across
it, the rows simply continue.
"""

from __future__ import annotations

import numpy as np

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
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header import PdfImportHeader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity

REPORT = PdfReportIdentity(file_name="camz-001.pdf", file_sha="f" * 64, ocr_available=True)


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


def _sheet(page: int, *strokes: list[float]) -> DigitisedSounding:
    """Return one sheet (one page) of sounding 68 with a qc curve drawn as ``strokes``."""
    cal = PageCalibration(
        page_number=page,
        coordinate_space="pdf-pt",
        dpi=None,
        depth_reference=DepthReference.DEPTH_BELOW_GROUND,
        panels=(),
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


# Sounding 68 on the 2.3 print: sheet 1 drawn to 33.492 m; sheet 2 repeats from
# 32.652 m and draws one stroke whose vertices jump from 33.01 to 33.967 m.
SHEET_1 = _run(0.012, 33.492)
SHEET_2 = _run(32.65, 33.01) + _run(33.967, 40.0, step=0.017)


def _two_sheets(upper: list[list[float]], lower: list[list[float]]) -> DigitisedSounding:
    """Return the sounding merge_continuations makes of sheets 214 and 216."""
    (merged,) = merge_continuations([_sheet(214, *upper), _sheet(216, *lower)])
    assert merged.page_numbers == (214, 216)
    return merged


def test_a_gap_where_the_continuation_sheet_meets_the_first_is_not_drilled() -> None:
    """Sounding 68: the join gap 33.49-33.97 m is a plotting artefact, no drilled note."""
    assert _two_sheets([SHEET_1], [SHEET_2]).drilled_intervals() == []


def test_join_sheets_also_drops_the_seam_gap() -> None:
    """The listed-sounding join (import path) follows the same ruling."""
    joined = join_sheets([_sheet(216, SHEET_2), _sheet(214, SHEET_1)])
    assert joined.drilled_intervals() == []


def test_the_join_is_recorded_on_the_sounding() -> None:
    """The join: upper sheet's last point, continuation's first point; and the seam gap."""
    merged = _two_sheets([SHEET_1], [SHEET_2])
    assert merged.sheet_joins_m == ((33.492, 32.65),)
    assert merged.seam_gaps_m == ((33.492, 33.967),)


def test_the_same_gap_inside_one_sheet_is_still_drilled() -> None:
    """Guard: a pen lift inside one sheet stays a drilled interval."""
    one_sheet = _sheet(214, SHEET_1, _run(33.967, 40.0))
    assert one_sheet.sheet_joins_m == ()
    assert one_sheet.drilled_intervals() == [(33.492, 33.967)]


def test_a_pen_lift_the_continuation_draws_itself_at_the_join_stays_drilled() -> None:
    """76b: sheet 2 lifts its own pen at the depth sheet 1 ends: drilled, as on the 2.4 print."""
    lower = [_run(32.28, 32.96), _run(33.44, 40.0)]
    merged = _two_sheets([_run(0.02, 32.96)], lower)
    assert merged.drilled_intervals() == [(32.96, 33.44)]


def test_a_stretch_neither_sheet_draws_stays_drilled() -> None:
    """80: sheet 1 ends 31.2 m, sheet 2 starts 32.98 m: drilled, as on the 2.4 print."""
    merged = _two_sheets([_run(0.02, 31.2)], [_run(32.98, 40.0)])
    assert merged.drilled_intervals() == [(31.2, 32.98)]


def test_a_continuation_starting_0_3_m_below_the_last_vertex_stays_drilled() -> None:
    """No overlap: no sheet draws 33.5-33.8 m, so nothing says it was pushed."""
    merged = _two_sheets([_run(0.02, 33.5)], [_run(33.8, 40.0)])
    assert merged.seam_gaps_m == ()
    assert merged.drilled_intervals() == [(33.5, 33.8)]


def test_a_drilled_gap_deeper_on_the_continuation_sheet_is_still_drilled() -> None:
    """Only the seam gap goes: a pen lift well inside sheet 2 stays drilled."""
    lower = [_run(32.65, 33.01) + _run(33.967, 36.007, step=0.017), _run(36.6, 40.0)]
    assert _two_sheets([SHEET_1], lower).drilled_intervals() == [(36.007, 36.6)]


def test_no_value_is_interpolated_across_the_seam() -> None:
    """The rows across the seam continue as before: no value is invented between the sheets."""
    frame = _two_sheets([SHEET_1], [SHEET_2]).to_frame()
    inside = frame.filter((frame["depth_m"] > 33.5) & (frame["depth_m"] < 33.96))
    assert inside.height > 0
    assert inside["qc_mpa"].is_nan().all()


def test_the_join_is_carried_into_the_import_provenance() -> None:
    """Provenance ``sheet_joins_m`` lists the join; no PDF_DRILLED_INTERVALS issue."""
    merged = _two_sheets([SHEET_1], [SHEET_2])
    result = DigitisedSoundingAdapter().to_parse_result(merged, _header(), REPORT)
    assert result.import_provenance["sheet_joins_m"] == [[33.492, 32.65]]
    assert result.import_provenance["drilled_intervals_m"] == []
    assert "PDF_DRILLED_INTERVALS" not in {i.code for i in result.issues}


def test_a_one_sheet_sounding_has_no_join_in_the_provenance() -> None:
    """One sheet: ``sheet_joins_m`` is an empty list."""
    result = DigitisedSoundingAdapter().to_parse_result(_sheet(214, SHEET_1), _header(), REPORT)
    assert result.import_provenance["sheet_joins_m"] == []
