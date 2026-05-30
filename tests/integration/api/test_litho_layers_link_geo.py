"""HTTP-level tests for /layers/{lid}/link-geo + /unlink-geo (A4 cleanup).

Layer-shape mirror of the existing /contacts/{cid}/link-geo + /unlink-geo
pair. UUIDs preserved between LL and FC, so the existing LinkLithoToGeo
use case is reused; the layer endpoint just exposes it via a layer-id
URL and refreshes the LL row so the response carries the updated
parent_geo_contact_id (which the FC→LL trigger UPSERTs in lockstep).

Covered:
* link-geo with a geo contact in range → 200, layer's parent_geo_contact_id set
* link-geo when no geo contact within tolerance → 200 + null body
* link-geo on a non-existent layer → 404
* link-geo on a layer that lives in a different model → 404
* unlink-geo clears parent_geo_contact_id
* unlink-geo is idempotent on an already-unlinked layer
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project_with_coupled_pair(db_session: AsyncSession) -> dict:
    """Geo + Litho model on the same project + 1 BH + 1 formation +
    1 geo contact at 2.0 m + 1 litho layer at 2.05 m (close enough to
    snap-link within the default 0.20 m tolerance)."""
    project = ProjectOrm(id=uuid7(), name="Link layer", status="active")
    db_session.add(project)
    await db_session.flush()
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="T",
        test_id="T",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="G", kind="geological"
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    db_session.add_all([bh, geo_model, litho_model, sand])
    await db_session.flush()
    geo_contact = FormationContactOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=sand.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(geo_contact)
    await db_session.commit()
    # Create the litho layer directly (status='accepted' → trigger mirrors FC).
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=sand.id,
        borehole_id=bh.id,
        depth_top_m=2.05,
        depth_base_m=5.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()
    return {
        "project": project,
        "bh": bh,
        "geo_model": geo_model,
        "litho_model": litho_model,
        "sand": sand,
        "geo_contact": geo_contact,
        "layer": layer,
    }


async def test_link_geo_couples_layer_to_nearest_geo_contact(
    async_client: AsyncClient, project_with_coupled_pair: dict
) -> None:
    """Layer at 2.05 m + geo at 2.0 m → within 0.20 m tolerance → coupled."""
    p = project_with_coupled_pair
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho_model'].id}"
        f"/layers/{p['layer'].id}/link-geo",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body is not None
    assert body["parent_geo_contact_id"] == str(p["geo_contact"].id)


async def test_link_geo_returns_null_when_no_match_in_range(
    async_client: AsyncClient,
    project_with_coupled_pair: dict,
    db_session: AsyncSession,
) -> None:
    """Move the geo contact 1 m away — out of the 0.20 m tolerance — and
    the link returns a null body."""
    p = project_with_coupled_pair
    p["geo_contact"].depth_top_m = 5.0
    await db_session.commit()
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho_model'].id}"
        f"/layers/{p['layer'].id}/link-geo",
    )
    assert resp.status_code == 200
    assert resp.json() is None


async def test_link_geo_404_on_unknown_layer(
    async_client: AsyncClient, project_with_coupled_pair: dict
) -> None:
    """Bogus layer id → 404."""
    p = project_with_coupled_pair
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho_model'].id}"
        f"/layers/{uuid7()}/link-geo",
    )
    assert resp.status_code == 404


async def test_link_geo_404_when_layer_in_different_model(
    async_client: AsyncClient,
    project_with_coupled_pair: dict,
    db_session: AsyncSession,
) -> None:
    """Layer exists but belongs to a different litho model in the same
    project → URL scope guard returns 404, not a cross-model link."""
    p = project_with_coupled_pair
    other_litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=p["project"].id,
        name="L2",
        kind="lithostratigraphic",
        parent_geological_model_id=p["geo_model"].id,
    )
    db_session.add(other_litho)
    await db_session.commit()
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{other_litho.id}"
        f"/layers/{p['layer'].id}/link-geo",
    )
    assert resp.status_code == 404


async def test_unlink_geo_clears_parent_geo_contact_id(
    async_client: AsyncClient,
    project_with_coupled_pair: dict,
    db_session: AsyncSession,
) -> None:
    """First link, then unlink, then verify parent_geo_contact_id is NULL."""
    p = project_with_coupled_pair
    # Link first.
    link_resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho_model'].id}"
        f"/layers/{p['layer'].id}/link-geo",
    )
    assert link_resp.status_code == 200
    assert link_resp.json()["parent_geo_contact_id"] == str(p["geo_contact"].id)
    # Unlink.
    unlink_resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho_model'].id}"
        f"/layers/{p['layer'].id}/unlink-geo",
    )
    assert unlink_resp.status_code == 200, unlink_resp.text
    assert unlink_resp.json()["parent_geo_contact_id"] is None


async def test_unlink_geo_is_idempotent(
    async_client: AsyncClient, project_with_coupled_pair: dict
) -> None:
    """Unlinking an already-unlinked layer is a no-op that still returns 200."""
    p = project_with_coupled_pair
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho_model'].id}"
        f"/layers/{p['layer'].id}/unlink-geo",
    )
    assert resp.status_code == 200
    assert resp.json()["parent_geo_contact_id"] is None
