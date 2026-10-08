"""Build small synthetic borehole-log PDFs with PyMuPDF for the digitiser tests.

Two layouts, both drawn the way the real sheets draw them (owner material,
2026-10-08), with every name invented:

* the boorstaat layout: depth axis in cm below ground on the left, a sample
  column, the level column (cm TAW, one number per boundary, printed just
  above the boundary's rule), the description column under each rule, the
  surface cover printed above the first rule; header with Lambert72 XY and the
  ground level in mTAW; one borehole over several sheets, a continuation
  sheet reprinting the layer the previous sheet cut;
* the boorprofiel layout: elevation axis in m TAW, levels in m TAW with two
  decimals, header "X:" / "Y:" with no coordinate system named.

Every value on the page is known, so a test compares what the digitiser reads
against the truth, not against a second reading.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pymupdf

PAGE_W = 595.0
PAGE_H = 842.0

# Boorstaat geometry (PDF points). One centimetre of depth = PT_PER_CM.
GRAPH_TOP = 240.0
PT_PER_CM = 1.0
AXIS_X1 = 84.0
SAMPLE_BAR_X0 = 131.0
SAMPLE_BAR_X1 = 135.0
LABEL_X = 220.0
RULE_X0 = 234.0
RULE_X1 = 404.0
TEXT_X = 245.0
LINE_STEP = 9.6
FONT = 7.0


@dataclass
class Layer:
    """One printed row: its top level label and its description lines.

    Parameters
    ----------
    label : str
        The level label printed above the row's top rule (cm TAW, or any text
        for a malformed-cell test).
    lines : list of str
        The description, one printed line per item.
    """

    label: str
    lines: list[str]


@dataclass
class Sheet:
    """One boorstaat sheet.

    Parameters
    ----------
    top_depth_cm : float
        Depth (cm below ground) at the top of the graph.
    layers : list of Layer
        The rows top to bottom.
    layer_depths_cm : list of float
        Depth of each row's top rule (same order as ``layers``).
    end_label : str
        The level label of the closing rule (sheet cut or end of boring).
    end_depth_cm : float
        Depth of the closing rule.
    surface_text : str
        Printed above the first rule (first sheet only).
    samples : list of tuple
        ``(label, top_cm, base_cm, filled)``.
    extra_words : list of tuple
        ``(x, depth_cm, text)``: more words to print (baseline at the depth).
    tight_sample_ids : bool
        Print each sample id as separate words a hair apart ("1", "-",
        "0550471478"), the way the real sheets extract.
    """

    top_depth_cm: float
    layers: list[Layer]
    layer_depths_cm: list[float]
    end_label: str
    end_depth_cm: float
    surface_text: str = ""
    samples: list[tuple[str, float, float, bool]] = field(default_factory=list)
    extra_words: list[tuple[float, float, str]] = field(default_factory=list)
    tight_sample_ids: bool = False


def _y(sheet: Sheet, depth_cm: float) -> float:
    """Return the page y of a depth on a sheet."""
    return GRAPH_TOP + (depth_cm - sheet.top_depth_cm) * PT_PER_CM


# Horizontal offsets each text run is printed at: (0.0,) normally; three
# offsets a hair apart = bold by overprinting (the 21.04 report's header).
_PRINT_OFFSETS: list[float] = [0.0]


def _text(page: pymupdf.Page, x: float, y: float, text: str, size: float = FONT) -> None:
    """Write one text run with its baseline at ``(x, y)`` (once per print offset)."""
    for dx in _PRINT_OFFSETS:
        page.insert_text((x + dx, y), text, fontsize=size, fontname="helv")


def build_overprinted_boorstaat_pdf() -> pymupdf.Document:
    """Return B-T1's two sheets with every text run printed three times, 0.15 pt apart.

    Returns
    -------
    pymupdf.Document
        The report, in memory.
    """
    _PRINT_OFFSETS[:] = [0.0, 0.15, 0.3]
    try:
        return build_boorstaat_pdf(with_legend=False)
    finally:
        _PRINT_OFFSETS[:] = [0.0]


def _boorstaat_header(page: pymupdf.Page, name: str) -> None:
    """Write the boorstaat header and footer fields."""
    _text(page, 340.0, 96.0, "Identificatie volgens NEN-EN-ISO 14688", 8.0)
    _text(page, 60.0, 108.0, f"Boring: {name}", 9.0)
    _text(page, 60.0, 124.0, "x-coordinaat [m Lambert72]: 68000,50", 8.0)
    _text(page, 60.0, 136.0, "y-coordinaat [m Lambert72]: 224000,25", 8.0)
    _text(page, 60.0, 148.0, "Maaiveldhoogte in mTAW: 6.5", 8.0)
    _text(page, 60.0, 160.0, "Grondwaterstand [cm-mv]: 200", 8.0)
    _text(page, 60.0, 762.0, "Projectcode: 00.00-000 TEST-001", 8.0)
    _text(page, 60.0, 776.0, "Projectnaam: Testproject", 8.0)
    _text(page, 60.0, 790.0, "Uitgevoerd op: 9-1-2024", 8.0)
    _text(page, 60.0, 804.0, "Uitvoering door: Ploeg A", 8.0)


def draw_boorstaat_sheet(doc: pymupdf.Document, sheet: Sheet, name: str = "B-T1") -> None:
    """Append one boorstaat sheet to ``doc``.

    Parameters
    ----------
    doc : pymupdf.Document
        Target document.
    sheet : Sheet
        What to draw.
    name : str
        The borehole name printed after "Boring:".
    """
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _boorstaat_header(page, name)
    shape = page.new_shape()
    # Depth axis: a tick and a right-aligned label every 100 cm.
    first = int(-(-sheet.top_depth_cm // 100) * 100)
    for value in range(first, int(sheet.end_depth_cm) + 1, 100):
        y = _y(sheet, value)
        label = str(value)
        width = pymupdf.get_text_length(label, fontsize=6.0)
        _text(page, AXIS_X1 - width, y + 2.0, label, 6.0)
        shape.draw_line((AXIS_X1 + 2.0, y), (AXIS_X1 + 6.0, y))
    # The lithology column frame (drawn, never read).
    shape.draw_rect(pymupdf.Rect(100.0, GRAPH_TOP, 128.0, _y(sheet, sheet.end_depth_cm)))
    # Rules and level labels: the label sits just above its rule's left end.
    tops = [*sheet.layer_depths_cm, sheet.end_depth_cm]
    labels = [layer.label for layer in sheet.layers] + [sheet.end_label]
    for depth, label in zip(tops, labels, strict=True):
        y = _y(sheet, depth)
        shape.draw_line((LABEL_X, y), (RULE_X0, y))
        shape.draw_line((RULE_X0, y), (RULE_X1, y))
        _text(page, LABEL_X, y - 1.5, label, 6.0)
    shape.finish(color=(0, 0, 0), width=0.5)
    for depth, layer in zip(sheet.layer_depths_cm, sheet.layers, strict=True):
        y = _y(sheet, depth)
        for i, line in enumerate(layer.lines):
            _text(page, TEXT_X, y + 8.5 + i * LINE_STEP, line)
    if sheet.surface_text:
        _text(page, TEXT_X, _y(sheet, sheet.layer_depths_cm[0]) - 1.5, sheet.surface_text)
    # Sample bars: open = disturbed, filled = undisturbed (the printed legend).
    for label, top, base, filled in sheet.samples:
        rect = pymupdf.Rect(SAMPLE_BAR_X0, _y(sheet, top), SAMPLE_BAR_X1, _y(sheet, base))
        shape.draw_rect(rect)
        shape.finish(color=(0, 0, 0), fill=(0, 0, 0) if filled else (1, 1, 1), width=0.4)
        y_label = (rect.y0 + rect.y1) / 2.0 + 2.0
        if sheet.tight_sample_ids:
            x = SAMPLE_BAR_X1 + 1.5
            for part in label.replace("-", " - ").split():
                # A trailing space glyph overlapped by the next part: words split
                # on it although the boxes are 0.3 pt apart (as extracted).
                _text(page, x, y_label, part + " ", 6.0)
                x += pymupdf.get_text_length(part, fontsize=6.0) + 0.3
        else:
            _text(page, SAMPLE_BAR_X1 + 1.5, y_label, label, 6.0)
    for x, depth, text in sheet.extra_words:
        _text(page, x, _y(sheet, depth), text)
    shape.commit()


SAND_LINES = ["Zand zeer fijn, zwak siltig, standaard grijsgroen,", "Sonic Drill."]
SAND_TEXT = " ".join(SAND_LINES)


def boorstaat_sheets(malformed_label: str | None = None) -> list[Sheet]:
    """Return the two sheets of the synthetic borehole B-T1 (ground 650 cm TAW).

    Truth (depth below ground, m): 0.00-0.10 asphalt, 0.10-0.50 rubble,
    0.50-1.50 sand, 1.50-2.50 clay, 2.50-4.50 sand (cut by sheet 1 at 4.14,
    reprinted on sheet 2 from 3.14), 4.50-5.00 tube sample, 5.00-7.28 clay.

    Parameters
    ----------
    malformed_label : str or None
        Replaces sheet 2's "150" label (the boundary at 5.00 m) when given.

    Returns
    -------
    list of Sheet
        Sheet 1 and sheet 2.
    """
    sheet1 = Sheet(
        top_depth_cm=0.0,
        layers=[
            Layer("650", ["Asfalt, Asfaltboor"]),
            Layer("640", ["Volledig puingranulaat, standaard oranjegrijs,", "Sonic Drill"]),
            Layer("600", ["Zand matig fijn, zwak siltig, donker bruingrijs,", "Sonic Drill"]),
            Layer("500", ["Klei, matig zandig, standaard groengrijs, Sonic", "Drill"]),
            Layer("400", list(SAND_LINES)),
        ],
        layer_depths_cm=[0.0, 10.0, 50.0, 150.0, 250.0],
        end_label="236",
        end_depth_cm=414.0,
        surface_text="asfalt",
        samples=[("1-0000000002", 350.0, 414.0, False)],
    )
    sheet2 = Sheet(
        top_depth_cm=314.0,
        layers=[
            Layer("336", list(SAND_LINES)),
            Layer("200", ["Sonic Drill, Steekbus"]),
            Layer(
                malformed_label or "150",
                ["Klei, matig siltig, resten veen, standaard", "bruingrijs, Sonic Drill"],
            ),
        ],
        layer_depths_cm=[314.0, 450.0, 500.0],
        end_label="-78",
        end_depth_cm=728.0,
        samples=[("S1-0000000001", 450.0, 500.0, True)],
    )
    return [sheet1, sheet2]


def add_legend_page(doc: pymupdf.Document) -> None:
    """Append the boorstaat legend page (no borehole on it)."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _text(page, 57.0, 38.0, "Legenda (conform NEN-EN-ISO 14688-1)", 9.0)
    _text(page, 57.0, 74.0, "ZAND", 8.0)
    _text(page, 107.0, 90.0, "ZAND, zwak grindig", 6.0)
    _text(page, 432.0, 357.0, "geroerd monster", 6.0)
    _text(page, 432.0, 386.0, "ongeroerd monster", 6.0)


