"""Vector path: a page whose curves are drawing commands is read exactly.

Owner ask: "an overlay that puts the axis correctly and then per depth ... match
the pixels from the graph". When the curve is a vector path there are no pixels
to chase: the polyline's own vertices ARE the data, so calibration (frame + two
linear scales per panel) plus the vertices must give back the drawn values.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_registry import (
    LayoutProfileRegistry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.vector_axis_calibrator import (
    VectorAxisCalibrator,
)
from groundmodel.infrastructure.parsers.cpt.pdf.vector_curve_extractor import (
    VectorCurveExtractor,
)

from . import _synthetic_cpt_pdf as synth


@pytest.fixture(scope="module")
def calibrated() -> tuple[object, PageCalibration]:
    """The synthetic page and its vector calibration."""
    doc = synth.synthetic_cpt_pdf()
    page = doc[0]
    profile = LayoutProfileRegistry.default().match(page.get_text())
    return page, VectorAxisCalibrator(profile).calibrate(page, page_number=1)


def test_calibration_finds_a_qc_and_an_fs_panel(calibrated: tuple[object, PageCalibration]) -> None:
    """Calibration finds a qc and an fs panel."""
    _, cal = calibrated
    kinds = {p.kind for p in cal.panels}
    assert {PanelKind.QC, PanelKind.FS} <= kinds


def test_qc_scale_puts_each_tick_value_on_its_grid_line(
    calibrated: tuple[object, PageCalibration],
) -> None:
    """Qc scale puts each tick value on its grid line."""
    _, cal = calibrated
    qc = cal.panel(PanelKind.QC)
    assert qc.value_scale is not None
    for value in (0.0, 5.0, 10.0, 20.0):
        assert qc.value_scale.coord_of(value) == pytest.approx(synth.x_qc(value), abs=0.05)


def test_frame_spans_the_panel_grid(calibrated: tuple[object, PageCalibration]) -> None:
    """Frame spans the panel grid."""
    _, cal = calibrated
    frame = cal.panel(PanelKind.QC).frame
    assert frame.x0 == pytest.approx(synth.x_qc(0.0), abs=0.5)
    assert frame.x1 == pytest.approx(synth.x_qc(synth.QC_MAX), abs=0.5)
    assert frame.y0 == pytest.approx(synth.FRAME_TOP, abs=0.5)
    assert frame.y1 == pytest.approx(synth.FRAME_BOTTOM, abs=0.5)


def test_depth_axis_increasing_downward_is_depth_below_ground(
    calibrated: tuple[object, PageCalibration],
) -> None:
    """Depth axis increasing downward is depth below ground."""
    _, cal = calibrated
    assert cal.depth_reference is DepthReference.DEPTH_BELOW_GROUND
    depth = cal.panel(PanelKind.QC).depth_scale
    assert depth is not None
    assert depth.value_at(synth.y_depth(7.0)) == pytest.approx(7.0, abs=0.01)


def test_sounding_block_gives_id_and_ground_level(
    calibrated: tuple[object, PageCalibration],
) -> None:
    """Sounding block gives id and ground level."""
    _, cal = calibrated
    assert cal.sounding_id == "S1"
    assert cal.ground_level_m == pytest.approx(3.0)


def test_calibration_survives_a_round_trip_through_a_plain_dict(
    calibrated: tuple[object, PageCalibration],
) -> None:
    """Calibration survives a round trip through a plain dict."""
    _, cal = calibrated
    assert PageCalibration.from_dict(cal.to_dict()) == cal


def test_extracted_qc_matches_the_drawn_values(calibrated: tuple[object, PageCalibration]) -> None:
    """Extracted qc matches the drawn values."""
    page, cal = calibrated
    sounding = VectorCurveExtractor().extract(page, cal)  # type: ignore[arg-type]
    qc = sounding.curves[PanelKind.QC]
    truth = np.array([min(synth.qc_truth(d), synth.QC_MAX) for d in qc.depth_m])
    assert len(qc.depth_m) == len(synth.truth_depths())
    assert np.max(np.abs(qc.value - truth)) < 0.01


def test_values_drawn_against_the_panel_edge_are_flagged_clipped(
    calibrated: tuple[object, PageCalibration],
) -> None:
    """Values drawn against the panel edge are flagged clipped."""
    page, cal = calibrated
    qc = VectorCurveExtractor().extract(page, cal).curves[PanelKind.QC]  # type: ignore[arg-type]
    over = np.array([synth.qc_truth(d) >= synth.QC_MAX for d in qc.depth_m])
    assert over.any()
    assert np.array_equal(qc.clipped, over)


def test_fs_is_read_from_the_red_curve(calibrated: tuple[object, PageCalibration]) -> None:
    """Fs is read from the red curve."""
    page, cal = calibrated
    fs = VectorCurveExtractor().extract(page, cal).curves[PanelKind.FS]  # type: ignore[arg-type]
    truth = np.array([synth.fs_truth(d) for d in fs.depth_m])
    assert np.max(np.abs(fs.value - truth)) < 0.001


def test_resampled_table_uses_a_regular_two_centimetre_grid(
    calibrated: tuple[object, PageCalibration],
) -> None:
    """Resampled table uses a regular two centimetre grid."""
    page, cal = calibrated
    frame = VectorCurveExtractor().extract(page, cal).to_frame(step_m=0.02)  # type: ignore[arg-type]
    depths = frame["depth_m"].to_numpy()
    assert np.allclose(np.diff(depths), 0.02)
    assert {"depth_m", "qc_mpa", "fs_mpa", "qc_clipped"} <= set(frame.columns)
