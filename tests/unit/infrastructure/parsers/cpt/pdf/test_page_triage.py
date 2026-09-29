"""Page triage: "there's a lot of clutter, so we need to trim those reports".

Owner addition: "there are also cpt graphs in those reports that aren't actually
part of the campaign but rather the desk study on beforehand" -> every CPT page
is campaign / desk-study / unknown, and trim() keeps the campaign's own
soundings by default, everything on request.
"""

from __future__ import annotations

import pymupdf
import pytest

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass
from groundmodel.infrastructure.parsers.cpt.pdf.page_triage import PageTriage
from groundmodel.infrastructure.parsers.cpt.pdf.report_triage import ReportTriage

from . import _synthetic_cpt_pdf as synth

RUNNING_HEADER = "DOCUMENTNAAM : Proefverslag TEST-001"


@pytest.fixture(scope="module")
def report() -> ReportTriage:
    """A six-page report: prose, photo, table, own sounding, DOV reprint, other project."""
    doc = pymupdf.open()
    synth.add_text_page(doc)  # 1 prose
    synth.add_photo_page(doc)  # 2 photo
    synth.add_table_page(doc)  # 3 table
    synth.draw_cpt_page(doc)  # 4 campaign sounding S1 at TEST-001
    synth.draw_cpt_page(  # 5 reprinted DOV sounding (desk study)
        doc,
        synth.SyntheticPageSpec(
            sounding_id="",
            location="Brugge",
            project="GEO-22/040",
            company="DATABANK ONDERGROND VLAANDEREN",
            extra_lines=["Proefnummer: GEO-22/040-S2"],
        ),
    )
    synth.draw_cpt_page(  # 6 same contractor, another project (desk study)
        doc,
        synth.SyntheticPageSpec(
            sounding_id="164", location="BOERINNESTRAAT 2", project="23.07-006"
        ),
    )
    for page in doc:
        page.insert_text((300, 20), RUNNING_HEADER, fontsize=6)
    return PageTriage().classify(doc)


def test_prose_photo_and_table_pages_are_not_cpt_graphs(report: ReportTriage) -> None:
    """Prose photo and table pages are not cpt graphs."""
    classes = [p.page_class for p in report.pages[:3]]
    assert classes == [PageClass.TEXT, PageClass.PHOTO, PageClass.TABLE]


def test_the_three_graph_pages_are_cpt_graphs_drawn_as_vectors(report: ReportTriage) -> None:
    """The three graph pages are cpt graphs drawn as vectors."""
    for page in report.pages[3:]:
        assert page.page_class is PageClass.CPT_GRAPH, page.reasons
        assert page.graph_kind is GraphKind.VECTOR


def test_report_fingerprint_names_the_campaign(report: ReportTriage) -> None:
    """Report fingerprint names the campaign."""
    assert "TEST-001" in report.fingerprint.campaign_codes


def test_own_sounding_is_campaign_reprints_are_desk_study(report: ReportTriage) -> None:
    """Own sounding is campaign reprints are desk study."""
    origins = [p.origin for p in report.pages[3:]]
    assert origins == [CptOrigin.CAMPAIGN, CptOrigin.DESK_STUDY, CptOrigin.DESK_STUDY]


def test_a_dov_reprint_carries_its_dov_id_so_it_can_be_imported_from_dov(
    report: ReportTriage,
) -> None:
    """A dov reprint carries its dov id so it can be imported from dov."""
    assert report.pages[4].dov_id == "GEO-22/040-S2"


def test_trim_keeps_campaign_pages_by_default_and_all_graphs_on_request(
    report: ReportTriage,
) -> None:
    """Trim keeps campaign pages by default and all graphs on request."""
    assert PageTriage.trim(report) == [4]
    assert PageTriage.trim(report, include_desk_study=True) == [4, 5, 6]


def test_every_page_carries_its_evidence(report: ReportTriage) -> None:
    """Every page carries its evidence."""
    graph = report.pages[3]
    assert graph.cpt_score > 0
    assert graph.tick_runs >= 3
    assert any("campaign" in r for r in graph.reasons)
