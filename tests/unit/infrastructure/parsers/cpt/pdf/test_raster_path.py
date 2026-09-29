"""Raster path: "the pdf cpt digitiser also needs to work on scanned pdf's".

A scan has NO text layer and is never perfectly straight. The page is rendered,
the skew is measured from the frame and removed, the frame and grid are found
from long straight dark lines, and the curve is read per depth row by sliding a
"ball" left or right until it sits on the curve's pixels. The axis values come
from the user (two labelled grid lines per axis) when OCR is unavailable, so the
extraction must run from that user-supplied calibration alone.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.raster_curve_extractor import (
    RasterCurveExtractor,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_deskewer import RasterDeskewer
from groundmodel.infrastructure.parsers.cpt.pdf.raster_grid_detector import RasterGridDetector

from . import _synthetic_cpt_pdf as synth

DPI = 200
SKEW_DEG = 0.5
PX = DPI / 72.0


@pytest.fixture(scope="module")
def scan() -> np.ndarray:
    """A synthetic CPT page rasterised at 200 dpi and rotated 0.5 degrees."""
    straight = synth.render_rgb(synth.synthetic_cpt_pdf()[0], DPI)
    return synth.rotate_rgb(straight, SKEW_DEG)


def test_a_scanned_graph_page_has_no_text_but_is_triaged_as_a_raster_cpt_graph(
    scan: np.ndarray,
) -> None:
    """A scanned graph page has no text but is triaged as a raster cpt graph."""
    doc = synth.scanned_pdf_from_rgb(scan, DPI)
    evidence = PageTriage().classify(doc).pages[0]
    assert evidence.text_chars == 0
    assert evidence.page_class is PageClass.CPT_GRAPH, evidence.reasons
    assert evidence.graph_kind is GraphKind.RASTER
    assert evidence.origin is CptOrigin.UNKNOWN


def test_skew_is_measured_from_the_frame(scan: np.ndarray) -> None:
    """Skew is measured from the frame."""
    angle = RasterDeskewer().estimate_skew_deg(scan)
    assert angle == pytest.approx(SKEW_DEG, abs=0.05)


def test_deskewed_grid_gives_one_frame_per_panel(scan: np.ndarray) -> None:
    """Deskewed grid gives one frame per panel."""
    straight, _ = RasterDeskewer().deskew(scan)
    grid = RasterGridDetector().detect(straight)
    assert len(grid.panels) == 2
    qc_frame = grid.panels[0].frame
    assert qc_frame.x0 == pytest.approx(synth.x_qc(0.0) * PX, abs=3)
    assert qc_frame.x1 == pytest.approx(synth.x_qc(synth.QC_MAX) * PX, abs=3)
    assert qc_frame.y0 == pytest.approx(synth.FRAME_TOP * PX, abs=3)
    assert qc_frame.y1 == pytest.approx(synth.FRAME_BOTTOM * PX, abs=3)


def _user_calibration(straight: np.ndarray) -> PageCalibration:
    """What a user types: the values of the first and last grid line per axis."""
    grid = RasterGridDetector().detect(straight)
    qc_panel, fs_panel = grid.panels
    panels = [
        PanelCalibration.from_user_ticks(
            kind=PanelKind.QC,
            frame=qc_panel.frame,
            value_ticks=((qc_panel.vertical_lines[0], 0.0), (qc_panel.vertical_lines[-1], 20.0)),
            depth_ticks=(
                (qc_panel.horizontal_lines[0], 0.0),
                (qc_panel.horizontal_lines[-1], 14.0),
            ),
            unit="MPa",
            curve_colour=synth.QC_COLOUR,
        ),
        PanelCalibration.from_user_ticks(
            kind=PanelKind.FS,
            frame=fs_panel.frame,
            value_ticks=((fs_panel.vertical_lines[0], 0.0), (fs_panel.vertical_lines[-1], 0.4)),
            depth_ticks=(
                (fs_panel.horizontal_lines[0], 0.0),
                (fs_panel.horizontal_lines[-1], 14.0),
            ),
            unit="MPa",
            curve_colour=synth.FS_COLOUR,
        ),
    ]
    return PageCalibration.for_image(
        page_number=1, dpi=DPI, panels=panels, depth_reference=DepthReference.DEPTH_BELOW_GROUND
    )


def test_ball_extraction_from_user_calibration_recovers_the_curves(scan: np.ndarray) -> None:
    """Ball extraction from user calibration recovers the curves."""
    straight, _ = RasterDeskewer().deskew(scan)
    cal = _user_calibration(straight)
    sounding = RasterCurveExtractor().extract(straight, cal)
    frame = sounding.to_frame(step_m=0.02)
    depth = frame["depth_m"].to_numpy()
    keep = (depth > 0.2) & (depth < 13.3)
    qc = frame["qc_mpa"].to_numpy()[keep]
    qc_true = np.minimum([synth.qc_truth(d) for d in depth[keep]], synth.QC_MAX)
    fs = frame["fs_mpa"].to_numpy()[keep]
    fs_true = np.array([synth.fs_truth(d) for d in depth[keep]])
    # 1 % of the axis range RMS is the bar for a 200 dpi scan.
    assert np.sqrt(np.nanmean((qc - qc_true) ** 2)) < 0.2
    assert np.sqrt(np.nanmean((fs - fs_true) ** 2)) < 0.004


def test_extraction_refuses_a_panel_whose_scale_the_user_has_not_given(scan: np.ndarray) -> None:
    """Extraction refuses a panel whose scale the user has not given."""
    straight, _ = RasterDeskewer().deskew(scan)
    grid = RasterGridDetector().detect(straight)
    draft = PanelCalibration.draft(kind=PanelKind.QC, frame=grid.panels[0].frame, unit="MPa")
    cal = PageCalibration.for_image(
        page_number=1, dpi=DPI, panels=[draft], depth_reference=DepthReference.DEPTH_BELOW_GROUND
    )
    with pytest.raises(ValueError, match="scale"):
        RasterCurveExtractor().extract(straight, cal)
