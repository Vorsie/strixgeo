"""What the owner's real boorstaat reports showed on 2026-10-08, pinned on a synthetic twin.

* "a continuation sheet reprints about one metre of the sheet before":
  every reprinted row is read once, the cut row is joined into one interval;
* "the last sheet of a borehole may print a single depth-axis label": its
  samples are placed with that label and the scale of the sheet before
  (every sheet of a borehole is drawn at one scale), and the parse says so;
* "a sample code printed in the level column is not a level";
* "a description runs past the right end of its rule": the words are kept;
* "a sample id printed tight but extracted as three words" reads as printed;
* "a borehole printed again (an overview reprint)" with exactly the same
  data is dropped with a notice, never listed as a second borehole silently
  (owner 2026-10-08; the differing case is in test_owner_rulings_2026_10_08).
"""

from __future__ import annotations

import pymupdf
import pytest

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_digitiser import (
    BoreholePdfDigitiser,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
    BoreholePdfTriager,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

from . import _synthetic_borehole_pdf as synth

IDENTITY = PdfReportIdentity(file_name="findings.pdf", file_sha="2" * 64, ocr_available=False)


@pytest.fixture(scope="module")
def parsed():
    """The triage and the parse of the findings report."""
    result = BoreholePdfTriager(ocr=None).triage(synth.build_findings_pdf(), file_name="f.pdf")
    return result, BoreholePdfDigitiser().digitise(result, IDENTITY)


def test_every_reprinted_row_is_read_once(parsed) -> None:
    """Sheet 2 reprints the clay end and the cut sand: still the seven intervals, no gap."""
    _, (borehole,) = parsed
    assert [(i.depth_top_m, i.depth_base_m) for i in borehole.intervals] == pytest.approx(
        [(0.0, 0.1), (0.1, 0.5), (0.5, 1.5), (1.5, 2.5), (2.5, 4.5), (4.5, 5.0), (5.0, 7.28)]
    )
    assert sum(1 for i in borehole.intervals if i.description.startswith("Klei, matig zandig")) == 1
    assert not [i for i in borehole.issues if i.level == ValidationLevel.ERROR]


def test_a_single_axis_label_places_the_sample_with_the_previous_scale(parsed) -> None:
    """Sheet 3 prints only "700": the sample bar 6.90-7.20 m, slope taken from sheet 2."""
    result, (borehole,) = parsed
    sample = next(s for s in borehole.samples if s.sample_id == "2-0000000003")
    assert (sample.depth_top_m, sample.depth_base_m) == pytest.approx((6.9, 7.2), abs=0.01)
    assert result.sheets[3].axis.slope_from_page == 2
    assert borehole.provenance["sheets"][2]["axis"]["slope_from_page"] == 2


def test_a_sample_code_in_the_level_column_is_not_a_level(parsed) -> None:
    """ "TR1" left-aligned with the levels on sheet 1 is not read as one."""
    result, _ = parsed
    assert [label.text for label in result.sheets[1].labels] == [
        "650",
        "640",
        "600",
        "500",
        "400",
        "236",
    ]


def test_words_past_the_rule_end_stay_in_the_description(parsed) -> None:
    """ "voorgeboord" starts right of the rule's end and still belongs to the row."""
    _, (borehole,) = parsed
    assert borehole.intervals[1].description == (
        "Volledig puingranulaat, standaard oranjegrijs, Sonic Drill voorgeboord"
    )


def test_a_tight_sample_id_reads_as_printed(parsed) -> None:
    """ "1", "-", "0000000002" a hair apart read back as "1-0000000002"."""
    _, (borehole,) = parsed
    assert "1-0000000002" in [s.sample_id for s in borehole.samples]


def test_a_borehole_printed_again_identically_is_dropped_with_a_notice(parsed) -> None:
    """Sheet 2 printed again after the legend, the same data: one borehole, the reprint in
    the digest's dropped list, a notice on the kept print."""
    result, (borehole,) = parsed
    (first,) = result.digest.boreholes
    assert first.pages == (1, 2, 3)
    assert [(d.key, d.kept_key) for d in result.digest.dropped] == [("B-T1@p5", first.key)]
    assert "REPEAT_DROPPED" in [i.code for i in borehole.issues]


def test_two_stray_numbers_left_of_a_full_axis_are_not_the_axis() -> None:
    """Standpipe notes "klei 117 zak" / "5.3 zak" left of the axis: the full axis is used."""
    sheet1, sheet2 = synth.boorstaat_sheets()
    sheet1.extra_words = [(20.0, 120.0, "117"), (20.0, 330.0, "5.3")]
    doc = pymupdf.open()
    synth.draw_boorstaat_sheet(doc, sheet1)
    synth.draw_boorstaat_sheet(doc, sheet2)
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="notes.pdf")
    axis = result.sheets[1].axis
    assert axis is not None
    assert axis.label_count == 5
    assert axis.slope == pytest.approx(synth.PT_PER_CM, abs=1e-3)


def test_a_yellow_lithology_patch_beside_a_number_is_not_a_sample_bar() -> None:
    """Only white (open) and black (filled) bars are sample marks; a yellow fill is lithology."""
    sheet1, sheet2 = synth.boorstaat_sheets()
    doc = pymupdf.open()
    synth.draw_boorstaat_sheet(doc, sheet1)
    synth.draw_boorstaat_sheet(doc, sheet2)
    page = doc[0]
    shape = page.new_shape()
    shape.draw_rect(pymupdf.Rect(110.0, 300.0, 114.0, 320.0))
    shape.finish(color=None, fill=(1.0, 1.0, 0.0))
    shape.commit()
    page.insert_text((115.5, 312.0), "7", fontsize=6.0)
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="yellow.pdf")
    assert [m.sample_id for m in result.sheets[1].samples] == ["1-0000000002"]


def test_a_short_bar_of_an_overview_print_is_still_a_sample() -> None:
    """The 24.13-002 overview of B-PB10-F3 draws sample 72- (0.18 m) as a bar 1.44 pt high:
    still a sample bar with its id, so the overview reads the same samples as the full print."""
    sheet1, sheet2 = synth.boorstaat_sheets()
    sheet1.samples = [*sheet1.samples, ("72-", 300.0, 301.44, False)]
    doc = pymupdf.open()
    synth.draw_boorstaat_sheet(doc, sheet1)
    synth.draw_boorstaat_sheet(doc, sheet2)
    result = BoreholePdfTriager(ocr=None).triage(doc, file_name="short.pdf")
    assert "72-" in [m.sample_id for m in result.sheets[1].samples]