def add_outlined_page(doc: pymupdf.Document) -> None:
    """Append a page with drawings but no text layer (text converted to outlines)."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    shape = page.new_shape()
    for i in range(40):
        y = 120.0 + i * 15.0
        shape.draw_line((60.0, y), (520.0, y))
        shape.draw_bezier((80.0, y + 2), (85.0, y + 9), (90.0, y - 3), (95.0, y + 5))
    shape.finish(color=(0, 0, 0), width=0.5)
    shape.commit()


def add_prose_page(doc: pymupdf.Document) -> None:
    """Append a report text page (no borehole)."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    for i in range(30):
        _text(
            page,
            60.0,
            80.0 + i * 14.0,
            "Het grondonderzoek werd uitgevoerd volgens de opdracht van de klant.",
            9.0,
        )


def build_boorstaat_pdf(
    malformed_label: str | None = None, with_legend: bool = True, extra_pages: bool = False
) -> pymupdf.Document:
    """Return the two-sheet boorstaat report (plus legend / other pages).

    Parameters
    ----------
    malformed_label : str or None
        See :func:`boorstaat_sheets`.
    with_legend : bool
        Append the legend page.
    extra_pages : bool
        Prepend a prose page and append an outlined (no text) page.

    Returns
    -------
    pymupdf.Document
        The report, in memory.
    """
    doc = pymupdf.open()
    if extra_pages:
        add_prose_page(doc)
    for sheet in boorstaat_sheets(malformed_label):
        draw_boorstaat_sheet(doc, sheet)
    if with_legend:
        add_legend_page(doc)
    if extra_pages:
        add_outlined_page(doc)
    return doc


