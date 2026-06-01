"""Integration tests for SectionPdfReportExporter — debt #116.

The exporter is a pure in-process function (no DB, no I/O beyond matplotlib
rendering to a BytesIO buffer), so these are technically unit-shaped; they
live under tests/integration/exporters/ because they exercise the full
ReportLab + matplotlib render pipeline against realistic SectionSnapshot
fixtures.  They do NOT rely on the integration DB fixture.

Six cases:

PE1. Happy path — a fully-populated SectionSnapshot produces PDF bytes that
     start with the ``%PDF`` magic header and are non-empty.

PE2. Metadata round-trip — title, author, section name, project name, and
     date are all reflected somewhere in the PDF text stream.

PE3. Multi-investigation section — snapshot with 5 investigations spread
     across the section line renders without error.

PE4. Empty section — no investigations, no contacts, no formations → exporter
     handles gracefully, produces valid PDF bytes.

PE5. Notes field — non-empty ReportMetadata.notes block is accepted; the
     export still completes and produces valid PDF bytes.

PE6. Section with no model contacts — investigations present but no formation
     picks → exporter handles (no polylines drawn), still produces valid PDF.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from uuid6 import uuid7

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

# ---------------------------------------------------------------------------
# Private fixture builders
# ---------------------------------------------------------------------------


def _project_id() -> UUID:
    return uuid7()


def _section_id() -> UUID:
    return uuid7()


def _formation_id() -> UUID:
    return uuid7()


def _investigation_id() -> UUID:
    return uuid7()


def _contact_id() -> UUID:
    return uuid7()


def _minimal_snapshot(
    *,
    project_id: UUID | None = None,
    section_id: UUID | None = None,
    project_name: str = "Test Project",
    section_name: str = "Section 1",
    section_length_m: float = 100.0,
    investigations: list[SectionInvestigationProjection] | None = None,
    formations: list[SectionFormation] | None = None,
    contacts: list[SectionFormationContact] | None = None,
    start_x: float = 150_000.0,
    start_y: float = 200_000.0,
    end_x: float = 150_100.0,
    end_y: float = 200_000.0,
) -> SectionSnapshot:
    """Build a minimal but valid SectionSnapshot for testing."""
    return SectionSnapshot(
        project_id=project_id or _project_id(),
        project_name=project_name,
        section_id=section_id or _section_id(),
        section_name=section_name,
        section_length_m=section_length_m,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=investigations or [],
        formations=formations or [],
        contacts=contacts or [],
        start_x=start_x,
        start_y=start_y,
        end_x=end_x,
        end_y=end_y,
    )


def _investigation(
    *,
    along_distance_m: float,
    name: str = "CPT-01",
    kind: str = "cpt",
    total_depth_m: float | None = 20.0,
    surface_elevation_m: float | None = 5.0,
) -> SectionInvestigationProjection:
    return SectionInvestigationProjection(
        investigation_id=_investigation_id(),
        kind=kind,
        name=name,
        along_distance_m=along_distance_m,
        surface_elevation_m=surface_elevation_m,
        total_depth_m=total_depth_m,
    )


def _formation(
    fid: UUID | None = None,
    *,
    name: str = "Boom Klei",
    color: str = "#336699",
    display_order: int = 0,
) -> SectionFormation:
    return SectionFormation(
        formation_id=fid or _formation_id(),
        name=name,
        code="BmK",
        color=color,
        display_order=display_order,
    )


def _contact(
    formation_id: UUID,
    investigation_id: UUID,
    *,
    along_distance_m: float,
    depth_m: float,
) -> SectionFormationContact:
    return SectionFormationContact(
        contact_id=_contact_id(),
        formation_id=formation_id,
        investigation_id=investigation_id,
        along_distance_m=along_distance_m,
        depth_m=depth_m,
        level_m=5.0 - depth_m,  # surface_elevation_m=5 − depth
    )


# ---------------------------------------------------------------------------
# PE1: happy path — valid PDF bytes with %PDF magic header
# ---------------------------------------------------------------------------


def test_happy_path_produces_valid_pdf_bytes() -> None:
    """A fully-populated SectionSnapshot + ReportMetadata produces PDF bytes
    that start with the ``%PDF`` magic header.

    This is the primary smoke test: if ReportLab + matplotlib raise or
    produce non-PDF output, the test fails here before the structural checks.
    """
    inv_id = _investigation_id()
    fid = _formation_id()

    inv = _investigation(along_distance_m=30.0, name="CPT-GEO-01")
    formation = _formation(fid, name="Boom Klei", color="#336699")
    contact = _contact(fid, inv_id, along_distance_m=30.0, depth_m=5.0)

    # Replace inv_id in the contact + investigation so they share the same id.
    inv = SectionInvestigationProjection(
        investigation_id=inv_id,
        kind="cpt",
        name="CPT-GEO-01",
        along_distance_m=30.0,
        surface_elevation_m=5.0,
        total_depth_m=20.0,
    )

    snapshot = _minimal_snapshot(
        project_name="Antwerp Quay",
        section_name="Section A–A'",
        section_length_m=100.0,
        investigations=[inv],
        formations=[formation],
        contacts=[contact],
        end_x=150_100.0,
    )
    metadata = ReportMetadata(
        title="Cross-section A–A'",
        author="R. Vorsselmans",
        date=datetime(2026, 6, 1, 9, 0),
    )

    exporter = SectionPdfReportExporter()
    pdf_bytes = exporter.export(snapshot, metadata)

    assert isinstance(pdf_bytes, bytes), "PE1: export must return bytes"
    assert len(pdf_bytes) > 0, "PE1: PDF bytes must be non-empty"
    assert pdf_bytes[:4] == b"%PDF", f"PE1: PDF must start with '%PDF' magic; got {pdf_bytes[:8]!r}"


# ---------------------------------------------------------------------------
# PE2: metadata round-trip — key strings appear in the PDF byte stream
# ---------------------------------------------------------------------------


def test_metadata_strings_appear_in_pdf() -> None:
    """The PDF Info dictionary must contain the title and author from ReportMetadata.

    ReportLab writes the title and author into the PDF /Info object as
    bracketed ASCII strings — those ARE present verbatim in the raw bytes.
    The project name and section name go into compressed content streams
    (ReportLab deflates all Flowable text), so they are NOT searchable in
    the raw byte stream and are not asserted here.  The safe observable
    contract is the /Info dict fields: /Title and /Author.
    """
    snapshot = _minimal_snapshot(
        project_name="Gent Noord",
        section_name="Profiel-12",
        section_length_m=200.0,
        end_x=150_200.0,
    )
    title = "Doorsnede Profiel-12"
    author = "Test Engineer"
    metadata = ReportMetadata(
        title=title,
        author=author,
        date=datetime(2026, 6, 1),
    )

    pdf_bytes = SectionPdfReportExporter().export(snapshot, metadata)

    # The /Info object is written uncompressed by ReportLab; /Title and /Author
    # appear as bracketed ASCII strings: /Title (Doorsnede Profiel-12).
    assert b"/Title" in pdf_bytes, "PE2: /Title key must appear in PDF Info dict"
    assert title.encode() in pdf_bytes, "PE2: title value must appear verbatim in PDF Info dict"
    assert b"/Author" in pdf_bytes, "PE2: /Author key must appear in PDF Info dict"
    assert author.encode() in pdf_bytes, "PE2: author value must appear verbatim in PDF Info dict"


# ---------------------------------------------------------------------------
# PE3: multi-investigation section
# ---------------------------------------------------------------------------


def test_multi_investigation_section_renders_without_error() -> None:
    """A snapshot with 5 investigations and 5 formation contacts renders
    without raising an exception and produces valid PDF bytes.

    Exercises the packed_column_positions helper + the per-investigation
    column-line rendering loop in _render_section_figure.
    """
    fid = _formation_id()
    formation = _formation(fid, name="Diest Zand", color="#c8a46e")

    inv_ids = [_investigation_id() for _ in range(5)]
    investigations = [
        SectionInvestigationProjection(
            investigation_id=iid,
            kind="cpt",
            name=f"CPT-{i + 1:02d}",
            along_distance_m=float(i * 25),
            surface_elevation_m=5.0 + i * 0.2,
            total_depth_m=18.0,
        )
        for i, iid in enumerate(inv_ids)
    ]
    contacts = [
        _contact(fid, iid, along_distance_m=float(i * 25), depth_m=4.0 + i * 0.5)
        for i, iid in enumerate(inv_ids)
    ]

    snapshot = _minimal_snapshot(
        project_name="Brugge West",
        section_name="P-05",
        section_length_m=100.0,
        investigations=investigations,
        formations=[formation],
        contacts=contacts,
        end_x=150_100.0,
    )
    metadata = ReportMetadata(title="Profiel P-05")

    pdf_bytes = SectionPdfReportExporter().export(snapshot, metadata)

    assert pdf_bytes[:4] == b"%PDF", "PE3: multi-investigation export must produce valid PDF"
    assert len(pdf_bytes) > 1024, "PE3: PDF must be meaningfully large (>1 KB)"


# ---------------------------------------------------------------------------
# PE4: empty section — no investigations, no contacts
# ---------------------------------------------------------------------------


def test_empty_section_produces_valid_pdf() -> None:
    """A SectionSnapshot with no investigations and no contacts must produce
    valid PDF bytes without raising.

    The exporter must handle this gracefully — an empty section is a valid
    state (user drew a section line but hasn't seeded any investigations yet).
    """
    snapshot = _minimal_snapshot(
        project_name="Leeg Project",
        section_name="Empty-01",
        section_length_m=50.0,
        investigations=[],
        formations=[],
        contacts=[],
        end_x=150_050.0,
    )
    metadata = ReportMetadata(title="Empty Section")

    pdf_bytes = SectionPdfReportExporter().export(snapshot, metadata)

    assert isinstance(pdf_bytes, bytes), "PE4: empty section export must return bytes"
    assert pdf_bytes[:4] == b"%PDF", "PE4: empty section must still produce valid PDF"


# ---------------------------------------------------------------------------
# PE5: non-empty notes block
# ---------------------------------------------------------------------------


def test_notes_block_is_accepted() -> None:
    """ReportMetadata.notes (free-text description) is accepted without error.

    The notes field is rendered as a BodyText paragraph inside a deflated
    ReportLab content stream, so the text is NOT searchable in raw bytes.
    The observable contracts are:
    1. Export completes and produces valid PDF bytes.
    2. The PDF with notes is strictly larger than an otherwise-identical
       export WITHOUT notes, confirming the notes paragraph was rendered
       (not silently dropped).
    """
    snapshot = _minimal_snapshot(
        project_name="Antwerp Port",
        section_name="Section Notes-Test",
        section_length_m=80.0,
        end_x=150_080.0,
    )
    notes_text = "Preliminary interpretation based on DOV borehole data only."
    metadata_with_notes = ReportMetadata(
        title="Section with notes",
        notes=notes_text,
    )
    metadata_no_notes = ReportMetadata(
        title="Section with notes",
        notes="",
    )

    exporter = SectionPdfReportExporter()
    pdf_with = exporter.export(snapshot, metadata_with_notes)
    pdf_without = exporter.export(snapshot, metadata_no_notes)

    assert pdf_with[:4] == b"%PDF", "PE5: export with notes must produce valid PDF"
    assert len(pdf_with) > len(pdf_without), (
        f"PE5: PDF with notes ({len(pdf_with)} bytes) must be larger than "
        f"PDF without notes ({len(pdf_without)} bytes) — notes paragraph not rendered"
    )


# ---------------------------------------------------------------------------
# PE6: section with investigations but no formation contacts
# ---------------------------------------------------------------------------


def test_section_without_contacts_renders_investigation_columns_only() -> None:
    """A section with investigations but no formation picks renders column
    lines only (no polylines) — no exception, valid PDF.

    This is the state after a user creates a section and seeds investigations
    but hasn't yet accepted any litho suggestions or drawn any geology.
    """
    inv_id1 = _investigation_id()
    inv_id2 = _investigation_id()
    investigations = [
        SectionInvestigationProjection(
            investigation_id=inv_id1,
            kind="borehole",
            name="BH-01",
            along_distance_m=20.0,
            surface_elevation_m=4.5,
            total_depth_m=15.0,
        ),
        SectionInvestigationProjection(
            investigation_id=inv_id2,
            kind="cpt",
            name="CPT-02",
            along_distance_m=60.0,
            surface_elevation_m=4.8,
            total_depth_m=22.0,
        ),
    ]

    snapshot = _minimal_snapshot(
        project_name="Kortrijk Zuid",
        section_name="No-Contacts",
        section_length_m=100.0,
        investigations=investigations,
        formations=[],  # no formation rows
        contacts=[],  # no contact picks
        end_x=150_100.0,
    )
    metadata = ReportMetadata(title="Section — investigations only")

    pdf_bytes = SectionPdfReportExporter().export(snapshot, metadata)

    assert pdf_bytes[:4] == b"%PDF", "PE6: section with no contacts must produce valid PDF"
    assert len(pdf_bytes) > 512, "PE6: PDF with investigation columns must be non-trivial"
