"""HTTP-level tests for the body extent endpoints (C1 audit fix).

Coverage:
  C1  POST /models/{mid}/bodies with a detector-set 'to_target' extent on the
      target side returns 409 + ``{"code": "provenance_violation"}``, not 422.

These tests assert routing + error-mapping only.  Use-case semantics (the
provenance rule itself) are pinned by ``test_claim_body_extent.py``.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def bodies_api_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm, BoreholeOrm, BoreholeOrm]:
    """Minimal project + lithostratigraphic model + formation + two boreholes."""
    project = ProjectOrm(id=uuid7(), name="Bodies API test", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-API",
        kind="geological",
    )
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-API",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI-API",
        color="#aabbcc",
        display_order=0,
        instance_ordinal=0,
    )
    db_session.add(formation)
    await db_session.flush()

    bh_source = BoreholeOrm(
        id=uuid7(),
        name="BH-SRC",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-SRC-API",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    bh_neighbour = BoreholeOrm(
        id=uuid7(),
        name="BH-NBR",
        app_project_id=project.id,
        project_id="API",
        test_id="BH-NBR-API",
        location_x=150300.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_source, bh_neighbour])
    await db_session.commit()
    return project, litho, formation, bh_source, bh_neighbour


# ---------------------------------------------------------------------------
# C1: provenance violation → 409, not 422
# ---------------------------------------------------------------------------


import pytest  # noqa: E402  (after fixture import so ruff is happy)


@pytest.mark.asyncio
async def test_claim_body_extent_provenance_violation_returns_409(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """C1 (audit fix): POST /models/{mid}/bodies when the requested side already
    carries a detector-set ``to_target`` extent must return 409 + a body with
    ``code == 'provenance_violation'``, NOT 422.

    This is the guard that makes ``ProvenanceConflictDialog`` reachable on the
    frontend — the frontend gates the dialog open on HTTP 409 (a
    ``ProvenanceViolationError`` from the API client).
    """
    project, litho, formation, bh_source, bh_neighbour = bodies_api_fixture

    # Pre-seed a body row with the left side already detector-claimed as
    # 'to_target' — simulates what DetectBodies produces.
    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add(body)
    await db_session.commit()

    # Now try to claim the left side as 'pinch_out_halfway' — must be blocked.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho.id}/bodies",
        json={
            "formation_id": str(formation.id),
            "source_investigation_id": str(bh_source.id),
            "side": "left",
            "kind": EXTENT_KIND_PINCH_OUT_HALFWAY,
            "neighbour_inv_id": str(bh_neighbour.id),
        },
    )

    # Must be 409, not 422.
    assert resp.status_code == 409, (
        f"Expected 409 Conflict for provenance violation, got {resp.status_code}: {resp.text}"
    )
    body_json = resp.json()
    assert body_json.get("detail", {}).get("code") == "provenance_violation", (
        f"Expected code='provenance_violation' in detail, got: {body_json}"
    )


@pytest.mark.asyncio
async def test_claim_body_extent_other_validation_errors_still_return_422(
    async_client: AsyncClient,
    db_session: AsyncSession,
    bodies_api_fixture: tuple,
) -> None:
    """Plain validation errors (invalid side, missing neighbour, etc.) must still
    return 422 — 409 is reserved for the provenance-violation path only.
    """
    project, litho, formation, bh_source, bh_neighbour = bodies_api_fixture

    # Invalid 'side' → must be a 422 validation error, not 409.
    # Note: 'side' is validated by Pydantic at the schema level (it's a
    # Literal['left','right'] field), so the 422 detail shape is FastAPI's
    # standard list-of-errors, not our {"code": ...} dict.  We assert the
    # status code only; the key requirement is that it is NOT 409.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho.id}/bodies",
        json={
            "formation_id": str(formation.id),
            "source_investigation_id": str(bh_source.id),
            "side": "centre",  # invalid — neither 'left' nor 'right'
            "kind": EXTENT_KIND_PINCH_OUT_HALFWAY,
            "neighbour_inv_id": str(bh_neighbour.id),
        },
    )

    assert resp.status_code == 422, (
        f"Expected 422 for invalid-side error, got {resp.status_code}: {resp.text}"
    )
    # Confirm we are NOT getting a 409 provenance-violation response.
    assert resp.status_code != 409