# Boorprofiel layout: elevation axis + levels in m TAW (two decimals).
BP_TOP_LEVEL = 6.61
BP_PT_PER_M = 20.0
BP_GRAPH_TOP = 150.0
BP_LABEL_X = 267.5
BP_RULE_X0 = 281.4
BP_RULE_X1 = 522.5
BP_TEXT_X = 284.8


def _bp_y(level_m: float) -> float:
    """Return the page y of an elevation on the boorprofiel sheet."""
    return BP_GRAPH_TOP + (BP_TOP_LEVEL - level_m) * BP_PT_PER_M


def build_boorprofiel_pdf() -> pymupdf.Document:
    """Return a one-sheet boorprofiel report (B-T2, top level 6.61 m TAW).

    Truth (depth below the top level, m): 0.00-2.50 sand with rubble,
    2.50-5.00 sand, 5.00-5.50 peat, 5.50-29.10 sand with shells.

    Returns
    -------
    pymupdf.Document
        The report, in memory.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    _text(page, 48.0, 60.0, "Boring:", 11.0)
    _text(page, 110.0, 60.0, "B-T2", 11.0)
    _text(page, 48.0, 71.0, "Datum:", 6.0)
    _text(page, 110.0, 71.0, "19-12-2024", 6.0)
    _text(page, 48.0, 79.0, "X:", 6.0)
    _text(page, 110.0, 79.0, "67800,00", 6.0)
    _text(page, 48.0, 86.0, "Y:", 6.0)
    _text(page, 110.0, 86.0, "224500,00", 6.0)
    _text(page, 48.0, 101.0, "Opmerking:", 6.0)
    _text(page, 110.0, 101.0, "Zuigboren", 6.0)
    _text(page, 140.0, 780.0, "Projectnaam:", 8.0)
    _text(page, 205.0, 780.0, "Testproject", 8.0)
    _text(page, 140.0, 822.0, "Projectcode:", 8.0)
    _text(page, 205.0, 822.0, "TP0001", 8.0)
    _text(page, 400.0, 822.0, "Bijlage:", 8.0)
    _text(page, 480.0, 822.0, "Pagina:", 8.0)
    _text(page, 515.0, 822.0, "1 / 1", 8.0)
    shape = page.new_shape()
    for level in range(6, -23, -1):
        y = _bp_y(float(level))
        _text(page, 176.0, y + 2.0, f"{level:.2f}", 6.0)
        shape.draw_line((200.0, y), (204.0, y))
    rows = [
        (6.61, ["Zand zeer fijn, volledig puin, donkerbruin"]),
        (4.11, ["Zand zeer fijn, lichtgrijs"]),
        (1.61, ["Veen, zwak zandig, donkerbruin"]),
        (1.11, ["Zand zeer fijn, matig schelphoudend, lichtgrijs"]),
    ]
    levels = [r[0] for r in rows] + [-22.49]
    for level in levels:
        y = _bp_y(level)
        shape.draw_line((BP_RULE_X0, y), (BP_RULE_X1, y))
        _text(page, BP_LABEL_X, y - 1.0, f"{level:.2f}", 5.0)
    shape.finish(color=(0, 0, 0), width=0.5)
    shape.commit()
    for level, lines in rows:
        for i, line in enumerate(lines):
            _text(page, BP_TEXT_X, _bp_y(level) + 6.5 + i * 7.0, line, 5.5)
    _text(page, BP_TEXT_X, _bp_y(6.61) - 1.0, "akker", 5.5)
    return doc


CLAY_LINES = ["Klei, matig zandig, standaard groengrijs, Sonic", "Drill"]
DEEP_CLAY_LINES = ["Klei, matig siltig, resten veen, standaard", "bruingrijs, Sonic Drill"]


def build_findings_pdf() -> pymupdf.Document:
    """Return B-T1 drawn the way the real reports showed it on 2026-10-08.

    * sheet 2 starts 1.74 m above sheet 1's cut (2.40 m): it reprints the end
      of the clay row AND the cut sand row, as the boorstaat repeats ~1 m;
    * sheet 3 prints ONE depth-axis label (7.00 m) and a sample bar
      6.90-7.20 m: two labels define a line, one does not;
    * sheet 1 prints a sample code "TR1" left-aligned in the level column
      (the boorprofiel does), a description word past the rule's right end,
      and its sample ids as tight separate words;
    * after the legend, sheet 2 is printed again (an overview reprint).

    Truth: the seven intervals of :func:`boorstaat_sheets` (0..7.28 m).

    Returns
    -------
    pymupdf.Document
        The report, in memory.
    """
    sheet1, _ = boorstaat_sheets()
    sheet1.layers[1] = Layer(
        "640", ["Volledig puingranulaat, standaard oranjegrijs,", "Sonic Drill"]
    )
    sheet1.extra_words = [
        (LABEL_X, 300.0, "TR1"),
        (RULE_X1 + 2.0, 10.0 + 8.5 + LINE_STEP, "voorgeboord"),
    ]
    sheet1.tight_sample_ids = True
    sheet2 = Sheet(
        top_depth_cm=240.0,
        layers=[
            Layer("410", [" ".join(CLAY_LINES)]),
            Layer("400", list(SAND_LINES)),
            Layer("200", ["Sonic Drill, Steekbus"]),
            Layer("150", list(DEEP_CLAY_LINES)),
        ],
        layer_depths_cm=[240.0, 250.0, 450.0, 500.0],
        end_label="-30",
        end_depth_cm=680.0,
        samples=[("S1-0000000001", 450.0, 500.0, True)],
    )
    sheet3 = Sheet(
        top_depth_cm=650.0,
        layers=[Layer("0", list(DEEP_CLAY_LINES))],
        layer_depths_cm=[650.0],
        end_label="-78",
        end_depth_cm=728.0,
        samples=[("2-0000000003", 690.0, 720.0, False)],
    )
    doc = pymupdf.open()
    for sheet in (sheet1, sheet2, sheet3):
        draw_boorstaat_sheet(doc, sheet)
    add_legend_page(doc)
    draw_boorstaat_sheet(doc, sheet2)
    return doc
