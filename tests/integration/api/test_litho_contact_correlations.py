"""HTTP-level tests for the litho contact-correlation endpoints (#133 Phase 1).

Pins the contract:

* POST creates a contact-level edge (201) and is idempotent (200 on re-call).
* DELETE removes it and is idempotent (204 whether or not it existed).
* POST after DELETE re-creates a fresh edge.
* Self-loop (contact_a == contact_b) is 422.
* Cross-project model is 404.
* Same-investigation contacts are 422.
* Source validation: 'manual' → 201; anything else → 422.
* GET returns the current edge list (possibly empty).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for contact-correlation tests."""
    proj = ProjectOrm(id=uuid7(), name="contact correlation test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def two_contacts_in_litho_model(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project: ProjectOrm,
) -> tuple[str, str, str, str]:
    """Create a litho model + two boreholes + two contacts + a section.

    Returns ``(model_id, ca_id, cb_id, section_id)``.

    Contacts are anchored to different boreholes so the same-investigation
    guard does not fire.  The formations are kept minimal (no litho_main_soil_code)
    because contact-level edges do not enforce same-naming-group.

    ``section_id`` must be passed as ``request_section_id`` in every POST
    body — ``CorrelateLithoContacts`` raises ``ValueError`` when it is ``None``
    (section-scoped invariant, owner directive 2026-06-08).
    """
    # Geological model.
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo-CC", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_id = geo_resp.json()["id"]

    # Lithostratigraphic model.
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho-CC",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": geo_id,
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_id = litho_resp.json()["id"]

    # One formation (contacts must reference an existing formation).
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-CC",
        color="#aabbcc",
        display_order=0,
    )
    db_session.add(formation)

    # Two boreholes on different coordinates.
    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-CC-A",
        app_project_id=project.id,
        project_id="CC",
        test_id="BH-CC-001",
        location_x=150100.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    bh_b = BoreholeOrm(
        id=uuid7(),
        name="BH-CC-B",
        app_project_id=project.id,
        project_id="CC",
        test_id="BH-CC-002",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_a, bh_b])
    await db_session.flush()

    # Two contacts — one per borehole — in the litho model.
    model_orm = await db_session.get(GeologicalModelOrm, litho_id)
    assert model_orm is not None

    ca = FormationContactOrm(
        id=uuid7(),
        model_id=model_orm.id,
        formation_id=formation.id,
        borehole_id=bh_a.id,
        depth_top_m=3.0,
        source="borehole_observation",
        confidence="medium",
    )
    cb = FormationContactOrm(
        id=uuid7(),
        model_id=model_orm.id,
        formation_id=formation.id,
        borehole_id=bh_b.id,
        depth_top_m=4.0,
        source="borehole_observation",
        confidence="medium",
    )
    db_session.add_all([ca, cb])
    await db_session.flush()

    # A section spanning both boreholes — required so POST /contact-correlations
    # can satisfy the section-scoped invariant (request_section_id must be non-null).
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec-CC",
        start_x=150050.0,
        start_y=200000.0,
        end_x=150350.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=500.0,
        seeded_formation_contact_ids=[],
    )
    db_session.add(section)
    await db_session.commit()

    return litho_id, str(ca.id), str(cb.id), str(section.id)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_create_then_idempotent(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """First POST -> 201; identical re-POST -> 200 (same edge, idempotent)."""
    litho_id, ca, cb, sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    r1 = await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    assert body1["was_created"] is True
    assert "edge_id" in body1

    # Re-POST with endpoints swapped — canonical ordering makes it the same edge.
    r2 = await async_client.post(
        base, json={"contact_a_id": cb, "contact_b_id": ca, "request_section_id": sid}
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["was_created"] is False
    assert body2["edge_id"] == body1["edge_id"]


async def test_delete_then_idempotent(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """First DELETE after create -> 204; second DELETE (no edge) -> 204 (idempotent)."""
    litho_id, ca, cb, sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )

    r_del = await async_client.request(
        "DELETE", base, json={"contact_a_id": ca, "contact_b_id": cb}
    )
    assert r_del.status_code == 204, r_del.text

    # Second delete with nothing left — still 204.
    r_del2 = await async_client.request(
        "DELETE", base, json={"contact_a_id": ca, "contact_b_id": cb}
    )
    assert r_del2.status_code == 204, r_del2.text


async def test_recreate_after_delete(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """POST after DELETE creates a fresh edge (new id)."""
    litho_id, ca, cb, sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    r1 = await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )
    assert r1.status_code == 201, r1.text
    edge_id_first = r1.json()["edge_id"]

    await async_client.request("DELETE", base, json={"contact_a_id": ca, "contact_b_id": cb})

    r2 = await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["was_created"] is True
    # New row → new id (uuid7 is monotone).
    assert r2.json()["edge_id"] != edge_id_first


async def test_self_loop_is_422(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """contact_a == contact_b -> 422 at the API boundary."""
    litho_id, ca, _cb, _sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    r = await async_client.post(base, json={"contact_a_id": ca, "contact_b_id": ca})
    assert r.status_code == 422, r.text


async def test_cross_lithology_correlation_is_allowed_as_surface_tie(
    async_client: AsyncClient,
    project: ProjectOrm,
    db_session: AsyncSession,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """A correlation between two DIFFERENT lithologies is now allowed (201).

    It is a *surface tie* (the boundary is one continuous surface even though
    the material differs). The resolver still drops cross-lithology edges from
    body formation (covered by test_resolve_litho_instances), so this never
    creates a mixed-lithology body — it is a pure surface correlation.
    """
    from uuid import UUID

    litho_id, ca, cb, sid = two_contacts_in_litho_model
    # Give the two endpoints distinct lithologies: ca → ZAND, cb → KLEI.
    ca_contact = await db_session.get(FormationContactOrm, UUID(ca))
    assert ca_contact is not None
    sand = await db_session.get(GeologicalFormationOrm, ca_contact.formation_id)
    assert sand is not None
    sand.litho_main_soil_code = "ZAND"
    clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI-CC",
        color="#6b7280",
        display_order=1,
        litho_main_soil_code="KLEI",
    )
    db_session.add(clay)
    cb_contact = await db_session.get(FormationContactOrm, UUID(cb))
    assert cb_contact is not None
    cb_contact.formation_id = clay.id
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"
    r = await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )
    assert r.status_code == 201, r.text

    # The tie persists and is listed like any other edge.
    listed = await async_client.get(base)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1


async def test_cross_project_model_is_404(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """Model from a different project -> 404 (IDOR guard)."""
    other_proj_id = uuid7()
    litho_id, ca, cb, _sid = two_contacts_in_litho_model
    base = f"/projects/{other_proj_id}/geology/models/{litho_id}/contact-correlations"

    r = await async_client.post(base, json={"contact_a_id": ca, "contact_b_id": cb})
    assert r.status_code == 404, r.text


async def test_source_validation(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """source='manual' -> 201; any other token -> 422."""
    litho_id, ca, cb, sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    ok = await async_client.post(
        base,
        json={
            "contact_a_id": ca,
            "contact_b_id": cb,
            "source": "manual",
            "request_section_id": sid,
        },
    )
    assert ok.status_code == 201, ok.text

    # Delete so we can test the bad-source path fresh.
    await async_client.request("DELETE", base, json={"contact_a_id": ca, "contact_b_id": cb})

    bad = await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "source": "g3dv3_seed"}
    )
    assert bad.status_code == 422, bad.text


async def test_list_returns_empty_for_fresh_model(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """GET on a fresh model -> 200 empty list."""
    litho_id, _ca, _cb, _sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    r = await async_client.get(base)
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_list_returns_created_edges(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """GET returns created edges with correct fields."""
    litho_id, ca, cb, sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )

    r = await async_client.get(base)
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) == 1
    item = items[0]
    assert "id" in item
    assert "contact_a_id" in item
    assert "contact_b_id" in item
    assert "source" in item
    assert item["source"] == "manual"
    assert "created_at" in item


async def test_list_empty_after_delete(
    async_client: AsyncClient,
    project: ProjectOrm,
    two_contacts_in_litho_model: tuple[str, str, str, str],
) -> None:
    """GET returns empty list after the edge is deleted."""
    litho_id, ca, cb, sid = two_contacts_in_litho_model
    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"

    await async_client.post(
        base, json={"contact_a_id": ca, "contact_b_id": cb, "request_section_id": sid}
    )
    await async_client.request("DELETE", base, json={"contact_a_id": ca, "contact_b_id": cb})

    r = await async_client.get(base)
    assert r.status_code == 200, r.text
    assert r.json() == []
