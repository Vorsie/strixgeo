"""Guards for what the two real proefverslagen taught (written after each fix).

* "labels offset": the Van der Straaten CPTU sheets print the qc tick labels
  5.7 pt right of their grid lines; the scale must follow the grid lines, or
  every qc reads 0.62 MPa high.
* "legend arrow": a short stroke in the curve's colour (the u2 legend arrow)
  is not part of the curve.
* "partial ticks": when only some tick labels were read (OCR glues "121416"),
  the frame still spans the whole grid, so no curve point is cut off.
* "garbled text layer": a subset font without a Unicode map extracts as
  symbol soup; it must be recognised so the title block is OCR'd instead.
* "continuation": a continuation sheet whose id OCR could not read joins the
  sheet before it when the ground level matches and the depth runs on.
"""

from __future__ import annotations

import numpy as np
import pymupdf
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import merge_continuations
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.vector_axis_calibrator import (
    VectorAxisCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.vector_curve_extractor import (
    VectorCurveExtractor,
)
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader import VectorPageReader
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import text_layer_quality

from . import _synthetic_cpt_pdf as synth


def _page_with_shifted_qc_labels(shift_pt: float) -> pymupdf.Page:
    """A synthetic page whose qc tick labels sit ``shift_pt`` right of the lines."""
    return synth.synthetic_cpt_pdf(synth.SyntheticPageSpec(qc_label_shift=shift_pt))[0]


def test_labels_offset_from_their_grid_lines_still_calibrate_on_the_lines() -> None:
    """Labels offset from their grid lines still calibrate on the lines."""
    page = _page_with_shifted_qc_labels(5.7)
    profile = LayoutProfileRegistry.default().match(page.get_text())
    cal = VectorAxisCalibrator(profile).calibrate(page, page_number=1)
    qc = cal.panel(PanelKind.QC).value_scale
    assert qc is not None
    assert qc.coord_of(0.0) == pytest.approx(synth.x_qc(0.0), abs=0.1)
    assert qc.coord_of(20.0) == pytest.approx(synth.x_qc(20.0), abs=0.1)


def test_a_legend_arrow_in_the_curve_colour_is_not_part_of_the_curve() -> None:
    """A legend arrow in the curve colour is not part of the curve."""
    doc = synth.synthetic_cpt_pdf()
    page = doc[0]
    # A blue arrow near the bottom of the qc frame, below the last scan.
    shape = page.new_shape()
    shape.draw_polyline([(100, 780), (160, 780), (155, 777)])
    shape.finish(color=synth.QC_COLOUR, width=0.84, closePath=False)
    shape.commit()
    profile = LayoutProfileRegistry.default().match(page.get_text())
    cal = VectorAxisCalibrator(profile).calibrate(page, page_number=1)
    qc = VectorCurveExtractor().extract(page, cal).curves[PanelKind.QC]
    assert qc.depth_m[-1] == pytest.approx(synth.LAST_DEPTH_M, abs=0.01)


def test_a_frame_found_from_a_few_ticks_still_spans_the_whole_grid() -> None:
    """A frame found from a few ticks still spans the whole grid."""
    doc = synth.synthetic_cpt_pdf()
    page = doc[0]
    content = VectorPageReader().read(page)
    # Keep only the 5 and 10 MPa labels of the qc axis (plus a third), as if
    # OCR had lost the others.
    kept = [
        w
        for w in content.words
        if not (w.y0 > 70 and w.y1 < 84 and w.x1 < 310 and w.text in {"0", "20"})
    ]
    profile = LayoutProfileRegistry.default().match(page.get_text())
    cal = VectorAxisCalibrator(profile).calibrate(page, 1, content, tick_words=kept)
    frame = cal.panel(PanelKind.QC).frame
    assert frame.x0 == pytest.approx(synth.x_qc(0.0), abs=0.5)
    assert frame.x1 == pytest.approx(synth.x_qc(synth.QC_MAX), abs=0.5)


def test_symbol_soup_is_recognised_as_an_unreadable_text_layer() -> None:
    """Symbol soup is recognised as an unreadable text layer."""
    soup = [PageWord(0, 0, 1, 1, t) for t in [";<", "=>7<?", "&>;9=@", "<+,,=>", "F;@*"] * 6]
    prose = [
        PageWord(0, 0, 1, 1, t)
        for t in ["Conusweerstand", "Plaatselijke", "wrijving", "ZEEBRUGGE", "LOCATIE"] * 6
    ]
    assert text_layer_quality(soup) < 0.5
    assert text_layer_quality(prose) > 0.8


def _sheet(sid: str | None, page: int, ground: float, d0: float, d1: float) -> DigitisedSounding:
    depth = np.linspace(d0, d1, 50)
    curve = DigitisedCurve(
        PanelKind.QC, depth, np.ones(50), np.zeros(50, dtype=bool), GraphKind.VECTOR
    )
    cal = PageCalibration(
        page_number=page,
        coordinate_space="pdf-pt",
        dpi=None,
        depth_reference=DepthReference.ELEVATION,
        panels=(),
        ground_level_m=ground,
        sounding_id=sid,
    )
    return DigitisedSounding(sid, (page,), (cal,), {PanelKind.QC: curve})


def test_a_continuation_sheet_without_a_readable_id_joins_the_sheet_before() -> None:
    """A continuation sheet without a readable id joins the sheet before."""
    merged = merge_continuations(
        [
            _sheet("111", 179, 6.21, 0.0, 32.9),
            _sheet(None, 180, 6.21, 32.2, 61.3),  # same ground level, runs on
            _sheet(None, 181, 6.50, 0.3, 33.3),  # another ground level: new sounding
            _sheet("149", 182, 6.50, 32.5, 66.3),  # its continuation names it
        ]
    )
    assert [(s.sounding_id, s.page_numbers) for s in merged] == [
        ("111", (179, 180)),
        ("149", (181, 182)),
    ]
    assert merged[0].curves[PanelKind.QC].depth_m[-1] == pytest.approx(61.3)


def test_frame_rect_round_trip() -> None:
    """Frame rect round trip."""
    frame = FrameRect(1.0, 2.0, 3.0, 4.0)
    assert FrameRect.from_dict(frame.to_dict()) == frame


def test_the_plotters_clip_edge_crossing_is_not_taken_for_a_scan() -> None:
    """Where the curve leaves the panel the plotter adds a vertex that is no scan.

    CAMZ-001 sounding 66 at 30.96 m, 77b at 32.44 m: between a scan at 28 MPa
    and one beyond 32 MPa the sheet draws a vertex on the 32 MPa edge crossing
    (30.57 MPa at 30.964 m); the GEF has no such row. Every vertex kept must be
    a drawn scan.
    """
    doc = synth.synthetic_cpt_pdf(synth.SyntheticPageSpec(clip_crossings=True))
    page = doc[0]
    profile = LayoutProfileRegistry.default().match(page.get_text())
    cal = VectorAxisCalibrator(profile).calibrate(page, page_number=1)
    qc = VectorCurveExtractor().extract(page, cal).curves[PanelKind.QC]
    truth = np.asarray(synth.truth_depths())
    nearest = np.min(np.abs(qc.depth_m[:, None] - truth[None, :]), axis=1)
    assert len(qc.depth_m) == len(truth)
    assert nearest.max() < 0.002


def test_a_continuation_sheet_finds_its_sounding_across_a_sheet_in_between() -> None:
    """A continuation joins its own sounding even when another sheet sits between.

    CAMZ-001 prints sounding 68 on p. 214, then a repeat of sounding 66's first
    sheet on p. 215, then 68's continuation on p. 216. The continuation belongs
    to 68; the repeated sheet of 66 is a duplicate, not a second sounding 66.
    """
    merged = merge_continuations(
        [
            _sheet("66", 210, 3.70, 0.0, 33.5),
            _sheet("66", 211, 3.70, 33.2, 33.9),
            _sheet("68", 214, 3.65, 0.0, 33.5),
            _sheet("66", 215, 3.70, 0.0, 33.5),  # the same first sheet again
            _sheet("68", 216, 3.65, 32.6, 34.4),
        ]
    )
    assert [(s.sounding_id, s.page_numbers) for s in merged] == [
        ("66", (210, 211)),
        ("68", (214, 216)),
    ]
