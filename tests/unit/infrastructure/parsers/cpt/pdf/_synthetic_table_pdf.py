"""Build a small synthetic "printed table" CPT report with PyMuPDF.

Some test reports print every sounding twice: a graph sheet (the curves as one
pasted picture) and the same sounding as a numeric table, one row per 0.20 m:
depth D, level TAW, qc, Fs, "Rf, %", "Inclinatie, °" and two calculated
columns (φ' and C) the platform never imports. Every sheet carries the same
text header ("<report> - <sounding id>", test type, date, GPS X / Y, the
groundwater remark and an "Opmerking" remark). All values here are synthetic
and known exactly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
import pymupdf

PAGE_W = 595.0
PAGE_H = 842.0
REPORT = "Z1234567"
SOUNDING = "CPTE001"
GROUND_LEVEL = 5.85
STEP_M = 0.20
X = 150000.123
Y = 200000.456

# Right edges of the table columns (pt): the printed numbers are right-aligned.
COLUMN_RIGHT_E = {
    "D": 94.0,
    "TAW": 136.0,
    "qc": 178.0,
    "Fs": 220.0,
    "Rf, %": 262.0,
    "Inclinatie, °": 304.0,
    "φ'": 346.0,
    "C": 388.0,
}
COLUMN_RIGHT_M = {
    "D": 94.0,
    "TAW": 136.0,
    "qc": 178.0,
    "Qt": 220.0,
    "φ'": 262.0,
    "C": 304.0,
}
ROW_PITCH_PT = 10.8


def qc_of(depth_m: float) -> float:
    """Return the printed cone resistance (MPa, 2 decimals) at a depth."""
    return round(1.0 + 0.5 * depth_m, 2)


def fs_of(depth_m: float) -> float:
    """Return the printed sleeve friction (MPa, 3 decimals) at a depth."""
    return round(0.02 * qc_of(depth_m), 3)


def rf_of(depth_m: float) -> float:
    """Return the printed friction ratio (%, 2 decimals) computed from the printed values."""
    return round(fs_of(depth_m) / qc_of(depth_m) * 100.0, 2)


def comma(value: float, decimals: int) -> str:
    """Return a number the way the sheets print it: decimal comma."""
    return f"{value:.{decimals}f}".replace(".", ",")


@dataclass
class TableReportSpec:
    """What to put in the synthetic report.

    ``depths`` are the printed rows; ``page_break_after`` splits them over
    two table sheets (the continuation repeats the header and the column
    names, not the title). ``overrides`` replaces one printed cell
    ``(depth, column) -> text``. ``cone_line`` replaces the printed cone line
    ("CPT-M 15 cm²"); ``qt_on_e`` adds a Qt column to a CPT-E table.
    """

    cone: str = "E"
    sounding: str = SOUNDING
    depths: list[float] = field(default_factory=list)
    page_break_after: float = 5.01
    overrides: dict[tuple[float, str], str] = field(default_factory=dict)
    remarks: list[str] = field(
        default_factory=lambda: [
            "Opmerking: voorgeduwd met vaste punt tot een diepte van 1 m : geen meetwaarden"
        ]
    )
    system_line: bool = True
    calculation_page: bool = False
    graph_page: bool = True
    cone_line: str | None = None
    qt_on_e: bool = False


def default_depths() -> list[float]:
    """Return 1.01 .. 9.81 m every 0.20 m minus 4.21-4.61 (a drilled stretch)."""
    depths = [round(1.01 + STEP_M * i, 2) for i in range(45)]
    return [d for d in depths if not 4.2 < d < 4.7]


def _header(page: pymupdf.Page, spec: TableReportSpec) -> None:
    """Write the text header every sheet of the sounding carries."""
    if spec.cone == "E":
        standard = "Proef volgens ISO 22476-1, toepassingklasse 2, proef type TE1"
        cone = "CPT-E 15 cm²"
    else:
        standard = "Proef volgens ISO 22476-12, toepassingklasse 7, proef type TM4"
        cone = "CPT-M M1"
    page.insert_text((222, 54), standard, fontsize=8)
    page.insert_text((222, 78), f"{REPORT} - {spec.sounding}", fontsize=8)
    page.insert_text((404, 78), spec.cone_line or cone, fontsize=8)
    page.insert_text((222, 88), "Uitvoeringsdatum: 04-07-2022", fontsize=8)
    page.insert_text((404, 88), "200 kN", fontsize=8)
    page.insert_text((222, 98), "1000 TESTSTAD", fontsize=8)
    page.insert_text((404, 98), "GRW: Droog op 1,50 m", fontsize=8)
    page.insert_text((222, 108), f"GPS X: {comma(X, 3)}     GPS Y: {comma(Y, 3)}", fontsize=8)
    for i, line in enumerate(spec.remarks):
        page.insert_text((222, 132 + 8 * i), line, fontsize=8)


def _right(page: pymupdf.Page, right: float, y: float, text: str, size: float = 8.0) -> None:
    """Write ``text`` right-aligned on ``right`` (φ in a font that has it)."""
    font = "china-s" if "φ" in text else "helv"
    width = pymupdf.get_text_length(text, fontname=font, fontsize=size)
    page.insert_text((right - width, y), text, fontsize=size, fontname=font)


def qt_of(depth_m: float) -> float:
    """Return the printed total resistance Qt (kN, 2 decimals) at a depth."""
    return round(10.0 + depth_m, 2)


def _columns(spec: TableReportSpec) -> dict[str, float]:
    """Return the printed columns of the spec's table, name -> right edge (pt)."""
    if spec.cone != "E":
        return COLUMN_RIGHT_M
    return {**COLUMN_RIGHT_E, "Qt": 430.0} if spec.qt_on_e else COLUMN_RIGHT_E


