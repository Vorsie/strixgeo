"""Integration tests for TIN extrapolation in AcceptLithoSuggestions (debt #87).

Pins the end-to-end accept path:

X1  Suggestion above the shallowest geology contact at this investigation
    but within a TIN footprint → parent extrapolated, formation row
    carries ``parent_extrapolated=True``, response carries the id in
    ``extrapolated_formation_ids``.
X2  Suggestion without geology surfaces nor contacts → orphan path, row
    carries ``parent_formation_id=NULL``, response carries the id in
    ``orphan_formation_ids``.
X3  Migration backfill semantics (covered by the runtime path here): an
    orphan row created by X2 can be reparented by re-running accept with
    a non-stale TIN now in place; the second accept creates a NEW row
    (different parent bucket) — the pre-existing orphan stays untouched
    (a future "reassign parent" UX action is what fixes existing orphans;
    the migration handles this at upgrade time, see the migration's own
    test below).
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    proj = ProjectOrm(id=uuid7(), name="litho extrapolation test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def stack(
    db_session: AsyncSession,
    project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Geo model + one formation + litho model + borehole with elevation.

    No TIN surface is created by default — individual tests insert one
    when they need extrapolation to succeed.
    """
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201
    geo_model = geo_resp.json()

    geo_f_resp = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={"name": "Boom Klei", "color": "#888", "display_order": 0},
    )
    assert geo_f_resp.status_code == 201
    geo_formation = geo_f_resp.json()

    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_model["id"],
        },
    )
    assert litho_resp.status_code == 201
    litho_model = litho_resp.json()

    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-EX",
        app_project_id=project.id,
        project_id="TEST",
        test_id="EX-001",
        location_x=100.0,
        location_y=100.0,
        epsg=31370,
        total_depth_m=20.0,
        elevation_m=10.0,  # surveyed surface elevation — required for extrapolation
    )
    db_session.add(bh)
    await db_session.commit()

    return {
        "geo_model": geo_model,
        "litho_model": litho_model,
        "geo_formation": geo_formation,
        "borehole": bh,
    }


def _accept_body(top: float, base: float, borehole_id: str, lithology: str = "ZAND") -> dict:
    """Body for a single-layer accept request."""
    return {
        "borehole_id": borehole_id,
        "suggestions": [
            {
                "depth_top_m": top,
                "depth_base_m": base,
                "suggested_lithology": lithology,
                "confidence": "high",
                "source": "borehole_observation",
                "suggested_admixtures": [],
            }
        ],
    }


# ---------------------------------------------------------------------------
# X1 — TIN extrapolation: response + DB row both carry the flag.
# ---------------------------------------------------------------------------


async def test_x1_extrapolated_parent_flagged_on_row_and_in_response(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """Suggestion above shallowest contact + TIN at (x, y) → extrapolated path."""
    geo_formation = stack["geo_formation"]
    geo_model = stack["geo_model"]
    bh = stack["borehole"]
    litho_mid = stack["litho_model"]["id"]

    # Seed a TIN covering the borehole at elev=8 (so target_z = 10 - 7 = 3 m
    # < surface elev 8 → formation owns this elevation → extrapolation hits).
    surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo_model["id"],
        formation_id=geo_formation["id"],
        method="tin",
        vertices=[
            [0.0, 0.0, 8.0],
            [200.0, 0.0, 8.0],
            [200.0, 400.0, 8.0],
            [0.0, 400.0, 8.0],
        ],
        triangles=[[0, 1, 2], [0, 2, 3]],
        source_contact_count=4,
        source_contact_checksum=b"\x00" * 8,
        is_stale=False,
    )
    db_session.add(surface)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_mid}/contacts/accept-litho-suggestions",
        json=_accept_body(7.0, 9.0, str(bh.id), lithology="ZAND"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["created_formation_ids"]) == 1
    assert body["extrapolated_formation_ids"] == body["created_formation_ids"]
    assert body["orphan_formation_ids"] == []

    # DB row reflects the flag + the inferred parent.
    fid = body["created_formation_ids"][0]
    row = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(GeologicalFormationOrm.id == fid)
            )
        )
        .scalars()
        .one()
    )
    assert row.parent_extrapolated is True
    assert str(row.parent_formation_id) == geo_formation["id"]


# ---------------------------------------------------------------------------
# X2 — orphan: no TIN, no geology contacts → flagged as orphan.
# ---------------------------------------------------------------------------


async def test_x2_no_geology_context_creates_orphan(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """No surfaces + no contacts → orphan row + response lists it."""
    bh = stack["borehole"]
    litho_mid = stack["litho_model"]["id"]

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_mid}/contacts/accept-litho-suggestions",
        json=_accept_body(0.0, 5.0, str(bh.id), lithology="KLEI"),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["created_formation_ids"]) == 1
    assert body["orphan_formation_ids"] == body["created_formation_ids"]
    assert body["extrapolated_formation_ids"] == []

    fid = body["created_formation_ids"][0]
    row = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(GeologicalFormationOrm.id == fid)
            )
        )
        .scalars()
        .one()
    )
    assert row.parent_extrapolated is False
    assert row.parent_formation_id is None


# ---------------------------------------------------------------------------
# X3 — PATCH parent_extrapolated=False clears the flag (confirm action).
# ---------------------------------------------------------------------------


async def test_x3_patch_clears_extrapolated_flag(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """The Confirm-parent UX PATCHes parent_extrapolated=False → row updates."""
    geo_formation = stack["geo_formation"]
    geo_model = stack["geo_model"]
    bh = stack["borehole"]
    litho_mid = stack["litho_model"]["id"]

    surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo_model["id"],
        formation_id=geo_formation["id"],
        method="tin",
        vertices=[
            [0.0, 0.0, 8.0],
            [200.0, 0.0, 8.0],
            [200.0, 400.0, 8.0],
            [0.0, 400.0, 8.0],
        ],
        triangles=[[0, 1, 2], [0, 2, 3]],
        source_contact_count=4,
        source_contact_checksum=b"\x00" * 8,
        is_stale=False,
    )
    db_session.add(surface)
    await db_session.commit()

    accept_resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_mid}/contacts/accept-litho-suggestions",
        json=_accept_body(7.0, 9.0, str(bh.id), lithology="ZAND"),
    )
    assert accept_resp.status_code == 200
    fid = accept_resp.json()["created_formation_ids"][0]

    patch_resp = await async_client.patch(
        f"/projects/{project.id}/geology/formations/{fid}",
        json={"parent_extrapolated": False},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["parent_extrapolated"] is False

    db_session.expire_all()
    row = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(GeologicalFormationOrm.id == fid)
            )
        )
        .scalars()
        .one()
    )
    assert row.parent_extrapolated is False
    # Parent stays — Confirm only clears the flag, not the link.
    assert str(row.parent_formation_id) == geo_formation["id"]
