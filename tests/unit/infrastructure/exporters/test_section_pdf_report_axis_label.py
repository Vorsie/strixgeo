"""The section PDF's vertical axis must not be captioned with the datum.

Audit 2026-08-02, Class 5 ("an invented value is presented as a measured
one"): the report figure plots **depth below each column's own surface**
— every column starts at 0 and every contact is drawn at ``depth_m`` —
yet the axis was captioned ``Depth (m TAW)``.  ``m TAW`` / ``m NAP`` is
an absolute *level* datum; naming it on a depth axis tells the reader
that 8 on the axis means +8 m TAW when the real level is whatever the
collar was minus 8 m.

The rule these tests pin, in the rule's own words:

* PDF1 — the figure's vertical axis caption never names the vertical
  datum, because the plotted values are not levels in that datum.
* PDF2 — the caption says what the values ARE: depth below the surface.
* PDF3 — the datum stays visible where it is true: the metadata table
  describes the project, not the plotted values.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import pytest
from matplotlib.axes import Axes

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

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000101")
SECTION_ID = UUID("00000000-0000-0000-0000-000000000102")
FORMATION_ID = UUID("00000000-0000-0000-0000-000000000103")
INV_A_ID = UUID("00000000-0000-0000-0000-000000000104")
INV_B_ID = UUID("00000000-0000-0000-0000-000000000105")


def _snapshot() -> SectionSnapshot:
    """A two-column section whose collars sit 3.3 m apart in level."""
    return SectionSnapshot(
        project_id=PROJECT_ID,
        project_name="Antwerp port — quay 7",
        section_id=SECTION_ID,
        section_name="Section A-A'",
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
            ),
            SectionInvestigationProjection(
                investigation_id=INV_B_ID,
                kind="cpt",
                name="CPT-02",
                along_distance_m=90.0,
                surface_elevation_m=9.1,
                total_depth_m=25.0,
            ),
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
                contact_id=UUID("00000000-0000-0000-0000-000000000106"),
                formation_id=FORMATION_ID,
                investigation_id=INV_A_ID,
                along_distance_m=10.0,
                depth_m=8.0,
                level_m=4.4,
            ),
            SectionFormationContact(
                contact_id=UUID("00000000-0000-0000-0000-000000000107"),
                formation_id=FORMATION_ID,
                investigation_id=INV_B_ID,
                along_distance_m=90.0,
                depth_m=8.0,
                level_m=1.1,
            ),
        ],
        start_x=150_000.0,
        start_y=200_000.0,
        end_x=150_120.0,
        end_y=200_000.0,
    )


@pytest.fixture()
def axis_labels(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Capture every y-axis caption the exporter sets while rendering."""
    captured: list[str] = []
    original = Axes.set_ylabel

    def _spy(self: Axes, ylabel: str, *args: object, **kwargs: object) -> object:
        captured.append(ylabel)
        return original(self, ylabel, *args, **kwargs)

    monkeypatch.setattr(Axes, "set_ylabel", _spy)
    return captured


def _export(snapshot: SectionSnapshot) -> bytes:
    return SectionPdfReportExporter().export(
        snapshot,
        ReportMetadata(title="Cross-section: A-A'", date=datetime(2026, 8, 3)),
    )


def test_pdf1_vertical_axis_caption_never_names_the_vertical_datum(
    axis_labels: list[str],
) -> None:
    """PDF1 — no axis caption names 'm TAW': the figure plots no levels."""
    _export(_snapshot())

    assert axis_labels, "expected the exporter to caption the figure's vertical axis"
    offenders = [label for label in axis_labels if "TAW" in label or "NAP" in label]
    assert offenders == [], (
        "the section figure plots depth below each column's own surface, "
        f"so its caption must not name the vertical datum — got {offenders}"
    )


def test_pdf2_vertical_axis_caption_says_the_values_are_below_surface(
    axis_labels: list[str],
) -> None:
    """PDF2 — the caption states what the plotted values actually are."""
    _export(_snapshot())

    assert any("below surface" in label for label in axis_labels), (
        "the caption must tell the reader the values are depths below the "
        f"column surface — got {axis_labels}"
    )


def test_pdf3_report_still_renders_with_the_corrected_caption() -> None:
    """PDF3 — relabelling does not break the render (still valid PDF bytes).

    The datum itself stays in the report's metadata table, where it
    describes the project rather than the plotted values; that row is
    covered by ``tests/integration/exporters/test_section_pdf_report_exporter.py``
    (PE2), which can read the decompressed text stream.
    """
    pdf = _export(_snapshot())

    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 1000
