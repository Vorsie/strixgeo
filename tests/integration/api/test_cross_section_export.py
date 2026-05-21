"""End-to-end tests for the DXF section export endpoint (v1.0 MVP #5).

Sets up: project → section → CPTs + boreholes near the section line
→ active geological model → formation contacts → calls
``GET /projects/{pid}/sections/{sid}/export/dxf`` → asserts response
shape + parses the returned DXF.

Single 200 happy-path test + 404 paths for missing section / model.
The exporter's own behaviour (entity counts, layer colours, sorting)
is pinned by the unit suite in
``tests/unit/infrastructure/exporters/``; here we exercise the
full HTTP + DB + projection + export round trip.
"""

from __future__ import annotations

import io

import ezdxf
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def seeded_section(db_session: AsyncSession) -> dict:
    """Seed a project + section + investigations + active model +
    contacts. Returns a dict of the relevant ids so each test can
    address the URLs without re-querying."""
    project = ProjectOrm(id=uuid7(), name="Export-Test", status="active")
    db_session.add(project)

    # Section is a 200 m east-west line through y=200000.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="A-A'",
        description=None,
        start_x=150000.0,
        start_y=200000.0,
        end_x=150200.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=25.0,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )
    db_session.add(section)

    # Two CPTs on / near the line.
    cpt_left = CptOrm(
        id=uuid7(),
        name="CPT-L",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/01",
        app_project_id=project.id,
        location_x=150050.0,  # along ≈ 50 m
        location_y=200005.0,  # offset 5 m → inside the 25 m buffer
        elevation_m=12.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=18.0,
    )
    cpt_right = CptOrm(
        id=uuid7(),
        name="CPT-R",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/02",
        app_project_id=project.id,
        location_x=150150.0,  # along ≈ 150 m
        location_y=200002.0,
        elevation_m=11.5,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=22.0,
    )
    db_session.add(cpt_left)
    db_session.add(cpt_right)

    # One borehole between them.
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="boornummer-1",
        location_x=150100.0,  # along ≈ 100 m
        location_y=199998.0,
        elevation_m=11.8,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=25.0,
    )
    db_session.add(bh)

    # One CPT FAR off the section line — should be filtered out.
    cpt_far = CptOrm(
        id=uuid7(),
        name="CPT-far",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/far",
        app_project_id=project.id,
        location_x=150100.0,
        location_y=200500.0,  # offset 500 m, way past the buffer
        elevation_m=10.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    db_session.add(cpt_far)

    # Active geological model + 2 formations.
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Main",
        description=None,
        is_active=True,
    )
    db_session.add(model)
    boom = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Boom Klei",
        code="BmK",
        color="#ff8800",
        display_order=0,
    )
    diest = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Diest Zand",
        code="Di",
        color="#33aa44",
        display_order=1,
    )
    db_session.add(boom)
    db_session.add(diest)

    # Two contacts per investigation: a Boom Klei top and a Diest
    # top. The polylines should connect them left-to-right.
    contacts = [
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            cpt_id=cpt_left.id,
            depth_top_m=3.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            cpt_id=cpt_left.id,
            depth_top_m=10.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            borehole_id=bh.id,
            depth_top_m=3.5,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            borehole_id=bh.id,
            depth_top_m=11.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            cpt_id=cpt_right.id,
            depth_top_m=4.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            cpt_id=cpt_right.id,
            depth_top_m=12.0,
            source="manual_pick",
            confidence="medium",
        ),
    ]
    for c in contacts:
        db_session.add(c)

    # Explicit-content invariant (commit 8606efea / owner directive
    # 2026-05-17): BuildSectionSnapshot and the section-scoped exporters
    # (DXF, Plaxis-2D) only render contacts whose id is in the section's
    # seeded set. The production flow seeds these via
    # CrossSectionRepository.union_seeded_contact_ids; this fixture
    # mirrors that by registering every created contact id on the
    # section directly. Without this the snapshot yields zero formation
    # content and the export carries no formation polylines.
    section.seeded_formation_contact_ids = [c.id for c in contacts]

    await db_session.commit()

    return {
        "project_id": project.id,
        "section_id": section.id,
        "model_id": model.id,
        "cpt_left_id": cpt_left.id,
        "cpt_right_id": cpt_right.id,
        "bh_id": bh.id,
        "cpt_far_id": cpt_far.id,
    }


