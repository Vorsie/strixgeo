"""HTTP-level tests for the geology router (debt #22).

Focus: the new application-layer wiring + the scope guards on
contact endpoints. CRUD semantics are already pinned by the
repository tests in ``tests/integration/db/test_geology_repository.py``;
these tests only assert what the API layer adds — status codes,
JSON shape, cross-project tampering rejection, and the use-case
side effects observable through the response.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project_with_borehole(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, BoreholeOrm]:
    """Set up a project + one 10 m borehole for contact-anchoring tests."""
    project = ProjectOrm(id=uuid7(), name="API geology test", status="active")
    db_session.add(project)
    await db_session.flush()
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(borehole)
    await db_session.commit()
    return project, borehole


# ---------------------------------------------------------------------------
# Contact create — CreateFormationContact use case
# ---------------------------------------------------------------------------


async def test_create_contact_returns_201_and_persisted_row(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """POST through the use case returns 201 + the full response shape."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "depth_top_m": 0.0,
            "source": "manual_pick",
            "confidence": "high",
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["formation_id"] == formation["id"]
    assert body["borehole_id"] == str(borehole.id)
    assert body["cpt_id"] is None
    assert body["depth_top_m"] == 0.0
    assert body["confidence"] == "high"
    # Server-generated fields populated.
    assert body["id"]
    assert body["created_at"]
    assert body["updated_at"]


async def test_create_contact_rejects_both_anchors(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Pydantic XOR rejection lands at the 422 boundary, never reaches the use case."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "cpt_id": str(uuid7()),
            "depth_top_m": 1.0,
        },
    )

    # Pydantic's ``model_validator`` raises before the route body runs.
    assert resp.status_code == 422


async def test_create_contact_rejects_wrong_project_model(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Posting a contact under a model from another project returns 404."""
    project_a, borehole = project_with_borehole
    formation = await _create_formation(async_client, project_a.id)

    # Build a second project and a model that lives under it.
    project_b = ProjectOrm(id=uuid7(), name="Other project", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    # URL says project_a, but model belongs to project_b — scope guard kicks in.
    resp = await async_client.post(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "depth_top_m": 0.0,
        },
    )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Contact update — UpdateFormationContact use case
# ---------------------------------------------------------------------------


async def test_update_contact_applies_patch(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """PATCH updates only the supplied fields; others stay as the create set them."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={"depth_top_m": 3.0, "notes": "Re-picked"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["depth_top_m"] == 3.0
    assert body["notes"] == "Re-picked"
    # Confidence unchanged from create-time default.
    assert body["confidence"] == "medium"


# ---------------------------------------------------------------------------
# Contact delete — DeleteFormationContact use case
# ---------------------------------------------------------------------------


async def test_delete_contact_returns_204_and_drops_row(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """DELETE returns 204 and a follow-up list does not see the row."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=0.0
    )

    del_resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
    )
    assert del_resp.status_code == 204

    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []


# ---------------------------------------------------------------------------
# Validate-no-gaps — ValidateBoreholeStratigraphy use case
# ---------------------------------------------------------------------------


async def test_validate_no_gaps_empty_model_reports_no_contacts(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """The 'no model picked yet' edge case surfaces as a single ``no_contacts`` issue."""
    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/boreholes/{borehole.id}/validate",
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["model_id"] == model["id"]
    assert body["borehole_id"] == str(borehole.id)
    assert [i["kind"] for i in body["issues"]] == ["no_contacts"]


async def test_validate_no_gaps_happy_path_empty_issues(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Surface + 2 m contact on a 10 m borehole reports no issues."""
    project, borehole = project_with_borehole
    quaternary = await _create_formation(async_client, project.id, name="Quaternary")
    boom = await _create_formation(async_client, project.id, name="Boom Klei")
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], quaternary["id"], borehole.id, depth=0.0
    )
    await _create_contact(async_client, project.id, model["id"], boom["id"], borehole.id, depth=2.0)

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/boreholes/{borehole.id}/validate",
    )

    assert resp.status_code == 200
    assert resp.json()["issues"] == []


async def test_validate_no_gaps_wrong_project_returns_404(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Asking project A to validate a model that lives in project B is rejected."""
    project_a, borehole = project_with_borehole

    project_b = ProjectOrm(id=uuid7(), name="Other project", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    resp = await async_client.get(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/boreholes/{borehole.id}/validate",
    )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Small helpers — wrap repetitive POSTs that every test needs.
# ---------------------------------------------------------------------------


async def _create_formation(
    client: AsyncClient,
    project_id,  # noqa: ANN001 — UUID-or-str, both serialise the same in URLs
    *,
    name: str = "F",
    color: str = "#aaa",
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/formations",
        json={"name": name, "color": color},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_model(client: AsyncClient, project_id) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": "Model"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_contact(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    model_id: str,
    formation_id: str,
    borehole_id,  # noqa: ANN001
    *,
    depth: float,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{model_id}/contacts",
        json={
            "formation_id": formation_id,
            "borehole_id": str(borehole_id),
            "depth_top_m": depth,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
