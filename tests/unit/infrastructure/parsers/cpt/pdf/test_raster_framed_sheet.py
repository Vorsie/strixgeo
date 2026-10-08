"""Scanned one-frame sheets: "it should work on scanned pdf's, which are all pictures".

Owner ruling 2026-10-08: the digitiser must also read a report whose graph
sheets are pictures without a grid: ONE frame, a depth axis with tick marks
on the left, the qc axis above (red), the Rf axis top right running right
to left (blue), the fs axis below (black). A frame plus regular tick marks
along its depth axis counts as a graph panel, so the sheet is a raster CPT
graph; the axes are calibrated from the OCR'd tick labels, each axis named by
its label and drawn in its curve's colour. When a report also prints the
values as a table, the table wins; the picture is the fallback and the check.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.frame_rect import FrameRect
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_constants import GENERIC_PROFILE
from groundmodel.infrastructure.parsers.cpt.pdf.ocr_reader import OcrReader
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import RASTER_DPI
from groundmodel.infrastructure.parsers.cpt.pdf.raster_frame_calibrator import (
    RasterFrameCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_frame_detector import (
    RasterFrameDetector,
    framed_or_grid_panels,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid import RasterGrid
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid_detector import RasterGridDetector
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import render_page
from groundmodel.infrastructure.parsers.cpt.pdf.raster_panel import RasterPanel

from . import _synthetic_framed_sheet as synth

DPI = 200
PX = DPI / 72.0


@pytest.fixture(scope="module")
def original():
    """The vector original of the sheet (its words feed the stand-in OCR)."""
    return synth.framed_sheet(grid=False)


@pytest.fixture(scope="module")
def image(original) -> np.ndarray:
    """The sheet rendered at 200 dpi: the scan's pixels."""
    return synth.render(original[0], DPI)


@pytest.fixture(scope="module")
def ocr(original, image) -> OcrReader:
    """An OCR reader that reads back the original's printed words."""
    return OcrReader(engine=synth.PageWordsEngine(image, synth.words_px(original[0], DPI)))


def test_a_scanned_one_frame_sheet_without_a_grid_is_a_raster_cpt_graph(image) -> None:
    """No text layer, no grid: the frame and its depth ticks make it a raster CPT graph."""
    doc = synth.scanned(image, DPI)
    evidence = PageTriage(ocr=False).classify(doc).pages[0]
    assert evidence.text_chars == 0
    assert evidence.page_class is PageClass.CPT_GRAPH, evidence.reasons
    assert evidence.graph_kind is GraphKind.RASTER


def test_the_frame_and_the_regular_depth_ticks_are_found(image) -> None:
    """The frame rectangle, and one tick per metre along the depth axis."""
    grid = RasterGridDetector().detect(image)
    panel = RasterFrameDetector().detect(image, grid)
    assert panel is not None
    f = panel.frame
    assert f.x0 == pytest.approx(synth.FRAME_X0 * PX, abs=4)
    assert f.x1 == pytest.approx(synth.FRAME_X1 * PX, abs=4)
    assert f.y0 == pytest.approx(synth.FRAME_Y0 * PX, abs=4)
    assert f.y1 == pytest.approx(synth.FRAME_Y1 * PX, abs=4)
    ticks = np.asarray(panel.horizontal_lines)
    assert len(ticks) >= 10
    assert np.median(np.diff(ticks)) == pytest.approx(synth.PT_PER_M * PX, rel=0.03)


def test_the_axes_are_named_by_their_labels_and_drawn_in_their_curve_colours(image, ocr) -> None:
    """qc above in red, Rf top right in blue (right to left), fs below in black, depth left."""
    grid = RasterGridDetector().detect(image)
    panel = RasterFrameDetector().detect(image, grid)
    assert panel is not None
    cal = RasterFrameCalibrator(GENERIC_PROFILE, ocr).calibrate(image, panel, DPI, 1)
    assert cal.depth_reference is DepthReference.DEPTH_BELOW_GROUND
    qc = cal.panel(PanelKind.QC)
    rf = cal.panel(PanelKind.RF)
    fs = cal.panel(PanelKind.FS)
    assert all(p.is_complete for p in (qc, rf, fs))
    assert qc.value_scale.value_at(synth.x_qc(20.0) * PX) == pytest.approx(20.0, abs=0.3)
    assert rf.value_scale.value_at(synth.x_rf(4.0) * PX) == pytest.approx(4.0, abs=0.2)
    assert fs.value_scale.value_at(synth.x_fs(0.5) * PX) == pytest.approx(0.5, abs=0.01)
    assert qc.depth_scale.value_at(synth.y_depth(10.0) * PX) == pytest.approx(10.0, abs=0.05)
    assert qc.curve_colour[0] > 0.6 and qc.curve_colour[2] < 0.4
    assert rf.curve_colour[2] > 0.6 and rf.curve_colour[0] < 0.4
    assert max(fs.curve_colour) < 0.4
    # The level axis printed beside the depth axis gives the ground level.
    assert cal.ground_level_m == pytest.approx(synth.GROUND_LEVEL, abs=0.02)


