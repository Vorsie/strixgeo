"""HTTP-level integration tests for PATCH /contact-correlations/admixtures.

Pins the contract the frontend depends on:

  PATCH .../contact-correlations/admixtures  →  200 with updated formation list.

Structural claims
-----------------
PA1  Seed-only (no edges) — response includes exactly the seed; admixtures written.
PA2  Two correlated formations — both appear in the response with new admixtures.
PA3  Empty admixtures list → clears admixtures on the component.
PA4  Unknown model_id → 404.
PA5  Seed formation from a different project → 422.
PA6  Model of kind 'geological' → 422.
PA7  Seed with no litho_main_soil_code → 422.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for propagation tests."""
    proj = ProjectOrm(id=uuid7(), name="propagate admixtures test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def litho_model(project: ProjectOrm, db_session: AsyncSession) -> GeologicalModelOrm:
    """A lithostratigraphic model owned by ``project``."""
    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo",
        kind="geological",
    )
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.commit()
    return litho


def _litho_formation(
    project_id,  # noqa: ANN001
    soil_code: str = "ZAND",
    admixtures: list | None = None,
) -> GeologicalFormationOrm:
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=soil_code,
        color="#aaa",
        display_order=0,
        litho_main_soil_code=soil_code,
        litho_admixtures=admixtures or [],
    )


def _geo_formation(project_id) -> GeologicalFormationOrm:  # noqa: ANN001
    """A geological-model formation (no litho_main_soil_code)."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Boom Klei",
        color="#888",
        display_order=0,
        litho_main_soil_code=None,
    )


def _borehole(project_id, *, suffix: str, x: float = 150000.0) -> BoreholeOrm:  # noqa: ANN001
    """Minimal borehole to anchor a formation contact."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="PA",
        test_id=f"BH-PA-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
) -> FormationContactOrm:
    """A formation_contact anchored to a borehole at ``depth``."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source="borehole_observation",
        confidence="medium",
    )


def _contact_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
    *,
    user_approved: bool = True,
) -> LithoContactCorrelationEdgeOrm:
    """Contact-level correlation edge between two contacts (canonical order)."""
    a_id = min(ca.id, cb.id)
    b_id = max(ca.id, cb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=user_approved,
    )


_ADMIXTURES = [{"soil_code": "KL", "amount": "M", "locally": False}]
_ADMIXTURES_NEW = [
    {"soil_code": "SL", "amount": "S", "locally": True},
    {"soil_code": "KL", "amount": "W", "locally": False},
]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_pa1_seed_only_no_edges(
    async_client: AsyncClient,
    project: ProjectOrm,
    litho_model: GeologicalModelOrm,
    db_session: AsyncSession,
) -> None:
    """PA1: No correlation edges → only the seed is updated."""
    fa = _litho_formation(project.id, admixtures=_ADMIXTURES)
    db_session.add(fa)
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_model.id}"
    resp = await async_client.patch(
        f"{base}/contact-correlations/admixtures",
        json={"formation_id": str(fa.id), "admixtures": _ADMIXTURES_NEW},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["component_size"] == 1
    assert len(body["updated_formations"]) == 1
    f_resp = body["updated_formations"][0]
    assert f_resp["id"] == str(fa.id)
    assert f_resp["litho_admixtures"] == _ADMIXTURES_NEW


async def test_pa2_two_correlated_formations(
    async_client: AsyncClient,
    project: ProjectOrm,
    litho_model: GeologicalModelOrm,
    db_session: AsyncSession,
) -> None:
    """PA2: Two correlated formations → both get new admixtures; component_size == 2.

    Uses a user_approved=True contact-level edge between two formation_contacts
    (one per formation, each on its own borehole) — the contact-edge graph is
    the propagation authority since #133 Phase 3.
    """
    fa = _litho_formation(project.id, admixtures=[])
    fb = _litho_formation(project.id, admixtures=[])
    bh_a = _borehole(project.id, suffix="pa2-a", x=150000.0)
    bh_b = _borehole(project.id, suffix="pa2-b", x=150300.0)
    db_session.add_all([fa, fb, bh_a, bh_b])
    await db_session.flush()
    ca = _contact(litho_model, fa, bh_a, depth=3.0)
    cb = _contact(litho_model, fb, bh_b, depth=4.0)
    db_session.add_all([ca, cb])
    await db_session.flush()
    edge = _contact_edge(litho_model, ca, cb, user_approved=True)
    db_session.add(edge)
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_model.id}"
    resp = await async_client.patch(
        f"{base}/contact-correlations/admixtures",
        json={"formation_id": str(fa.id), "admixtures": _ADMIXTURES_NEW},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["component_size"] == 2
    assert len(body["updated_formations"]) == 2
    returned_ids = {f["id"] for f in body["updated_formations"]}
    assert returned_ids == {str(fa.id), str(fb.id)}
    for f in body["updated_formations"]:
        assert f["litho_admixtures"] == _ADMIXTURES_NEW


async def test_pa3_empty_admixtures_clears(
    async_client: AsyncClient,
    project: ProjectOrm,
    litho_model: GeologicalModelOrm,
    db_session: AsyncSession,
) -> None:
    """PA3: Empty admixtures → admixtures cleared to []."""
    fa = _litho_formation(project.id, admixtures=_ADMIXTURES)
    db_session.add(fa)
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_model.id}"
    resp = await async_client.patch(
        f"{base}/contact-correlations/admixtures",
        json={"formation_id": str(fa.id), "admixtures": []},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated_formations"][0]["litho_admixtures"] == []


async def test_pa4_unknown_model_404(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """PA4: Unknown model_id → 404."""
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{uuid7()}/contact-correlations/admixtures",
        json={"formation_id": str(uuid7()), "admixtures": []},
    )
    assert resp.status_code == 404, resp.text


async def test_pa5_seed_from_different_project_422(
    async_client: AsyncClient,
    project: ProjectOrm,
    litho_model: GeologicalModelOrm,
    db_session: AsyncSession,
) -> None:
    """PA5: Seed formation from a different project → 422."""
    other = ProjectOrm(id=uuid7(), name="other", status="active")
    db_session.add(other)
    foreign = _litho_formation(other.id)
    db_session.add(foreign)
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_model.id}"
    resp = await async_client.patch(
        f"{base}/contact-correlations/admixtures",
        json={"formation_id": str(foreign.id), "admixtures": []},
    )
    assert resp.status_code == 422, resp.text


async def test_pa6_geological_model_422(
    async_client: AsyncClient,
    project: ProjectOrm,
    db_session: AsyncSession,
) -> None:
    """PA6: PATCH on a geological (non-litho) model → 422."""
    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo only",
        kind="geological",
    )
    fa = _litho_formation(project.id)
    db_session.add_all([geo, fa])
    await db_session.commit()

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{geo.id}/contact-correlations/admixtures",
        json={"formation_id": str(fa.id), "admixtures": []},
    )
    assert resp.status_code == 422, resp.text


async def test_pa7_seed_no_litho_main_soil_code_422(
    async_client: AsyncClient,
    project: ProjectOrm,
    litho_model: GeologicalModelOrm,
    db_session: AsyncSession,
) -> None:
    """PA7: Seed is a geological-model formation (no litho_main_soil_code) → 422."""
    geo_row = _geo_formation(project.id)
    db_session.add(geo_row)
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_model.id}"
    resp = await async_client.patch(
        f"{base}/contact-correlations/admixtures",
        json={"formation_id": str(geo_row.id), "admixtures": []},
    )
    assert resp.status_code == 422, resp.text