async def test_dxf_export_happy_path(async_client: AsyncClient, seeded_section: dict) -> None:
    """A real export round-trip — section through 2 CPTs + 1 borehole
    with 2 formations × 3 contacts each → DXF with 2 polylines + 3
    column lines + title block."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/dxf")
    # Content-Disposition proposes a filename based on the section
    # name. "A-A'" sanitises to "A-A_" (single quote → underscore).
    assert "filename=" in resp.headers["content-disposition"]

    payload = resp.content
    assert payload, "empty body"

    doc = ezdxf.read(io.StringIO(payload.decode("utf-8")))
    msp = doc.modelspace()

    # 3 investigation columns (left CPT, BH, right CPT). Far CPT is
    # outside the projection buffer → filtered out.
    lines = list(msp.query("LINE[layer=='Investigations']"))
    assert len(lines) == 3

    # 2 formation polylines (Boom Klei + Diest Zand), each with 3
    # vertices (one per anchor with that contact).
    polylines = list(msp.query("LWPOLYLINE"))
    assert len(polylines) == 2
    for poly in polylines:
        assert len(list(poly.get_points())) == 3

    # The layer namespace carries both formations.
    layer_names = {layer.dxf.name for layer in doc.layers}
    assert "GeoModel-Boom Klei" in layer_names
    assert "GeoModel-Diest Zand" in layer_names
    # Investigations layer was registered by the exporter.
    assert "Investigations" in layer_names

    # Far CPT must NOT have produced a column line. Total of 3
    # already asserts this; double-check by name absence in labels.
    labels = [e.dxf.text for e in msp.query("TEXT[layer=='Investigations']")]
    assert "CPT-far" not in labels


async def test_pdf_export_happy_path(async_client: AsyncClient, seeded_section: dict) -> None:
    """Smoke test for the section PDF report endpoint (debt #52 slice 1).

    Asserts the round-trip:
    * Returns 200 with ``application/pdf`` Content-Type.
    * Body starts with the ``%PDF`` magic header.
    * Content-Disposition proposes a filename.
    * Metadata query params reach the response without crashing.
    """
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/pdf",
        params={
            "model_id": str(seeded_section["model_id"]),
            "title": "Custom title for the test",
            "author": "QA",
            "notes": "Sanity test of the PDF endpoint.",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert "filename=" in resp.headers["content-disposition"]
    payload = resp.content
    assert payload, "empty body"
    # Every PDF starts with %PDF-<version> — non-negotiable magic bytes.
    assert payload[:4] == b"%PDF", f"expected %PDF magic, got {payload[:8]!r}"


async def test_pdf_export_works_without_metadata(
    async_client: AsyncClient, seeded_section: dict
) -> None:
    """No title / author / notes provided — backend supplies sensible
    defaults (title from section name, empty author + notes)."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/pdf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 200, resp.text
    assert resp.content[:4] == b"%PDF"


async def test_export_404_when_section_does_not_exist(
    async_client: AsyncClient, seeded_section: dict
) -> None:
    """Missing section id → 404 with a helpful message."""
    bogus_section = uuid7()
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{bogus_section}/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


async def test_export_404_when_model_does_not_exist(
    async_client: AsyncClient, seeded_section: dict
) -> None:
    """Missing model id → 404."""
    bogus_model = uuid7()
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(bogus_model)},
    )
    assert resp.status_code == 404


async def test_export_404_when_section_in_different_project(
    async_client: AsyncClient,
    seeded_section: dict,
    db_session: AsyncSession,
) -> None:
    """Section that belongs to another project → 404.

    Cross-project scope guard — the section repo's app_project_id
    check inside BuildSectionSnapshot is what stops a section from
    one project being exported as if it belonged to another. The
    test pins that guard.
    """
    # Create a second project; ask for the FIRST project's section
    # under the SECOND project's URL prefix.
    other = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(other)
    await db_session.commit()

    resp = await async_client.get(
        f"/projects/{other.id}/sections/{seeded_section['section_id']}/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 404
