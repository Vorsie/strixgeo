"""Pin the canonical /layers URL for accept-litho-suggestions.

The A4 cut moved the FE writer URL from
``POST /models/{mid}/contacts/accept-litho-suggestions`` to
``POST /models/{mid}/layers/accept-litho-suggestions``. The old
``/contacts/*`` aliases were dual-registered for a transition window
and deleted in the 2026-07 audit sweep (BE-API-04 — backwards compat
is suspended pre-ship). This test pins that:

* the canonical ``/layers/accept-litho-suggestions`` URL responds
* the retired ``/contacts/accept-litho-suggestions`` alias is GONE
  (405 — the path only pattern-matches the contact CRUD routes now)
* the batch endpoint mirrors the same single-URL state
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project_and_model(db_session: AsyncSession) -> dict:
    """Project + 1 BH + 1 litho model (with geo parent)."""
    project = ProjectOrm(id=uuid7(), name="Dual URL", status="active")
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
    geo = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="G", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    db_session.add_all([bh, geo, litho])
    await db_session.commit()
    return {"project": project, "bh": bh, "litho": litho}


async def test_accept_via_layers_url_routes_to_handler(
    async_client: AsyncClient, project_and_model: dict
) -> None:
    """The new layer-prefixed URL routes to the same handler.

    Uses an empty suggestions list which hits the schema's min_length=1
    guard — the 422 response is the proof that routing reached the
    schema (a 404 would mean the URL doesn't exist).
    """
    p = project_and_model
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho'].id}"
        f"/layers/accept-litho-suggestions",
        json={
            "borehole_id": str(p["bh"].id),
            "suggestions": [],
        },
    )
    # 422 (schema rejected) proves routing; 404 would mean URL miss.
    assert resp.status_code == 422, resp.text
    assert "suggestions" in resp.text


async def test_accept_via_contacts_alias_is_gone(
    async_client: AsyncClient, project_and_model: dict
) -> None:
    """The retired /contacts alias no longer routes (BE-API-04).

    405, not 404: the path still pattern-matches the live
    ``PATCH/DELETE /contacts/{contact_id}`` routes, so FastAPI answers
    Method Not Allowed for POST. A live alias would answer 422 (the
    empty-suggestions schema guard) — 405 proves the POST route is gone.
    """
    p = project_and_model
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho'].id}"
        f"/contacts/accept-litho-suggestions",
        json={
            "borehole_id": str(p["bh"].id),
            "suggestions": [],
        },
    )
    assert resp.status_code == 405, resp.text


async def test_batch_accept_via_layers_url_returns_200(
    async_client: AsyncClient, project_and_model: dict
) -> None:
    """Same dual-URL pattern for the batch endpoint."""
    p = project_and_model
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho'].id}"
        f"/layers/batch-accept-litho-suggestions",
        json={
            "anchors": [],
            "section_id": None,
            "run_inference": False,
        },
    )
    assert resp.status_code == 200, resp.text


async def test_batch_accept_via_contacts_alias_is_gone(
    async_client: AsyncClient, project_and_model: dict
) -> None:
    """The retired /contacts batch alias no longer routes (BE-API-04).

    405, not 404 — same reason as the single-accept alias test above:
    the path pattern-matches ``/contacts/{contact_id}`` for PATCH/DELETE,
    so POST answers Method Not Allowed. A live alias would answer 200.
    """
    p = project_and_model
    resp = await async_client.post(
        f"/projects/{p['project'].id}/geology/models/{p['litho'].id}"
        f"/contacts/batch-accept-litho-suggestions",
        json={
            "anchors": [],
            "section_id": None,
            "run_inference": False,
        },
    )
    assert resp.status_code == 405, resp.text
