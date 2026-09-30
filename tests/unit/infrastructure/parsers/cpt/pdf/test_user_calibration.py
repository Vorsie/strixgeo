"""The calibration overlay the user edits (brief 2026-09-30, piece C).

"the page image with the orange digitised curve drawn over it (the overlay
PNG from the backend), the frame corners draggable, the two tick values per
axis editable, ... a curve-colour eyedropper ... a 'Re-extract' that posts the
calibration dict". So: a calibration dict edited by the user re-extracts the
curve THROUGH that calibration, the eyedropper colour is the colour traced, a
multi-sheet sounding comes back as one, and the overlay is drawn with PyMuPDF
alone (OCR / OpenCV optional).
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pymupdf
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.axis_scale import AxisScale
from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import (
    CptPdfDigitiser,
    join_sheets,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_page_renderer import PdfPageRenderer

from . import _synthetic_cpt_pdf as synth


@pytest.fixture(scope="module")
def doc() -> pymupdf.Document:
    """A one-sheet synthetic report."""
    return synth.synthetic_cpt_pdf()


@pytest.fixture(scope="module")
def auto(doc: pymupdf.Document) -> PageCalibration:
    """The calibration the digitiser found by itself."""
    return CptPdfDigitiser(ocr=False).digitise_page(doc, 1).calibrations[0]


def _with_qc_scale(cal: PageCalibration, scale: AxisScale) -> PageCalibration:
    """Return ``cal`` with the qc panel's value scale replaced (a typed tick value)."""
    panels = tuple(
        replace(p, value_scale=scale, source="user") if p.kind is PanelKind.QC else p
        for p in cal.panels
    )
    return replace(cal, panels=panels)


def test_a_typed_tick_value_re_extracts_the_curve_through_it(
    doc: pymupdf.Document, auto: PageCalibration
) -> None:
    """Typing 40 where the sheet says 20 doubles every qc read through that panel."""
    qc = auto.panel(PanelKind.QC)
    assert qc.value_scale is not None
    doubled = AxisScale(synth.x_qc(0.0), 0.0, synth.x_qc(20.0), 40.0)
    user = PageCalibration.from_dict(_with_qc_scale(auto, doubled).to_dict())
    before = CptPdfDigitiser(ocr=False).digitise_with_calibration(doc, auto).curves[PanelKind.QC]
    after = CptPdfDigitiser(ocr=False).digitise_with_calibration(doc, user).curves[PanelKind.QC]
    unclipped = ~before.clipped
    assert np.allclose(after.value[unclipped], 2.0 * before.value[unclipped], atol=1e-6)


def test_the_eyedropper_colour_is_the_colour_traced(
    doc: pymupdf.Document, auto: PageCalibration
) -> None:
    """A curve colour no stroke on the page has reads no qc curve at all."""
    panels = tuple(
        replace(p, curve_colour=(0.2, 0.9, 0.9)) if p.kind is PanelKind.QC else p
        for p in auto.panels
    )
    sounding = CptPdfDigitiser(ocr=False).digitise_with_calibration(
        doc, replace(auto, panels=panels)
    )
    assert PanelKind.QC not in sounding.curves
    assert PanelKind.FS in sounding.curves


def test_two_sheets_join_into_one_sounding_deeper_sheet_second(doc: pymupdf.Document) -> None:
    """join_sheets folds a sounding's sheets into one, whatever their order."""
    sheet = CptPdfDigitiser(ocr=False).digitise_page(doc, 1)
    qc = sheet.curves[PanelKind.QC]
    half = len(qc) // 2
    top = replace(
        sheet,
        curves={
            PanelKind.QC: replace(
                qc, depth_m=qc.depth_m[:half], value=qc.value[:half], clipped=qc.clipped[:half]
            )
        },
    )
    base = replace(
        sheet,
        page_numbers=(2,),
        curves={
            PanelKind.QC: replace(
                qc, depth_m=qc.depth_m[half:], value=qc.value[half:], clipped=qc.clipped[half:]
            )
        },
    )
    joined = join_sheets([top, base])
    assert joined.page_numbers == (1, 2)
    assert np.array_equal(joined.curves[PanelKind.QC].depth_m, qc.depth_m)


def test_the_overlay_draws_the_read_curve_in_orange_over_the_page(
    doc: pymupdf.Document, auto: PageCalibration
) -> None:
    """The overlay PNG shows the digitised qc curve, in orange, where the sheet drew it."""
    sounding = CptPdfDigitiser(ocr=False).digitise_with_calibration(doc, auto)
    dpi = 72
    png = PdfPageRenderer().overlay_png(doc, auto, sounding, dpi=dpi)
    pix = pymupdf.Pixmap(png)
    depth = 5.0
    qc = synth.qc_truth(depth)
    x, y = round(synth.x_qc(qc)), round(synth.y_depth(depth))
    window = [pix.pixel(x + dx, y + dy) for dx in range(-2, 3) for dy in range(-2, 3)]
    assert any(r > 200 and 90 < g < 190 and b < 80 for r, g, b in (w[:3] for w in window))


def test_a_page_renders_as_a_png_at_the_asked_resolution(doc: pymupdf.Document) -> None:
    """The page thumbnail is a PNG of the page at the asked dpi."""
    png = PdfPageRenderer().page_png(doc, 1, dpi=36)
    pix = pymupdf.Pixmap(png)
    assert (pix.width, pix.height) == (round(synth.PAGE_W / 2), round(synth.PAGE_H / 2))
