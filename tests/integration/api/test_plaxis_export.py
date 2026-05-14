"""End-to-end tests for the Plaxis 3D export endpoint (v1.0 MVP).

Sets up a project + active geological model + two formations + two
investigations (CPT + borehole) with contacts → calls
``GET /projects/{pid}/geology/models/{mid}/export/plaxis3d`` →
asserts response shape + emitted script content.

The exporter's own behaviour is pinned by unit tests in
``tests/unit/infrastructure/exporters/test_plaxis_exporter.py``;
this suite verifies the HTTP + DB + snapshot-assembly round trip.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
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
async def seeded_model(db_session: AsyncSession) -> dict:
    """Seed a project + active model + 2 formations + 1 CPT + 1 borehole
    with contacts at each. Returns id dict so tests address URLs
    without re-querying.
    """
    project = ProjectOrm(
        id=uuid7(),
        name="Plaxis-Export-Test",
        status="active",
        default_horizontal_epsg=31370,
    )
    db_session.add(project)

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-A",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/01",
        app_project_id=project.id,
        location_x=150100.0,
        location_y=200100.0,
        elevation_m=12.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=20.0,
    )
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="boornummer-1",
        location_x=150200.0,
        location_y=200100.0,
        elevation_m=11.5,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=25.0,
    )
    db_session.add(cpt)
    db_session.add(bh)

    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Main",
        description=None,
        is_active=True,
    )
    db_session.add(model)

    # display_order ASC = oldest. Boom is older, Diest is younger.
    boom = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Boom Klei",
        code="BmK",
        color="#cccc66",
        display_order=0,
    )
    diest = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Diest Zand",
        code="Di",
        color="#cccc99",
        display_order=10,
    )
    db_session.add(boom)
    db_session.add(diest)

    # Each investigation has a Diest top (young, shallow) and a
    # Boom top (old, deep). Plaxis layer 0 = Diest, layer 1 = Boom.
    contacts = [
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            cpt_id=cpt.id,
            depth_top_m=0.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            cpt_id=cpt.id,
            depth_top_m=5.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            borehole_id=bh.id,
            depth_top_m=0.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            borehole_id=bh.id,
            depth_top_m=6.0,
            source="manual_pick",
            confidence="medium",
        ),
    ]
    for c in contacts:
        db_session.add(c)
    await db_session.commit()

    return {
        "project_id": project.id,
        "model_id": model.id,
        "cpt_id": cpt.id,
        "bh_id": bh.id,
    }


async def test_plaxis_export_happy_path(async_client: AsyncClient, seeded_model: dict) -> None:
    """End-to-end: a 2-investigation × 2-formation model → script
    with both boreholes + Mohr-Coulomb materials per formation +
    setsoillayerlevel calls per (borehole, layer)."""
    resp = await async_client.get(
        f"/projects/{seeded_model['project_id']}/geology/models/"
        f"{seeded_model['model_id']}/export/plaxis3d"
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/x-python")
    assert "Plaxis-Export-Test_plaxis3d.py" in resp.headers.get("content-disposition", "")

    script = resp.text

    # Header
    assert "Plaxis-Export-Test" in script
    assert "Investigations: 2" in script
    assert "Formations    : 2" in script

    # Materials
    assert script.count("g_i.soilmat()") == 2
    assert "Identification = 'Boom Klei'" in script
    assert "Identification = 'Diest Zand'" in script

    # Global layers — exactly 2, top-down (Diest first because
    # display_order=10 is younger than Boom display_order=0).
    layer_block = script[script.index("# ---- Global soil layer stack") :]
    assert layer_block.count("g_i.soillayer(0)") == 2
    boreholes_marker = layer_block.index("# ---- Boreholes ----")
    layer_only = layer_block[:boreholes_marker]
    assert layer_only.index("Diest Zand") < layer_only.index("Boom Klei")

    # Boreholes — one per investigation.
    assert script.count("g_i.borehole(") == 2

    # setsoillayerlevel — 2 boreholes × 2 layers = 4 calls.
    assert script.count("g_i.setsoillayerlevel(") == 4


async def test_plaxis_export_404_unknown_model(
    async_client: AsyncClient, seeded_model: dict
) -> None:
    """Unknown model id ⇒ 404 (the project-scope guard fires first)."""
    bogus = uuid7()
    resp = await async_client.get(
        f"/projects/{seeded_model['project_id']}/geology/models/{bogus}/export/plaxis3d"
    )
    assert resp.status_code == 404


async def test_plaxis_export_404_model_in_other_project(
    async_client: AsyncClient, seeded_model: dict, db_session: AsyncSession
) -> None:
    """Model exists, but in a different project ⇒ 404 from the scope guard."""
    other_project = ProjectOrm(
        id=uuid7(),
        name="Other",
        status="active",
        default_horizontal_epsg=31370,
    )
    db_session.add(other_project)
    await db_session.commit()

    resp = await async_client.get(
        f"/projects/{other_project.id}/geology/models/{seeded_model['model_id']}/export/plaxis3d"
    )
    assert resp.status_code == 404
