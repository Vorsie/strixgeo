"""Build small synthetic CPT report pages with PyMuPDF for the digitiser tests.

The page mimics the layout the real contractor sheets use: a cone-resistance
panel and a sleeve-friction panel side by side, tick labels above each panel,
a depth axis on the left, a black grid, one coloured polyline per curve, and a
sounding block with the id and the ground level. Every value on the page is
known exactly, so a test compares what the digitiser reads against the truth,
not against a second reading.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
import pymupdf

# Page geometry in PDF points (A4 portrait).
PAGE_W = 595.0
PAGE_H = 842.0
FRAME_TOP = 90.0
FRAME_BOTTOM = 790.0
DEPTH_MAX_M = 14.0
PT_PER_M = (FRAME_BOTTOM - FRAME_TOP) / DEPTH_MAX_M  # 50 pt per metre

QC_X0 = 60.0
QC_MAX = 20.0
QC_PT_PER_MPA = 12.0  # 0..20 MPa over 240 pt
FS_X0 = 330.0
FS_MAX = 0.4
FS_PT_PER_MPA = 500.0  # 0..0.4 MPa over 200 pt

QC_COLOUR = (0.0, 0.0, 1.0)
FS_COLOUR = (1.0, 0.0, 0.0)
GRID_COLOUR = (0.0, 0.0, 0.0)

STEP_M = 0.02
LAST_DEPTH_M = 13.5


def qc_truth(depth_m: float) -> float:
    """Return the true cone resistance (MPa, unclipped) at a depth."""
    return 12.0 + 10.0 * math.sin(depth_m * 0.9)


def fs_truth(depth_m: float) -> float:
    """Return the true sleeve friction (MPa) at a depth."""
    return 0.15 + 0.1 * math.cos(depth_m * 0.7)


def truth_depths() -> list[float]:
    """Return the depth of every drawn scan (0.02 m steps, like a GEF)."""
    n = round(LAST_DEPTH_M / STEP_M)
    return [round((i + 1) * STEP_M, 4) for i in range(n)]


def x_qc(value: float) -> float:
    """Return the page x of a cone resistance (clipped to the panel)."""
    return QC_X0 + min(max(value, 0.0), QC_MAX) * QC_PT_PER_MPA


def x_fs(value: float) -> float:
    """Return the page x of a sleeve friction (clipped to the panel)."""
    return FS_X0 + min(max(value, 0.0), FS_MAX) * FS_PT_PER_MPA


def y_depth(depth_m: float) -> float:
    """Return the page y of a depth below ground."""
    return FRAME_TOP + depth_m * PT_PER_M


def _centred(page: pymupdf.Page, x: float, y: float, text: str, size: float = 7.0) -> None:
    width = pymupdf.get_text_length(text, fontsize=size)
    page.insert_text((x - width / 2.0, y), text, fontsize=size)


@dataclass
class SyntheticPageSpec:
    """What to put on one synthetic page."""

    sounding_id: str = "S1"
    location: str = "TEST-001"
    project: str = "99.01-001"
    company: str = "Synthetic Sondeer B.V."
    ground_level: float = 3.0
    extra_lines: list[str] = field(default_factory=list)
    qc_label_shift: float = 0.0
    clip_crossings: bool = False
    x: float | None = None
    y: float | None = None
    test_date: str | None = None


def _qc_polyline(depths: list[float], clip_crossings: bool) -> list[tuple[float, float]]:
    """Return the qc polyline; optionally with the plotter's clip-edge crossings.

    A plotting program that clips at the axis maximum inserts an extra vertex
    where the line from a scan inside the panel to a scan beyond it crosses
    the edge. That vertex is not a scan.
    """
    pts: list[tuple[float, float]] = []
    prev: float | None = None
    for d in depths:
        q = qc_truth(d)
        if clip_crossings and prev is not None and (qc_truth(prev) < QC_MAX) != (q < QC_MAX):
            t = (QC_MAX - qc_truth(prev)) / (q - qc_truth(prev))
            pts.append((x_qc(QC_MAX), y_depth(prev + t * (d - prev))))
        pts.append((x_qc(q), y_depth(d)))
        prev = d
    return pts


def draw_cpt_page(doc: pymupdf.Document, spec: SyntheticPageSpec | None = None) -> pymupdf.Page:
    """Append one synthetic CPT graph page to ``doc`` and return it."""
    spec = spec or SyntheticPageSpec()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    shape = page.new_shape()
    qc_ticks = [0.0, 5.0, 10.0, 15.0, 20.0]
    fs_ticks = [0.0, 0.1, 0.2, 0.3, 0.4]
    for v in qc_ticks:
        shape.draw_line((x_qc(v), FRAME_TOP), (x_qc(v), FRAME_BOTTOM))
    for v in fs_ticks:
        shape.draw_line((x_fs(v), FRAME_TOP), (x_fs(v), FRAME_BOTTOM))
    for m in range(int(DEPTH_MAX_M) + 1):
        shape.draw_line((x_qc(0.0), y_depth(m)), (x_qc(QC_MAX), y_depth(m)))
        shape.draw_line((x_fs(0.0), y_depth(m)), (x_fs(FS_MAX), y_depth(m)))
    shape.finish(color=GRID_COLOUR, width=0.5)
    depths = truth_depths()
    shape.draw_polyline(_qc_polyline(depths, spec.clip_crossings))
    shape.finish(color=QC_COLOUR, width=0.84, closePath=False)
    shape.draw_polyline([(x_fs(fs_truth(d)), y_depth(d)) for d in depths])
    shape.finish(color=FS_COLOUR, width=0.84, closePath=False)
    shape.commit()
    page.insert_text((QC_X0, 62), "Conusweerstand (MPa)", fontsize=8)
    page.insert_text((FS_X0, 62), "Plaatselijke wrijving (MPa)", fontsize=8)
    for v in qc_ticks:
        _centred(page, x_qc(v) + spec.qc_label_shift, 80, f"{v:g}")
    for v in fs_ticks:
        _centred(page, x_fs(v), 80, f"{v:g}")
    for m in range(int(DEPTH_MAX_M) + 1):
        label = f"{m:g}"
        width = pymupdf.get_text_length(label, fontsize=7)
        page.insert_text((50 - width, y_depth(m) + 2.5), label, fontsize=7)
    page.insert_text((14, 450), "Diepte (m)", fontsize=8, rotate=90)
    lines = [
        spec.company,
        f"ID SONDERING : {spec.sounding_id}",
        f"LOCATIE : {spec.location}",
        f"PROJECTNUMMER : {spec.project}",
        f"HOOGTE MAAIVELD : {spec.ground_level:.2f} m TAW",
        *spec.extra_lines,
    ]
    # Coordinates and date in a second column, as the contractor block prints
    # them right of the id block (and so the page does not overflow).
    right: list[str] = []
    if spec.x is not None and spec.y is not None:
        right.append(f"X-CO\u00d6RDINAAT (Lambert72) : {spec.x:.2f}")
        right.append(f"Y-CO\u00d6RDINAAT(Lambert72) : {spec.y:.2f}")
    if spec.test_date is not None:
        right.append(f"DATUM : {spec.test_date}")
    for i, line in enumerate(lines):
        page.insert_text((60, 802 + 6 * i), line, fontsize=5)
    for i, line in enumerate(right):
        page.insert_text((330, 802 + 6 * i), line, fontsize=5)
    return page


def synthetic_cpt_pdf(spec: SyntheticPageSpec | None = None) -> pymupdf.Document:
    """Return a one-page document holding a synthetic CPT graph page."""
    doc = pymupdf.open()
    draw_cpt_page(doc, spec)
    return doc


def render_rgb(page: pymupdf.Page, dpi: int) -> np.ndarray:
    """Render a page to an ``(h, w, 3)`` uint8 RGB array."""
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3).copy()


def rotate_rgb(image: np.ndarray, degrees: float) -> np.ndarray:
    """Rotate an RGB image about its centre (counter-clockwise), white border."""
    h, w = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), degrees, 1.0)
    return cv2.warpAffine(
        image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255)
    )


def scanned_pdf_from_rgb(image: np.ndarray, dpi: int) -> pymupdf.Document:
    """Wrap an RGB array as a one-page image-only PDF (a scan: no text layer)."""
    h, w = image.shape[:2]
    ok, png = cv2.imencode(".png", cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    assert ok
    doc = pymupdf.open()
    page = doc.new_page(width=w * 72.0 / dpi, height=h * 72.0 / dpi)
    page.insert_image(page.rect, stream=png.tobytes())
    return doc


def add_text_page(doc: pymupdf.Document) -> None:
    """Append a plain prose page (report body text)."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    body = "Dit is lopende tekst van het proefverslag over de werf en de aanpak van het onderzoek."
    for i in range(30):
        page.insert_text((50, 60 + 24 * i), body, fontsize=9)


def add_photo_page(doc: pymupdf.Document) -> None:
    """Append a page that is one big photo with a short caption."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    rng = np.random.default_rng(3)
    img = rng.integers(0, 255, size=(600, 450, 3), dtype=np.uint8)
    ok, png = cv2.imencode(".png", img)
    assert ok
    page.insert_image(pymupdf.Rect(40, 60, 555, 760), stream=png.tobytes())
    page.insert_text((40, 780), "Foto 3. Sondeertruck op de werf", fontsize=9)


def add_table_page(doc: pymupdf.Document) -> None:
    """Append a ruled table of coordinates (numbers in a grid of cells)."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    shape = page.new_shape()
    for r in range(31):
        shape.draw_line((40, 60 + 20 * r), (555, 60 + 20 * r))
    for c in range(6):
        shape.draw_line((40 + 103 * c, 60), (40 + 103 * c, 660))
    shape.finish(color=(0, 0, 0), width=0.5)
    shape.commit()
    page.insert_text((45, 55), "Nr. X Y MV in mTAW Einddiepte", fontsize=8)
    for r in range(30):
        for c in range(5):
            page.insert_text((45 + 103 * c, 75 + 20 * r), f"{1000 + 37 * r + c}.{c}", fontsize=8)