def _row(depth: float, cone: str) -> dict[str, str]:
    """Return the printed cells of one row."""
    cells = {
        "D": comma(depth, 2),
        "TAW": comma(GROUND_LEVEL - depth, 2),
        "qc": comma(qc_of(depth), 2),
        "φ'": f"{comma(30.0, 2)}°",
        "C": comma(50.0, 2),
    }
    if cone == "E":
        cells["Fs"] = comma(fs_of(depth), 3)
        cells["Rf, %"] = comma(rf_of(depth), 2)
        cells["Inclinatie, °"] = comma(3.1, 1)
    cells["Qt"] = comma(qt_of(depth), 2)
    return cells


def _table_page(
    doc: pymupdf.Document, spec: TableReportSpec, depths: list[float], title: bool
) -> None:
    """Append one numeric table sheet holding ``depths``."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _header(page, spec)
    columns = _columns(spec)
    y = 168.0
    if title:
        page.insert_text((52, 165), "De terreingegevens en parameters", fontsize=8)
        y = 186.0
    for name, right in columns.items():
        # Column headers in a smaller type, as printed: "Rf, %" and
        # "Inclinatie, °" stay apart.
        _right(page, right, y, name, size=6.5)
    for i, depth in enumerate(depths):
        cells = _row(depth, spec.cone)
        row_y = y + 13.0 + ROW_PITCH_PT * i
        for name, right in columns.items():
            text = spec.overrides.get((depth, name), cells[name])
            if text:
                _right(page, right, row_y, text)
    page.insert_text((262, 828), f"Pagina {page.number + 1}", fontsize=8)


def _calculation_page(doc: pymupdf.Document, spec: TableReportSpec, depths: list[float]) -> None:
    """Append a bearing-capacity table (calculated values only): never imported."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _header(page, spec)
    page.insert_text((52, 165), "Draagvermogen en toelaatbare funderingsdruk", fontsize=8)
    names = {"D": 94.0, "TAW": 136.0, "qc": 178.0, "Gnd": 220.0, "Pb": 262.0, "qd": 304.0}
    for name, right in names.items():
        _right(page, right, 186.0, name, size=6.5)
    for i, depth in enumerate(depths):
        row_y = 199.0 + ROW_PITCH_PT * i
        values = [comma(depth, 2), comma(GROUND_LEVEL - depth, 2), comma(qc_of(depth), 2)]
        values += ["16", comma(20.0, 2), comma(1.5, 2)]
        for (_name, right), text in zip(names.items(), values, strict=True):
            _right(page, right, row_y, text)


def _graph_page(doc: pymupdf.Document, spec: TableReportSpec) -> None:
    """Append the graph sheet: the header plus ONE pasted picture of the graph."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _header(page, spec)
    img = np.full((1200, 1000, 3), 255, dtype=np.uint8)
    cv2.rectangle(img, (80, 40), (950, 1150), (0, 0, 0), 3)
    cv2.line(img, (100, 60), (900, 1100), (0, 0, 255), 3)
    ok, png = cv2.imencode(".png", img)
    assert ok
    page.insert_image(pymupdf.Rect(40, 160, 560, 790), stream=png.tobytes())
    if spec.system_line:
        page.insert_text(
            (52, 815),
            "Coördinaten gemeten in Lambert 72 en peilen in TAW",
            fontsize=7,
        )


def table_report(spec: TableReportSpec | None = None) -> pymupdf.Document:
    """Return the synthetic report: graph sheet, then the table over two sheets.

    Parameters
    ----------
    spec : TableReportSpec or None
        What to print; the default sounding when None.

    Returns
    -------
    pymupdf.Document
        Page 1 the graph sheet (when ``graph_page``), then two table sheets,
        then the calculation sheet (when ``calculation_page``).
    """
    spec = spec or TableReportSpec()
    depths = spec.depths or default_depths()
    doc = pymupdf.open()
    if spec.graph_page:
        _graph_page(doc, spec)
    first = [d for d in depths if d <= spec.page_break_after + 1e-9]
    rest = [d for d in depths if d > spec.page_break_after + 1e-9]
    _table_page(doc, spec, first, title=True)
    if rest:
        _table_page(doc, spec, rest, title=False)
    if spec.calculation_page:
        _calculation_page(doc, spec, depths[:10])
    if not spec.graph_page and spec.system_line:
        doc[0].insert_text((52, 815), "Coördinaten in Lambert 72, peil TAW", fontsize=7)
    return doc
