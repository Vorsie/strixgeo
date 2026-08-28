"""Security pins: a hostile section / project name must not become reportlab
markup in the emitted PDF report.

The PDF exporter renders the report title and the free-text notes through
reportlab ``Paragraph``, which parses an intra-paragraph mini-markup
(``<b>``, ``<font>``, ``<img>``, ...). The export route defaults the title
to ``"Cross-section: <section_name>"`` (``api/routers/cross_section.py``),
so a section name carried by a crafted ``.strix`` reaches ``Paragraph``
raw. Two concrete harms, both attacker-reachable:

* a stray ``<`` (``"A <b> B"``) makes reportlab raise a parse error — the
  victim's PDF export dies (denial of a valid export);
* an ``<img src="...">`` makes reportlab OPEN a LOCAL FILE named by the
  attacker while rendering — a local-file reference / probe.

These pins phrase the contract in the vulnerability's own terms: markup in
the title or notes must be rendered as literal text, never interpreted —
so the export succeeds and returns a real PDF for either shape.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.section_pdf_report_exporter import (
    ReportMetadata,
    SectionPdfReportExporter,
)

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000201")
SECTION_ID = UUID("00000000-0000-0000-0000-000000000202")
FORMATION_ID = UUID("00000000-0000-0000-0000-000000000203")
INV_A_ID = UUID("00000000-0000-0000-0000-000000000204")

# Markup shapes reportlab's Paragraph interprets. The unclosed tag raises a
# parse error; the img tag makes reportlab open a local file.
UNCLOSED_TAG = "A <b> B"
IMG_TAG = '<img src="strix_injection_probe_does_not_exist.png"/>'


def _snapshot(*, section_name: str = "Section A-A'", project_name: str = "Proj") -> SectionSnapshot:
    return SectionSnapshot(
        project_id=PROJECT_ID,
        project_name=project_name,
        section_id=SECTION_ID,
        section_name=section_name,
        section_length_m=120.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=[
            SectionInvestigationProjection(
                investigation_id=INV_A_ID,
                kind="cpt",
                name="CPT-01",
                along_distance_m=10.0,
                surface_elevation_m=12.4,
                total_depth_m=25.0,
            )
        ],
        formations=[
            SectionFormation(
                formation_id=FORMATION_ID,
                name="Boom Klei",
                code="BK",
                color="#8b5cf6",
                display_order=1,
            )
        ],
        contacts=[
            SectionFormationContact(
                contact_id=UUID("00000000-0000-0000-0000-000000000206"),
                formation_id=FORMATION_ID,
                investigation_id=INV_A_ID,
                along_distance_m=10.0,
                depth_m=8.0,
                level_m=4.4,
            )
        ],
        start_x=150_000.0,
        start_y=200_000.0,
        end_x=150_120.0,
        end_y=200_000.0,
    )


def _export(snapshot: SectionSnapshot, metadata: ReportMetadata) -> bytes:
    return SectionPdfReportExporter().export(snapshot, metadata)


# ---------------------------------------------------------------------------
# Title — the field the route defaults from the attacker-controlled section name
# ---------------------------------------------------------------------------


def test_unclosed_tag_in_title_does_not_break_the_pdf() -> None:
    """A title carrying a stray ``<`` must render as literal text, so the
    export succeeds instead of dying in reportlab's markup parser."""
    pdf = _export(
        _snapshot(),
        ReportMetadata(title=f"Cross-section: {UNCLOSED_TAG}", date=datetime(2026, 8, 3)),
    )
    assert pdf.startswith(b"%PDF")


def test_img_tag_in_title_does_not_reference_a_local_file() -> None:
    """A title carrying ``<img src=...>`` must not make reportlab open a
    local file — it must render as literal text and the export must
    succeed."""
    pdf = _export(
        _snapshot(),
        ReportMetadata(title=f"Cross-section: {IMG_TAG}", date=datetime(2026, 8, 3)),
    )
    assert pdf.startswith(b"%PDF")


def test_hostile_section_name_flows_through_the_default_title() -> None:
    """Mirror the real chain: the route defaults the title to
    ``"Cross-section: <section_name>"``, so a hostile section name from a
    crafted ``.strix`` must not break the export."""
    section_name = UNCLOSED_TAG
    pdf = _export(
        _snapshot(section_name=section_name),
        ReportMetadata(title=f"Cross-section: {section_name}", date=datetime(2026, 8, 3)),
    )
    assert pdf.startswith(b"%PDF")


# ---------------------------------------------------------------------------
# Notes — the free-text field rendered through Paragraph
# ---------------------------------------------------------------------------


def test_markup_in_notes_does_not_break_the_pdf() -> None:
    """Free-text notes carrying markup must render as literal text."""
    pdf = _export(
        _snapshot(),
        ReportMetadata(
            title="Cross-section: A-A'",
            notes=f"see attached {IMG_TAG} and {UNCLOSED_TAG}",
            date=datetime(2026, 8, 3),
        ),
    )
    assert pdf.startswith(b"%PDF")


# ---------------------------------------------------------------------------
# Guard: an ordinary title / notes still renders (no over-escaping regression)
# ---------------------------------------------------------------------------


def test_ordinary_title_and_notes_still_render() -> None:
    """An ordinary title / notes with no markup renders a real PDF."""
    pdf = _export(
        _snapshot(),
        ReportMetadata(
            title="Cross-section: A-A'",
            notes="Ordinary engineer notes, nothing special.",
            date=datetime(2026, 8, 3),
        ),
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 1000
