"""The title block read from OCR words gives the same header as the text layer.

Brief 2026-10-05: on the 2.3 CAMZ-001 report (text layer unusable, title
strips OCR'd) every campaign sounding came out with an EMPTY sounding id and
project number, while the 2.4 file (same sheets, readable text layer) reads
"ID SONDERING 1" and "PROJECTNUMMER 23.15-002". Both sources must yield the
same header.

The words below are the OCR boxes of the 2.3 title block on page 171 (the
sheet the 2.4 file prints on page 172), in PDF points as the OCR cache holds
them. OCR boxes of one printed row do not share a centre line: the value
"23.15-002" sits a point higher than its label, "1" a point higher than
"IDSONDERING", and OCR glues a label to its value
("X-COORDINAAT(Lambert72):66980.21").
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_constants import (
    GENERIC_FIELD_LABELS,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import last_number
from groundmodel.infrastructure.parsers.cpt.pdf.sounding_block_reader import SoundingBlockReader

# (x0, y0, x1, y1, text), rounded from the 2.3 OCR cache, page 171.
_OCR_TITLE_BLOCK = [
    (49.2, 740.4, 67.5, 746.4, "PLAATS"),
    (113.1, 740.4, 141.9, 746.1, "ZEEBRUGGE"),
    (205.4, 740.7, 251.3, 746.1, "HOOGTEMAAIVELD"),
    (275.9, 739.5, 290.0, 746.1, "6.02"),
    (297.2, 740.1, 302.3, 746.7, "m1"),
    (49.2, 750.6, 69.6, 756.5, "LOCATIE"),
    (113.4, 750.6, 137.7, 755.9, "CAMZ-001"),
    (49.5, 760.1, 91.2, 765.8, "OPDRACHTGEVER"),
    (113.1, 760.4, 180.8, 766.1, "HAVENBEDRIJFANTWERPEN"),
    (205.1, 760.1, 224.3, 766.4, "DATUM"),
    (275.9, 760.1, 300.5, 766.4, "28-2-2024"),
    (375.2, 758.9, 403.7, 764.9, "SONDERING"),
    (113.4, 768.8, 148.8, 775.4, "23.15-002"),
    (374.9, 766.1, 398.0, 772.1, "VOLGENS"),
    (439.1, 766.4, 441.6, 771.5, "-"),
    (444.2, 766.4, 469.6, 771.5, "NEN-EN-ISO"),
    (472.2, 766.4, 490.0, 771.5, "22476-1"),
    (37.2, 770.9, 41.7, 787.6, "ptesch"),
    (49.5, 770.6, 92.7, 775.7, "PROJECTNUMMER"),
    (204.8, 770.0, 215.6, 776.5, "TJD"),
    (275.6, 770.0, 287.3, 776.5, "8:24"),
    (438.8, 772.7, 499.9, 778.6, "-TOEPASSINGSKLASSE2"),
    (49.2, 780.4, 83.4, 785.8, "IDSONDERING"),
    (113.1, 778.6, 118.5, 785.8, "1"),
    (205.4, 784.3, 303.2, 790.6, "X-COORDINAAT(Lambert72):66980.21"),
    (375.2, 783.7, 472.3, 790.9, "Y-COORDINAAT(Lambert72):224746.0"),
]


def _read(rows: list[tuple[float, float, float, float, str]]) -> dict[str, str]:
    """Read the generic sounding-block fields from word boxes."""
    return SoundingBlockReader().read([PageWord(*r) for r in rows], GENERIC_FIELD_LABELS)


def test_ocr_words_give_the_sounding_number_as_the_text_layer_does() -> None:
    """ID SONDERING 1: the OCR'd block yields sounding id "1", as the 2.4 text layer does."""
    assert _read(_OCR_TITLE_BLOCK).get("sounding_id") == "1"


def test_ocr_words_give_the_project_number_as_the_text_layer_does() -> None:
    """PROJECTNUMMER 23.15-002: the OCR'd block yields the project number."""
    assert _read(_OCR_TITLE_BLOCK).get("project") == "23.15-002"


def test_a_label_glued_to_its_value_by_ocr_still_gives_the_position() -> None:
    """ "X-COORDINAAT(Lambert72):66980.21" is label + value in one OCR word: X and Y are read."""
    fields = _read(_OCR_TITLE_BLOCK)
    assert last_number(fields.get("x")) == 66980.21
    assert last_number(fields.get("y")) == 224746.0


def test_the_fields_the_ocr_block_already_gave_stay_the_same() -> None:
    """Guard: location, ground level and date read as before."""
    fields = _read(_OCR_TITLE_BLOCK)
    assert fields.get("location") == "CAMZ-001"
    assert SoundingBlockReader.number(fields.get("ground_level")) == 6.02
    assert fields.get("date") == "28-2-2024"


def test_a_word_on_the_next_printed_row_is_never_the_value() -> None:
    """Near miss: a label with nothing right of it on its own row reads nothing.

    The row below (10 pt down) holds a value under the label's column; it
    belongs to that row's label, never to this one.
    """
    rows = [
        (49.5, 770.6, 92.7, 775.7, "PROJECTNUMMER"),
        (49.2, 780.4, 83.4, 785.8, "IDSONDERING"),
        (113.1, 780.6, 118.5, 785.8, "7"),
    ]
    fields = _read(rows)
    assert "project" not in fields
    assert fields.get("sounding_id") == "7"


def test_a_label_word_carrying_only_its_colon_reads_the_next_word() -> None:
    """Guard: "Proefnummer:" (colon glued to the label) still reads the word right of it."""
    rows = [
        (50.0, 100.0, 95.0, 106.0, "Proefnummer:"),
        (100.0, 100.0, 120.0, 106.0, "S112"),
    ]
    assert _read(rows).get("sounding_id") == "S112"


def test_ocr_reading_a_zero_for_the_o_of_coordinaat_still_gives_the_position() -> None:
    """2.3 pages 172 / 186 / 215: OCR prints "X-C0ORDINAAT" (zero for O); X is still read."""
    rows = [
        (205.4, 784.3, 303.2, 790.6, "X-C0ORDINAAT(Lambert72):67247.79"),
        (375.2, 783.7, 472.3, 790.9, "Y-COORDINAAT(Lambert72):224704.87"),
    ]
    fields = _read(rows)
    assert last_number(fields.get("x")) == 67247.79
    assert last_number(fields.get("y")) == 224704.87
