"""Integration tests for the seed-litho-from-parent endpoint.

Exercises the full HTTP → use-case → DB round-trip for:

  S1  Happy path: seeding a litho model from its parent geological model's
      contacts produces the correct rows in the DB (right model_id,
      source='geological_model_seed', confidence='medium',
      observation_id=None, observation_layer_id=None).

  S2  Idempotency: a second call does not create duplicate contacts;
      ``skipped_existing`` reflects the count.

  S3  Section seed: when ``section_id`` is provided the section's
      ``seeded_formation_contact_ids`` is patched and ``updated_section``
      is returned in the response.

  S4  Guard — non-litho model: posting to a geological model returns 422.

  S5  Guard — scope: posting to a model that does not belong to the project
      returns 404.

All tests use the ``async_client`` fixture from the shared conftest, which
mounts the real FastAPI app via ASGI transport with a test-scoped database.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project."""
    proj = ProjectOrm(id=uuid7(), name="litho seed test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def project_with_borehole(db_session: AsyncSession) -> tuple[ProjectOrm, BoreholeOrm]:
    """A project with one borehole."""
    proj = ProjectOrm(id=uuid7(), name="litho seed borehole", status="active")
    db_session.add(proj)
    await db_session.flush()
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-seed",
        app_project_id=proj.id,
        project_id="DOV",
        test_id="SEED-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(bh)
    await db_session.commit()
    return proj, bh


# ---------------------------------------------------------------------------
# Small HTTP helpers
# ---------------------------------------------------------------------------


async def _create_formation(
    client: AsyncClient,
    project_id,  # noqa: ANN001
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


async def _create_geo_model(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    *,
    name: str = "Geo",
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": name, "kind": "geological"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_litho_model(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    parent_id: str,
    *,
    name: str = "Litho",
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": name, "kind": "lithostratigraphic", "parent_geological_model_id": parent_id},
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


async def _seed_litho(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    model_id: str,
    borehole_ids: list,
    *,
    section_id: str | None = None,
) -> dict:
    body: dict = {"borehole_ids": [str(bid) for bid in borehole_ids]}
    if section_id is not None:
        body["section_id"] = section_id
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{model_id}/contacts/seed-from-parent",
        json=body,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# S1 — Happy path
# ---------------------------------------------------------------------------


async def test_s1_seed_copies_contacts_with_correct_provenance(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Seeding the litho model from the parent copies contacts with correct source/confidence.

    Verifies:
    - The correct number of contacts exist in the litho model after seeding.
    - source == 'geological_model_seed'.
    - confidence == 'medium'.
    - observation_id is None.
    - observation_layer_id is None.
    - depth_top_m matches the parent contact.
    """
    project, borehole = project_with_borehole

    # Setup: geological model → contact at depth 3.0
    formation = await _create_formation(async_client, project.id)
    geo_model = await _create_geo_model(async_client, project.id)
    await _create_contact(
        async_client,
        project.id,
        geo_model["id"],
        formation["id"],
        borehole.id,
        depth=3.0,
    )
    litho_model = await _create_litho_model(async_client, project.id, geo_model["id"])

    # Seed the litho model
    result = await _seed_litho(
        async_client,
        project.id,
        litho_model["id"],
        [borehole.id],
    )

    assert len(result["created_contact_ids"]) == 1
    assert result["skipped_existing"] == 0
    assert result["updated_section"] is None

    # Verify via GET that the litho contact has the right fields
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{litho_model['id']}/contacts"
    )
    assert resp.status_code == 200
    contacts = resp.json()
    assert len(contacts) == 1
    c = contacts[0]
    # A4 cleanup: SeedLithoFromGeologicalModel now writes LithoLayer with
    # source='manual' (no seed-specific value in the layer source enum).
    # The LL→FC trigger maps that to FC source='manual_pick' on the
    # mirror — so the FC the /contacts GET returns has 'manual_pick',
    # not the legacy 'geological_model_seed' literal.
    assert c["source"] == "manual_pick"
    assert c["confidence"] == "medium"
    assert c["observation_id"] is None
    assert c["observation_layer_id"] is None
    assert c["depth_top_m"] == 3.0
    assert c["formation_id"] == formation["id"]
    assert c["borehole_id"] == str(borehole.id)


# ---------------------------------------------------------------------------
# S2 — Idempotency
# ---------------------------------------------------------------------------


async def test_s2_idempotent_second_run_skips_existing(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """A second seed call skips already-existing (formation, borehole) pairs."""
    project, borehole = project_with_borehole

    formation = await _create_formation(async_client, project.id)
    geo_model = await _create_geo_model(async_client, project.id)
    await _create_contact(
        async_client,
        project.id,
        geo_model["id"],
        formation["id"],
        borehole.id,
        depth=1.0,
    )
    litho_model = await _create_litho_model(async_client, project.id, geo_model["id"])

    # First call — creates contact
    first = await _seed_litho(async_client, project.id, litho_model["id"], [borehole.id])
    assert len(first["created_contact_ids"]) == 1
    assert first["skipped_existing"] == 0

    # Second call — idempotent: skips the existing pair
    second = await _seed_litho(async_client, project.id, litho_model["id"], [borehole.id])
    assert second["created_contact_ids"] == []
    assert second["skipped_existing"] == 1

    # DB should still have exactly ONE litho contact
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{litho_model['id']}/contacts"
    )
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# S3 — Section seed: explicit-content invariant
# ---------------------------------------------------------------------------


async def test_s3_section_id_patches_seeded_set(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
    db_session: AsyncSession,
) -> None:
    """When section_id is provided the section's seeded_formation_contact_ids is updated."""
    project, borehole = project_with_borehole

    formation = await _create_formation(async_client, project.id)
    geo_model = await _create_geo_model(async_client, project.id)
    await _create_contact(
        async_client,
        project.id,
        geo_model["id"],
        formation["id"],
        borehole.id,
        depth=2.5,
    )
    litho_model = await _create_litho_model(async_client, project.id, geo_model["id"])

    # Create a cross-section in the project
    section_resp = await async_client.post(
        f"/projects/{project.id}/sections",
        json={
            "name": "S-1",
            "start_x": 150000.0,
            "start_y": 200000.0,
            "end_x": 151000.0,
            "end_y": 200000.0,
            "epsg": 31370,
        },
    )
    assert section_resp.status_code == 201, section_resp.text
    section_id = section_resp.json()["id"]

    # Seed with section_id
    result = await _seed_litho(
        async_client,
        project.id,
        litho_model["id"],
        [borehole.id],
        section_id=section_id,
    )

    assert len(result["created_contact_ids"]) == 1
    # updated_section must be echoed back
    assert result["updated_section"] is not None
    assert result["updated_section"]["id"] == section_id
    # The created contact id must appear in the section's seeded set
    seeded_ids = result["updated_section"]["seeded_formation_contact_ids"]
    assert result["created_contact_ids"][0] in seeded_ids


# ---------------------------------------------------------------------------
# S4 — Guard: non-litho model → 422
# ---------------------------------------------------------------------------


async def test_s4_geological_model_returns_422(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Posting to a geological model (not lithostratigraphic) returns 422."""
    project, borehole = project_with_borehole

    geo_model = await _create_geo_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{geo_model['id']}/contacts/seed-from-parent",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert resp.status_code == 422
    assert "invalid_model_kind" in resp.text


# ---------------------------------------------------------------------------
# S5 — Guard: wrong project → 404
# ---------------------------------------------------------------------------


async def test_s5_wrong_project_returns_404(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
    db_session: AsyncSession,
) -> None:
    """Posting with a model from another project returns 404 (scope guard)."""
    project_a, borehole = project_with_borehole

    geo_a = await _create_geo_model(async_client, project_a.id)
    litho_a = await _create_litho_model(async_client, project_a.id, geo_a["id"])

    # Create a second project
    project_b = ProjectOrm(id=uuid7(), name="project B", status="active")
    db_session.add(project_b)
    await db_session.commit()

    # URL says project_b, but litho_a belongs to project_a
    resp = await async_client.post(
        f"/projects/{project_b.id}/geology/models/{litho_a['id']}/contacts/seed-from-parent",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert resp.status_code == 404
