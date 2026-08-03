"""File → Save As over HTTP: the copy comes back whole and usable.

``tests/integration/db/test_project_duplicate_full_tree.py`` pins the
repository's completeness collection by collection.  This module pins the
one thing only the endpoint does: running the body resolver over the copy,
so the duplicate opens with its bodies grouped instead of with every
``litho_layer.body_id`` left NULL for the next rebuild to notice.

Run via the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_duplicate_project_endpoint.py
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest.mark.asyncio
async def test_save_as_returns_a_copy_that_carries_the_litho_model(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """POST /duplicate hands back a project that still has the interpretation.

    The desktop adopts the duplicate the moment this returns, so anything
    missing from it is missing from the engineer's session. Checks the
    litho model, its accepted layer, and the body grouping the endpoint's
    resolver pass re-stamps (the restore deliberately drops ``body_id`` for
    the resolver to re-derive, exactly as on an open-from-file).
    """
    project = ProjectOrm(id=uuid7(), name="Save-As over HTTP", status="active")
    db_session.add(project)
    await db_session.flush()

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=project.id,
        project_id="DUP",
        test_id="DUP/CPT-1",
        location_x=150_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        epsg=31370,
        z_epsg=5710,
    )
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Zand van Mol",
        color="#e8c26a",
        display_order=1,
        lithology="ZAND",
        litho_main_soil_code="ZAND",
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Geo", kind="geological", is_active=True
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    db_session.add_all([cpt, formation, geo_model, litho_model])
    await db_session.flush()
    db_session.add(
        LithoLayerOrm(
            id=uuid7(),
            model_id=litho_model.id,
            formation_id=formation.id,
            cpt_id=cpt.id,
            depth_top_m=0.0,
            depth_base_m=8.0,
            status="accepted",
            source="segmenter",
            confidence="high",
        )
    )
    await db_session.commit()

    resp = await async_client.post(f"/projects/{project.id}/duplicate", json={"name": "Variant A"})
    assert resp.status_code == 201, resp.text
    copy_id = resp.json()["id"]
    assert copy_id != str(project.id)

    bundle = (await async_client.get(f"/projects/{copy_id}/bundle")).json()
    litho_models = [m for m in bundle["geological_models"] if m["kind"] == "lithostratigraphic"]
    assert len(litho_models) == 1, (
        f"Save As handed back a project with {len(litho_models)} litho model(s) — "
        "the engineer's interpretation is not in the copy"
    )
    layers = litho_models[0]["litho_layers"]
    assert len(layers) == 1, f"the copy's litho model carries {len(layers)} layer(s), expected 1"
    assert layers[0]["body_id"] is not None, (
        "the copy's litho layer has no body_id — the endpoint must re-run the "
        "resolver, as the restore endpoint does, or the copy opens ungrouped"
    )