def test_the_extractor_reads_the_curves_off_the_scan(original, image) -> None:
    """The scanned sheet is digitised end to end: qc within 1 % of its axis."""
    doc = synth.scanned(image, DPI)
    # The digitiser renders the scan at its own raster resolution: the
    # stand-in OCR reads that render.
    render = render_page(doc[0], RASTER_DPI)
    engine = synth.PageWordsEngine(render, synth.words_px(original[0], RASTER_DPI))
    sounding = CptPdfDigitiser(ocr=OcrReader(engine=engine)).digitise_page(doc, 1, GraphKind.RASTER)
    assert PanelKind.QC in sounding.curves
    frame = sounding.to_frame(0.02)
    depth = frame["depth_m"].to_numpy()
    keep = (depth > 1.3) & (depth < 13.2)
    qc = frame["qc_mpa"].to_numpy()[keep]
    truth = np.array([synth.qc_truth(d) for d in depth[keep]])
    assert np.sqrt(np.nanmean((qc - truth) ** 2)) < 0.3
    rf = frame["rf_pct"].to_numpy()[keep]
    rf_truth = np.array([synth.rf_truth(d) for d in depth[keep]])
    assert np.sqrt(np.nanmean((rf - rf_truth) ** 2)) < 0.3


def test_the_black_fs_curve_is_not_taken_from_the_coloured_curves_it_crosses(
    original, image
) -> None:
    """In one frame the black fs curve crosses red qc and blue Rf: only black ink is fs."""
    doc = synth.scanned(image, DPI)
    render = render_page(doc[0], RASTER_DPI)
    engine = synth.PageWordsEngine(render, synth.words_px(original[0], RASTER_DPI))
    sounding = CptPdfDigitiser(ocr=OcrReader(engine=engine)).digitise_page(doc, 1, GraphKind.RASTER)
    frame = sounding.to_frame(0.02)
    depth = frame["depth_m"].to_numpy()
    keep = (depth > 1.3) & (depth < 13.2)
    fs = frame["fs_mpa"].to_numpy()[keep]
    truth = np.array([synth.fs_truth(d) for d in depth[keep]])
    # 1 % of the 0.75 MPa axis.
    assert np.sqrt(np.nanmean((fs - truth) ** 2)) < 0.0075


def test_grid_pieces_on_one_lattice_inside_a_frame_are_one_framed_panel() -> None:
    """A faint grid read in pieces (same pitch, one lattice) is the frame's own grid."""
    frame = RasterPanel(
        frame=FrameRect(100.0, 100.0, 1000.0, 2000.0),
        vertical_lines=(100.0, 1000.0),
        horizontal_lines=tuple(100.0 + 100.0 * i for i in range(20)),
        pitch=900.0,
        framed=True,
    )
    rows = tuple(100.0 + 100.0 * i for i in range(20))
    pieces = (
        RasterPanel(FrameRect(100.0, 100.0, 300.0, 2000.0), (100.0, 200.0, 300.0), rows, 100.0),
        RasterPanel(FrameRect(500.0, 100.0, 700.0, 2000.0), (500.0, 600.0, 700.0), rows, 100.0),
    )
    grid = RasterGrid(np.zeros((0, 3)), np.zeros((0, 3)), pieces)
    assert framed_or_grid_panels(grid, frame, image_height=2200) == (frame,)


def test_side_by_side_panels_with_their_own_grids_stay_separate_panels() -> None:
    """Two gridded panels with different pitches are two panels, frame or not."""
    frame = RasterPanel(
        frame=FrameRect(100.0, 100.0, 1000.0, 2000.0),
        vertical_lines=(100.0, 1000.0),
        horizontal_lines=tuple(100.0 + 100.0 * i for i in range(20)),
        pitch=900.0,
        framed=True,
    )
    left = RasterPanel(
        FrameRect(100.0, 100.0, 500.0, 2000.0),
        (100.0, 200.0, 300.0, 400.0, 500.0),
        tuple(100.0 + 100.0 * i for i in range(20)),
        100.0,
    )
    right = RasterPanel(
        FrameRect(560.0, 100.0, 1000.0, 2000.0),
        (560.0, 670.0, 780.0, 890.0, 1000.0),
        tuple(100.0 + 100.0 * i for i in range(20)),
        110.0,
    )
    grid = RasterGrid(np.zeros((0, 3)), np.zeros((0, 3)), (left, right))
    assert framed_or_grid_panels(grid, frame, image_height=2200) == (left, right)


def _scanned_ruled_table() -> np.ndarray:
    """A framed, ruled table of text with rows of uneven height, scanned (no text layer)."""
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=synth.PAGE_W, height=synth.PAGE_H)
    shape = page.new_shape()
    shape.draw_rect(pymupdf.Rect(60, 70, 520, 730))
    shape.draw_line((100, 70), (100, 730))
    y = 70.0
    for i in range(18):
        y += (24.0, 48.0, 36.0)[i % 3]
        if y >= 730:
            break
        shape.draw_line((60, y), (520, y))
    shape.finish(color=(0, 0, 0), width=0.8)
    shape.commit()
    for i in range(40):
        page.insert_text(
            (110, 88 + 16 * i), "Voor de diagrammen gelden de volgende schalen", fontsize=8
        )
    return synth.render(page, DPI)


def test_a_scanned_ruled_table_in_a_frame_is_not_a_graph() -> None:
    """Rules leaving a table border are not depth ticks; uneven rows are not a depth axis."""
    doc = synth.scanned(_scanned_ruled_table(), DPI)
    evidence = PageTriage(ocr=False).classify(doc).pages[0]
    assert evidence.page_class is not PageClass.CPT_GRAPH, evidence.reasons
