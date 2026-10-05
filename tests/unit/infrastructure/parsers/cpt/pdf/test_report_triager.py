"""The report triage the import dialog shows (owner answers 2026-09-30).

* "desk-study reprints (DOV sheets and other-project sheets) are THROWN AWAY:
  not digitised, not offered for import; the triage screen lists their ids
  once ("Not imported, look these up yourself: GEO-22/040-S2, ...")".
* "a sheet printed twice is dropped with a notice".
* The campaign soundings come with id, pages, ground level, XY when read,
  sheet count and warnings.
"""

from __future__ import annotations

import json

import pymupdf
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_digest import PdfReportDigest
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

from . import _synthetic_cpt_pdf as synth

RUNNING_HEADER = "DOCUMENTNAAM : Proefverslag TEST-001"


def _report() -> pymupdf.Document:
    """Prose, S1 (placed), a DOV reprint, another project's sheet, S1 again, S7 (unplaced)."""
    doc = pymupdf.open()
    synth.add_text_page(doc)  # 1
    placed = synth.SyntheticPageSpec(
        sounding_id="S1", x=150000.0, y=200000.0, test_date="28-2-2024", ground_level=4.5
    )
    synth.draw_cpt_page(doc, placed)  # 2 campaign S1
    synth.draw_cpt_page(  # 3 DOV reprint
        doc,
        synth.SyntheticPageSpec(
            sounding_id="",
            location="Brugge",
            project="GEO-22/040",
            company="DATABANK ONDERGROND VLAANDEREN",
            extra_lines=["Proefnummer: GEO-22/040-S2"],
        ),
    )
    synth.draw_cpt_page(  # 4 same contractor, another project
        doc,
        synth.SyntheticPageSpec(
            sounding_id="164", location="BOERINNESTRAAT 2", project="23.07-006"
        ),
    )
    synth.draw_cpt_page(doc, placed)  # 5 S1 printed a second time
    synth.draw_cpt_page(doc, synth.SyntheticPageSpec(sounding_id="S7"))  # 6 campaign S7
    for page in doc:
        page.insert_text((300, 20), RUNNING_HEADER, fontsize=6)
    return doc


@pytest.fixture(scope="module")
def triaged() -> tuple[PdfReportDigest, dict[str, object], list[tuple[str, int, int]]]:
    """The digest, the digitised soundings by key, and the progress ticks."""
    ticks: list[tuple[str, int, int]] = []
    digest, soundings = PdfReportTriager(ocr=False).run(
        _report(),
        file_sha="abc",
        progress=lambda phase, done, total, ocr=False: ticks.append((phase, done, total)),
    )
    return digest, soundings, ticks


def test_the_campaign_soundings_are_offered_for_import(triaged) -> None:  # type: ignore[no-untyped-def]
    """The campaign's own soundings are listed, each once, in page order."""
    digest, soundings, _ = triaged
    assert [s.sounding_id for s in digest.campaign] == ["S1", "S7"]
    assert set(soundings) == {"S1", "S7"}


def test_a_campaign_sounding_carries_its_sheet_header(triaged) -> None:  # type: ignore[no-untyped-def]
    """S1: page 2, one sheet, ground level 4.5 m TAW, Lambert72 XY, the printed date."""
    s1 = triaged[0].campaign[0]
    assert s1.page_numbers == (2,)
    assert s1.sheet_count == 1
    assert s1.ground_level_m == pytest.approx(4.5)
    assert (s1.x, s1.y, s1.epsg) == (pytest.approx(150000.0), pytest.approx(200000.0), 31370)
    assert s1.test_date == "28-2-2024"
    assert set(s1.curves) == {"qc", "fs"}


def test_a_sounding_without_a_printed_position_says_so(triaged) -> None:  # type: ignore[no-untyped-def]
    """S7 prints no coordinates: not placed, and a warning asks for XY."""
    s7 = triaged[0].campaign[1]
    assert s7.x is None and s7.epsg is None
    assert any("position" in w for w in s7.warnings)


def test_desk_study_reprints_are_listed_once_and_not_digitised(triaged) -> None:  # type: ignore[no-untyped-def]
    """The DOV reprint and the other project's sheet: named once, not offered, not digitised."""
    digest, soundings, _ = triaged
    assert digest.desk_study_ids == ("GEO-22/040-S2", "164")
    assert "164" not in soundings
    assert not any(s.sounding_id == "164" for s in digest.campaign + digest.unknown)


def test_a_sheet_printed_twice_is_dropped_with_a_notice(triaged) -> None:  # type: ignore[no-untyped-def]
    """Page 5 repeats S1: dropped, and the notice names the sounding and both pages."""
    duplicates = [d for d in triaged[0].dropped if d.reason == "duplicate"]
    assert [(d.sounding_id, d.page_numbers) for d in duplicates] == [("S1", (5,))]
    assert "2" in duplicates[0].note


def test_progress_is_reported_per_page_and_per_digitised_sheet(triaged) -> None:  # type: ignore[no-untyped-def]
    """The dialog gets a tick per classified page and per digitised sheet."""
    ticks = triaged[2]
    assert ("classify", 6, 6) in ticks
    assert ("digitise", 3, 3) in ticks


def test_the_digest_is_plain_json_for_the_ui(triaged) -> None:  # type: ignore[no-untyped-def]
    """The digest serialises to JSON (the job's done event carries it)."""
    data = json.loads(json.dumps(triaged[0].to_dict()))
    assert data["file_sha"] == "abc"
    assert data["campaign"][0]["sounding_id"] == "S1"
    assert data["desk_study_ids"] == ["GEO-22/040-S2", "164"]
    assert data["ocr_available"] is False
