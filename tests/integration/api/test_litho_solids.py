"""Integration tests for the litho-3D solid API endpoints.

Coverage
--------
LS-1  GET .../litho-solids returns an empty list when no build has run.
LS-2  GET .../litho-solids returns seeded solid rows with the joined
      ``display_color`` / ``body_ordinal`` body attributes.
LS-4  PATCH .../bodies/{body_id}/color persists ``display_color`` and a
      subsequent GET returns the updated colour in the solid response.
LS-6  GET .../litho-solids returns 404 when the model belongs to a
      different project (cross-project IDOR guard).
LS-8  PATCH .../bodies/{body_id}/color returns 404 when body belongs to a
      different project.

The scenes seed ``BodyOrm`` + ``LithoBodySolidOrm`` rows directly — the
build path itself (``POST .../litho-solids/build-voxel``) has its own
end-to-end coverage in ``test_build_voxel.py``.  (The retired implicit
strat-field ``POST .../litho-solids/rebuild`` endpoint and its LS-2/3/5/7
tests were deleted with the strat_field builder — #237; git history has
them.)
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# A minimal watertight-ish mesh payload — the API passes the JSONB arrays
# through verbatim, so a single triangle is enough to exercise the shape.
_VERTICES = [[150000.0, 200000.0, 5.0], [150010.0, 200000.0, 5.0], [150005.0, 200010.0, 5.0]]
_TRIANGLES = [[0, 1, 2]]


def _body(
    project_id: UUID,
    model_id: UUID,
    formation_id: UUID,
    *,
    ordinal: int = 0,
) -> BodyOrm:
    """Unsaved ``BodyOrm`` row (the resolver's product, seeded directly)."""
    return BodyOrm(
        id=uuid7(),
        app_project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        body_ordinal=ordinal,
        source_investigation_id=uuid7(),
    )


def _solid(model_id: UUID, body: BodyOrm, formation_id: UUID) -> LithoBodySolidOrm:
    """Unsaved cached solid row for *body* (method ``voxel``)."""
    return LithoBodySolidOrm(
        id=uuid7(),
        model_id=model_id,
        body_id=body.id,
        formation_id=formation_id,
        method="voxel",
        vertices=_VERTICES,
        triangles=_TRIANGLES,
        source_pick_count=3,
        source_pick_checksum=b"\x00" * 16,
        is_stale=False,
        is_flagged=False,
    )


# ---------------------------------------------------------------------------
# Base scene — project + models + formation (no bodies yet)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> dict:
    """Project + geo + litho model + one formation.

    Returns keys: project, geo, litho, formation.
    """
    proj = ProjectOrm(id=uuid7(), name="LS-API test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo-LS", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho-LS",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND-LS",
        color="#f5deb3",
        display_order=0,
    )
    db_session.add(formation)
    await db_session.commit()

    return {"project": proj, "geo": geo, "litho": litho, "formation": formation}


# ---------------------------------------------------------------------------
# Scene with a seeded body + cached solid row
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def solid_scene(db_session: AsyncSession, scene: dict) -> dict:
    """Extends ``scene`` with one ``BodyOrm`` + one cached ``LithoBodySolidOrm``.

    Returns the ``scene`` dict extended with keys: body, solid.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]

    body = _body(proj.id, litho.id, f.id)
    db_session.add(body)
    await db_session.flush()

    solid = _solid(litho.id, body, f.id)
    db_session.add(solid)
    await db_session.commit()

    return {**scene, "body": body, "solid": solid}


# ---------------------------------------------------------------------------
# LS-1: empty list before any build
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_litho_solids_empty_before_build(
    async_client: AsyncClient,
    scene: dict,
) -> None:
    """GET .../litho-solids must return an empty list when no build has run."""
    proj = scene["project"]
    litho = scene["litho"]

    resp = await async_client.get(f"/projects/{proj.id}/geology/models/{litho.id}/litho-solids")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


# ---------------------------------------------------------------------------
# LS-2: seeded solid rows come back with joined body attributes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_litho_solids_returns_seeded_rows(
    async_client: AsyncClient,
    solid_scene: dict,
) -> None:
    """GET .../litho-solids returns the cached rows + BodyOrm join columns."""
    proj = solid_scene["project"]
    litho = solid_scene["litho"]
    body = solid_scene["body"]
    solid = solid_scene["solid"]

    resp = await async_client.get(f"/projects/{proj.id}/geology/models/{litho.id}/litho-solids")
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == str(solid.id)
    assert row["body_id"] == str(body.id)
    assert row["method"] == "voxel"
    assert row["is_stale"] is False
    assert row["is_flagged"] is False
    assert row["body_ordinal"] == 0
    assert row["display_color"] is None
    assert len(row["vertices"]) == 3
    assert len(row["triangles"]) == 1


# ---------------------------------------------------------------------------
# LS-4: PATCH .../bodies/{body_id}/color persists and is reflected in GET
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_body_color_persists_and_appears_in_get(
    async_client: AsyncClient,
    solid_scene: dict,
) -> None:
    """PATCH .../bodies/{body_id}/color must persist the colour; a subsequent
    GET .../litho-solids must include the updated ``display_color`` in the
    matching solid response.
    """
    proj = solid_scene["project"]
    litho = solid_scene["litho"]
    body_id = str(solid_scene["body"].id)
    base = f"/projects/{proj.id}/geology/models/{litho.id}"

    # Patch the colour.
    patch_resp = await async_client.patch(
        f"{base}/bodies/{body_id}/color",
        json={"display_color": "#deadbe"},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    patch_data = patch_resp.json()
    assert patch_data["body_id"] == body_id
    assert patch_data["display_color"] == "#deadbe"

    # GET must reflect the new colour.
    get_resp = await async_client.get(f"{base}/litho-solids")
    assert get_resp.status_code == 200, get_resp.text
    matching = [s for s in get_resp.json() if s["body_id"] == body_id]
    assert matching, "Solid for the patched body must appear in GET response"
    assert matching[0]["display_color"] == "#deadbe", (
        f"Expected display_color='#deadbe'; got {matching[0]['display_color']!r}"
    )

    # Verify reset to null also works.
    reset_resp = await async_client.patch(
        f"{base}/bodies/{body_id}/color",
        json={"display_color": None},
    )
    assert reset_resp.status_code == 200, reset_resp.text
    assert reset_resp.json()["display_color"] is None

    get_after_reset = await async_client.get(f"{base}/litho-solids")
    assert get_after_reset.status_code == 200
    matching_reset = [s for s in get_after_reset.json() if s["body_id"] == body_id]
    assert matching_reset[0]["display_color"] is None


# ---------------------------------------------------------------------------
# LS-6 / LS-8: cross-project IDOR guards
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def idor_scene(db_session: AsyncSession) -> dict:
    """Two independent projects.

    project_a: litho model + seeded body + cached solid.
    project_b: litho model (empty).

    IDOR tests hit project_a endpoints using project_b's id.
    """
    # ---- project A ---------------------------------------------------------
    proj_a = ProjectOrm(id=uuid7(), name="LS-IDOR-A", status="active")
    db_session.add(proj_a)
    await db_session.flush()

    geo_a = GeologicalModelOrm(id=uuid7(), app_project_id=proj_a.id, name="G-A", kind="geological")
    litho_a = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj_a.id,
        name="L-A",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_a.id,
    )
    db_session.add_all([geo_a, litho_a])
    await db_session.flush()

    formation_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj_a.id,
        name="IDOR-F",
        color="#ccc",
        display_order=0,
    )
    db_session.add(formation_a)
    await db_session.flush()

    body_a = _body(proj_a.id, litho_a.id, formation_a.id)
    db_session.add(body_a)
    await db_session.flush()
    db_session.add(_solid(litho_a.id, body_a, formation_a.id))

    # ---- project B ---------------------------------------------------------
    proj_b = ProjectOrm(id=uuid7(), name="LS-IDOR-B", status="active")
    db_session.add(proj_b)
    await db_session.flush()

    geo_b = GeologicalModelOrm(id=uuid7(), app_project_id=proj_b.id, name="G-B", kind="geological")
    litho_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj_b.id,
        name="L-B",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_b.id,
    )
    db_session.add_all([geo_b, litho_b])
    await db_session.commit()

    return {
        "proj_a": proj_a,
        "litho_a": litho_a,
        "body_a": body_a,
        "proj_b": proj_b,
        "litho_b": litho_b,
    }


@pytest.mark.asyncio
async def test_get_litho_solids_wrong_project_returns_404(
    async_client: AsyncClient,
    idor_scene: dict,
) -> None:
    """LS-6: GET .../litho-solids with mismatched project_id must return 404."""
    proj_b = idor_scene["proj_b"]
    litho_a = idor_scene["litho_a"]

    resp = await async_client.get(f"/projects/{proj_b.id}/geology/models/{litho_a.id}/litho-solids")
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_patch_body_color_wrong_project_returns_404(
    async_client: AsyncClient,
    idor_scene: dict,
) -> None:
    """LS-8: PATCH .../bodies/{body_id}/color with mismatched project_id must return 404."""
    proj_b = idor_scene["proj_b"]
    litho_a = idor_scene["litho_a"]
    body_id = str(idor_scene["body_a"].id)

    # PATCH using project_b's id — must be 404, not 200.
    patch_resp = await async_client.patch(
        f"/projects/{proj_b.id}/geology/models/{litho_a.id}/bodies/{body_id}/color",
        json={"display_color": "#evil01"},
    )
    assert patch_resp.status_code == 404, patch_resp.text
