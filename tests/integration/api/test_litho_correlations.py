"""HTTP-level tests for the litho-correlation endpoints (Phase-2 Slice 1).

Pins the contract the frontend depends on:

* POST creates an edge (201) and is idempotent (200 on re-call).
* DELETE removes it and is idempotent (204 whether or not it existed).
* POST after DELETE creates a fresh edge.
* Self-loop and cross-project / cross-group are 422.
* The endpoints are MODEL-level: they take no ``section_id`` and the
  request schema has no section field — the structural reason the
  #57/applyUpdatedSection trap cannot recur here (correlations never
  touch ``seeded_formation_contact_ids``). The connected-component
  ordinal maths is exhaustively covered by the resolver + use-case
  unit tests; this only asserts the HTTP wiring + status contract.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for correlation tests."""
    proj = ProjectOrm(id=uuid7(), name="litho correlation test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


async def _geo_model(client: AsyncClient, project_id) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _litho_model(client: AsyncClient, project_id, parent_id: str) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": parent_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _formation(client: AsyncClient, project_id, name: str) -> dict:  # noqa: ANN001
    # Plain create → parent_formation_id=null, litho_main_soil_code=null,
    # so two of these share the (null, null) naming group and may be
    # correlated.
    resp = await client.post(
        f"/projects/{project_id}/geology/formations",
        json={"name": name, "color": "#aaa"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _two_formations_in_litho_model(client: AsyncClient, project_id) -> tuple[str, str, str]:  # noqa: ANN001
    """Return (litho_model_id, formation_a_id, formation_b_id)."""
    geo = await _geo_model(client, project_id)
    litho = await _litho_model(client, project_id, geo["id"])
    fa = await _formation(client, project_id, "ZAND occ A")
    fb = await _formation(client, project_id, "ZAND occ B")
    return litho["id"], fa["id"], fb["id"]


async def test_correlate_creates_then_idempotent(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """First POST → 201; identical re-POST → 200 (same edge, idempotent)."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}/correlations"

    r1 = await async_client.post(base, json={"formation_a_id": a, "formation_b_id": b})
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    assert body1["was_created"] is True
    assert "edge_id" in body1
    assert isinstance(body1["instance_ordinals_updated"], list)

    # Re-POST with the endpoints swapped — canonical ordering means it is
    # the SAME edge → 200, not a duplicate 201.
    r2 = await async_client.post(base, json={"formation_a_id": b, "formation_b_id": a})
    assert r2.status_code == 200, r2.text
    assert r2.json()["was_created"] is False
    assert r2.json()["edge_id"] == body1["edge_id"]


async def test_uncorrelate_idempotent_and_recreate(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """DELETE is 204 whether or not the edge exists; POST after DELETE re-creates."""
    mid, a, b = await _two_formations_in_litho_model(async_client, project.id)
    base = f"/projects/{project.id}/geology/models/{mid}/correlations"

    await async_client.post(base, json={"formation_a_id": a, "formation_b_id": b})

    d1 = await async_client.request("DELETE", base, json={"formation_a_id": a, "formation_b_id": b})
    assert d1.status_code == 204, d1.text
    # Idempotent: deleting a non-existent edge is still 204.
    d2 = await async_client.request("DELETE", base, json={"formation_a_id": a, "formation_b_id": b})
    assert d2.status_code == 204, d2.text

    # Re-create after delete → a fresh 201.
    r = await async_client.post(base, json={"formation_a_id": a, "formation_b_id": b})
    assert r.status_code == 201, r.text
    assert r.json()["was_created"] is True


async def test_self_loop_is_422(async_client: AsyncClient, project: ProjectOrm) -> None:
    """Correlating a formation with itself is rejected at the API boundary."""
    mid, a, _ = await _two_formations_in_litho_model(async_client, project.id)
    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": a, "formation_b_id": a},
    )
    assert r.status_code == 422, r.text


async def test_cross_project_formation_is_rejected(
    async_client: AsyncClient, project: ProjectOrm, db_session: AsyncSession
) -> None:
    """A formation from another project cannot be correlated into this model."""
    mid, a, _ = await _two_formations_in_litho_model(async_client, project.id)

    other = ProjectOrm(id=uuid7(), name="other proj", status="active")
    db_session.add(other)
    await db_session.commit()
    foreign = await _formation(async_client, other.id, "foreign ZAND")

    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{mid}/correlations",
        json={"formation_a_id": a, "formation_b_id": foreign["id"]},
    )
    assert r.status_code == 422, r.text


async def test_cross_group_different_soil_code_is_422(
    async_client: AsyncClient, project: ProjectOrm, db_session: AsyncSession
) -> None:
    """Two formations in different (parent, soil) groups can't be correlated.

    The resolver only groups within a single (parent_formation_id,
    litho_main_soil_code) bucket; an edge across groups is meaningless
    and rejected at the use case (→ 422). DoD structural-error path at
    the integration level (review S3).
    """
    geo = await _geo_model(async_client, project.id)
    litho = await _litho_model(async_client, project.id, geo["id"])
    # Plain POST /formations has no litho_main_soil_code field, so set
    # the differing codes directly on the ORM rows.
    f_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND A",
        color="#aaa",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    f_clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI A",
        color="#aaa",
        display_order=1,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([f_sand, f_clay])
    await db_session.commit()

    r = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho['id']}/correlations",
        json={"formation_a_id": str(f_sand.id), "formation_b_id": str(f_clay.id)},
    )
    assert r.status_code == 422, r.text
