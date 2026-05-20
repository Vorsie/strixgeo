"""End-to-end HTTP test of the pinch-out endpoint (debt #61 closed).

Exercises POST `/projects/{pid}/geology/models/{mid}/contacts/pinch-out`
through the FastAPI app + real DB + real Delaunay surface build to
pin the three contracts the use case unit tests can't reach:

E1 — 200 happy path: synthetic contacts created, tip geometry returned,
     section's `seeded_formation_contact_ids` includes both new ids
     (debt #62 item 3 — router now owns the seeding).
E2 — 409 idempotent path: re-invoking with the same params returns
     409 with `detail.existing_contact_ids` matching E1's
     `created_contact_ids`, and `detail.updated_section` echoes the
     section back (the B2/S3 client contract).
E3 — 422 geometry error: a section/formation pair whose surfaces
     don't cross in the requested direction returns 422 with
     `detail.code == "pinch_out_geometry_error"` — the discriminator
     the frontend auto-retry keys on (debt #62 item 2).

The geometry mirrors `tests/integration/api/test_pinch_out_dry_run.py`
(EPSG:31370 Lambert section, pinching surface dipping from z=10 to
z=5 over 50 m, flat target at z=0, ray crosses ~50 m further right).
Setup is inlined intentionally — second copy, "extract on third" rule.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_formation_surface import RecomputeFormationSurface
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

from ..conftest import make_project

# ---------------------------------------------------------------------------
# Geometry (Lambert 72) — east-west section, pinching surface dips toward 0.
# ---------------------------------------------------------------------------
_START_X = 150000.0
_START_Y = 200000.0
_END_X = 150300.0
_END_Y = 200000.0

_PINCHING_PTS = [
    (_START_X, _START_Y, 10.0),
    (_START_X + 50.0, _START_Y, 5.0),
    (_START_X + 25.0, _START_Y + 10.0, 7.5),
]
_TARGET_PTS = [
    (_START_X, _START_Y, 0.0),
    (_START_X + 300.0, _START_Y, 0.0),
    (_START_X + 150.0, _START_Y + 10.0, 0.0),
]


async def _setup_pinch_out_scene(
    db_session: AsyncSession,
) -> tuple[
    GeologicalModelOrm,
    GeologicalFormationOrm,
    GeologicalFormationOrm,
    CrossSectionOrm,
]:
    """Project + geological model + pinching/target formations with built
    TINs + one section the geometry is aligned to.

    Returns (model, pinching, target, section). Same shape as the helper
    in test_pinch_out_dry_run; inlined here per the "extract on the
    third copy" rule.
    """
    project = await make_project(db_session)
    model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="TestModel", kind="geological"
    )
    pinching = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Pinching",
        color="#f00",
        display_order=1,
    )
    target = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Target",
        color="#00f",
        display_order=0,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="S1",
        start_x=_START_X,
        start_y=_START_Y,
        end_x=_END_X,
        end_y=_END_Y,
        epsg=31370,
        projection_buffer_m=30.0,
    )
    db_session.add_all([model, pinching, target, section])
    await db_session.flush()

    # TIN-control contacts — source="interpolated" is deliberate: the
    # use case's idempotency guard filters on source="pinch_out_extrapolation"
    # so these don't trip it (same call-out as the dry-run helper).
    for x, y, z in _PINCHING_PTS:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=model.id,
                formation_id=pinching.id,
                synthetic_x=x,
                synthetic_y=y,
                synthetic_elevation_m=z,
                depth_top_m=0.0,
                source="interpolated",
                confidence="low",
            )
        )
    for x, y, z in _TARGET_PTS:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=model.id,
                formation_id=target.id,
                synthetic_x=x,
                synthetic_y=y,
                synthetic_elevation_m=z,
                depth_top_m=0.0,
                source="interpolated",
                confidence="low",
            )
        )
    await db_session.commit()

    # Build the TIN surfaces the use case will slice. RecomputeFormationSurface
    # only flushes — commit explicitly so the request handler's separate
    # session (async_client.factory) sees the surfaces via read-committed.
    await RecomputeFormationSurface(db_session).execute(model.id, pinching.id)
    await RecomputeFormationSurface(db_session).execute(model.id, target.id)
    await db_session.commit()

    return model, pinching, target, section


@pytest.mark.asyncio
async def test_pinch_out_e2e_happy_path_seeds_section(
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """E1 — POST returns 200, creates two synthetic contacts, populates
    tip geometry, and seeds the section with the new contact ids."""
    model, pinching, target, section = await _setup_pinch_out_scene(db_session)

    resp = await async_client.post(
        f"/projects/{section.app_project_id}/geology/models/{model.id}/contacts/pinch-out",
        json={
            "formation_id": str(pinching.id),
            "target_formation_id": str(target.id),
            "section_id": str(section.id),
            "direction": "right",
            "dry_run": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Two synthetic contacts (tip + perpendicular twin) inserted.
    assert len(body["created_contact_ids"]) == 2
    assert body["tip_along_m"] > 50.0
    assert 0.0 <= body["tip_elevation_m"] <= 5.0

    # Section echo carries both new contact ids in seeded set (router
    # owns the seeding now per debt #62 item 3). The echoed value
    # comes from the request handler's session AFTER its commit —
    # this assertion alone proves the seed PATCH committed; no need
    # for a redundant DB re-query through the test session (which
    # would hit a stale snapshot of the section row anyway).
    updated_section = body.get("updated_section")
    assert updated_section is not None
    seeded = set(updated_section["seeded_formation_contact_ids"])
    assert set(body["created_contact_ids"]) <= seeded


@pytest.mark.asyncio
async def test_pinch_out_e2e_idempotent_409_echoes_section(
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """E2 — re-invoking the endpoint with identical params returns 409;
    the body carries detail.existing_contact_ids matching the first
    call's created ids AND detail.updated_section so the client can
    refresh its local seeded set without an extra round-trip."""
    model, pinching, target, section = await _setup_pinch_out_scene(db_session)
    url = f"/projects/{section.app_project_id}/geology/models/{model.id}/contacts/pinch-out"
    payload = {
        "formation_id": str(pinching.id),
        "target_formation_id": str(target.id),
        "section_id": str(section.id),
        "direction": "right",
        "dry_run": False,
    }
    first = await async_client.post(url, json=payload)
    assert first.status_code == 200, first.text
    created_ids = set(first.json()["created_contact_ids"])

    second = await async_client.post(url, json=payload)
    assert second.status_code == 409, second.text
    detail = second.json()["detail"]
    assert detail["code"] == "pinch_out_already_exists"
    assert set(detail["existing_contact_ids"]) == created_ids
    # The 409 must echo updated_section so the client can refresh its
    # local seeded set in this one round-trip (review B2/S3).
    assert detail["updated_section"] is not None
    echoed_seeded = set(detail["updated_section"]["seeded_formation_contact_ids"])
    assert created_ids <= echoed_seeded


@pytest.mark.asyncio
async def test_pinch_out_e2e_geometry_error_carries_code(
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """E3 — when the requested direction can't compute a tip (here, both
    formations are flat and parallel so no crossing exists), the
    endpoint returns 422 with detail.code == 'pinch_out_geometry_error'
    — the discriminator the frontend auto-retry keys on (debt #62
    item 2's `code` contract)."""
    project = await make_project(db_session)
    model = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="M", kind="geological")
    # Two parallel flat surfaces — pinching at z=5, target at z=0,
    # both spanning the section width. No crossing in any direction.
    pinching = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Flat-5",
        color="#f00",
    )
    target = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Flat-0",
        color="#00f",
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="S",
        start_x=_START_X,
        start_y=_START_Y,
        end_x=_END_X,
        end_y=_END_Y,
        epsg=31370,
        projection_buffer_m=30.0,
    )
    db_session.add_all([model, pinching, target, section])
    await db_session.flush()
    for x, y, z in [
        (_START_X, _START_Y, 5.0),
        (_END_X, _START_Y, 5.0),
        (_START_X + 150.0, _START_Y + 10.0, 5.0),
    ]:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=model.id,
                formation_id=pinching.id,
                synthetic_x=x,
                synthetic_y=y,
                synthetic_elevation_m=z,
                depth_top_m=0.0,
                source="interpolated",
                confidence="low",
            )
        )
    for x, y, z in [
        (_START_X, _START_Y, 0.0),
        (_END_X, _START_Y, 0.0),
        (_START_X + 150.0, _START_Y + 10.0, 0.0),
    ]:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=model.id,
                formation_id=target.id,
                synthetic_x=x,
                synthetic_y=y,
                synthetic_elevation_m=z,
                depth_top_m=0.0,
                source="interpolated",
                confidence="low",
            )
        )
    await db_session.commit()
    await RecomputeFormationSurface(db_session).execute(model.id, pinching.id)
    await RecomputeFormationSurface(db_session).execute(model.id, target.id)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model.id}/contacts/pinch-out",
        json={
            "formation_id": str(pinching.id),
            "target_formation_id": str(target.id),
            "section_id": str(section.id),
            "direction": "right",
            "dry_run": False,
        },
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "pinch_out_geometry_error"
    assert "message" in detail
