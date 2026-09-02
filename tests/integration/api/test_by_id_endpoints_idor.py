"""IDOR contract pins for every non-nested by-id CPT / borehole endpoint (audit C11).

Debt #4 resolved the cross-project enumeration hole on 2026-05-19: every
single-resource by-id endpoint requires ``?project_id=UUID`` and rejects a
foreign id with 404 through ``get_in_project_or_404``. Audit item C11 noted
that the contract was never pinned by integration tests for the most-enumerable
endpoints — a future refactor could drop the guard on one route and no red
would appear. This module is that pin: for EVERY non-nested resource-by-id
route on the CPT and borehole routers, a known resource is created under one
project and the route is called scoped to a SECOND, real project. The rule the
guard enforces, in the audit's own words: a known resource UUID must not be
reachable — read, mutated, or deleted — through a URL that scopes it to a
project it does not belong to. The answer is 404, and for the mutating routes
the stored row is byte-for-byte unchanged.

These are guard pins, not red-first pins: the guard already ships on develop
(``get_in_project_or_404`` on all eight routes), so they lock in behaviour that
is already correct rather than driving a fix. Two of the eight
(``water-table`` / ``sbt-profile``) are also covered by
``test_cpt_water_table.py``; they are repeated here so C11 has a single,
complete surface — one test per by-id route.

The project.py ``/{project_id}`` routes and the ephemeral
``/import-dov/stream/{job_id}`` SSE endpoints are deliberately NOT pinned here:
the project id IS the tenant scope (there is no outer project to reject it
against — ownership auth is separate debt #4), and the job id is an in-process
``JobRegistry`` handle, not a project-scoped DB row.

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from tests.integration.conftest import make_project


@pytest_asyncio.fixture
async def owner_and_stranger(db_session: AsyncSession) -> dict:
    """Two real projects; one CPT (with series) + one borehole under the owner.

    The stranger project owns nothing — it exists only to supply a real,
    non-owning ``project_id`` for the cross-project calls, so a 404 proves the
    scope guard fired rather than the id simply being unknown to the database.
    """
    owner = await make_project(db_session, name="owner")
    stranger = await make_project(db_session, name="stranger")

    cpt = CptOrm(
        id=uuid7(),
        name="IDOR-CPT",
        cpt_type="CPTU",
        project_id="IDOR",
        test_id="IDOR/1",
        app_project_id=owner.id,
        location_x=100_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=15.0,
    )
    # Series present so the plot / sbt-profile OWNER controls reach their 200
    # path — the guard fires before series is touched, but a positive control
    # that 404'd for lack of series would mask a route that 404s for everyone.
    cpt.series = CptSeriesOrm(
        depths_m=[0.2, 0.4, 0.6, 0.8],
        qc_mpa=[1.0, 1.5, 2.0, 8.0],
        fs_mpa=[0.05, 0.06, 0.07, 0.09],
        u2_mpa=None,
    )
    borehole = BoreholeOrm(
        id=uuid7(),
        name="IDOR-BH",
        app_project_id=owner.id,
        project_id="IDOR",
        test_id="IDOR/BH1",
        location_x=100_000.0,
        location_y=200_000.0,
        elevation_m=3.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add_all([cpt, borehole])
    await db_session.commit()
    return {"owner": owner, "stranger": stranger, "cpt": cpt, "borehole": borehole}


# --------------------------------------------------------------------------- #
# CPT routes                                                                   #
# --------------------------------------------------------------------------- #


async def test_get_cpt_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict
) -> None:
    """GET /cpt/{id}: the owner reads it; the stranger's scope gets a 404."""
    f = owner_and_stranger
    cpt_id = f["cpt"].id

    assert (await async_client.get(f"/cpt/{cpt_id}?project_id={f['owner'].id}")).status_code == 200
    assert (
        await async_client.get(f"/cpt/{cpt_id}?project_id={f['stranger'].id}")
    ).status_code == 404


async def test_patch_cpt_elevation_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict, db_session: AsyncSession
) -> None:
    """PATCH /cpt/{id}/elevation via a foreign scope is 404 and moves nothing."""
    f = owner_and_stranger
    cpt_id = f["cpt"].id

    resp = await async_client.patch(
        f"/cpt/{cpt_id}/elevation?project_id={f['stranger'].id}",
        json={"elevation_m": 999.0},
    )
    assert resp.status_code == 404, resp.text
    fresh = (await db_session.execute(select(CptOrm).where(CptOrm.id == cpt_id))).scalar_one()
    await db_session.refresh(fresh)
    assert fresh.elevation_m == 5.0, "the foreign PATCH moved the elevation"

    # Owner scope still works — the 404 above was the scope guard, not a dead route.
    assert (
        await async_client.patch(
            f"/cpt/{cpt_id}/elevation?project_id={f['owner'].id}",
            json={"elevation_m": 6.0},
        )
    ).status_code == 200


async def test_patch_cpt_water_table_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict, db_session: AsyncSession
) -> None:
    """PATCH /cpt/{id}/water-table via a foreign scope is 404 and writes nothing."""
    f = owner_and_stranger
    cpt_id = f["cpt"].id

    resp = await async_client.patch(
        f"/cpt/{cpt_id}/water-table?project_id={f['stranger'].id}",
        json={"water_depth_m": 7.0},
    )
    assert resp.status_code == 404, resp.text
    fresh = (await db_session.execute(select(CptOrm).where(CptOrm.id == cpt_id))).scalar_one()
    await db_session.refresh(fresh)
    assert fresh.water_depth_m is None, "the foreign PATCH set a water table"

    assert (
        await async_client.patch(
            f"/cpt/{cpt_id}/water-table?project_id={f['owner'].id}",
            json={"water_depth_m": 2.0},
        )
    ).status_code == 200


async def test_delete_cpt_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict, db_session: AsyncSession
) -> None:
    """DELETE /cpt/{id} via a foreign scope is 404 and the row survives."""
    f = owner_and_stranger
    cpt_id = f["cpt"].id

    resp = await async_client.delete(f"/cpt/{cpt_id}?project_id={f['stranger'].id}")
    assert resp.status_code == 404, resp.text
    survivor = (
        await db_session.execute(select(CptOrm).where(CptOrm.id == cpt_id))
    ).scalar_one_or_none()
    assert survivor is not None, "the foreign DELETE removed the CPT"

    # Owner scope deletes it — proves the route works and the guard was the block.
    assert (
        await async_client.delete(f"/cpt/{cpt_id}?project_id={f['owner'].id}")
    ).status_code == 204


async def test_get_cpt_plot_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict
) -> None:
    """GET /cpt/{id}/plot: owner gets the series; the stranger's scope gets 404."""
    f = owner_and_stranger
    cpt_id = f["cpt"].id

    assert (
        await async_client.get(f"/cpt/{cpt_id}/plot?project_id={f['owner'].id}")
    ).status_code == 200
    assert (
        await async_client.get(f"/cpt/{cpt_id}/plot?project_id={f['stranger'].id}")
    ).status_code == 404


async def test_get_cpt_sbt_profile_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict
) -> None:
    """GET /cpt/{id}/sbt-profile: owner gets the profile; the stranger gets 404."""
    f = owner_and_stranger
    cpt_id = f["cpt"].id

    assert (
        await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={f['owner'].id}")
    ).status_code == 200
    assert (
        await async_client.get(f"/cpt/{cpt_id}/sbt-profile?project_id={f['stranger'].id}")
    ).status_code == 404


# --------------------------------------------------------------------------- #
# Borehole routes                                                             #
# --------------------------------------------------------------------------- #


async def test_get_borehole_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict
) -> None:
    """GET /borehole/{id}: owner reads it; the stranger's scope gets a 404."""
    f = owner_and_stranger
    bh_id = f["borehole"].id

    assert (
        await async_client.get(f"/borehole/{bh_id}?project_id={f['owner'].id}")
    ).status_code == 200
    assert (
        await async_client.get(f"/borehole/{bh_id}?project_id={f['stranger'].id}")
    ).status_code == 404


async def test_patch_borehole_elevation_rejects_a_foreign_project(
    async_client: AsyncClient, owner_and_stranger: dict, db_session: AsyncSession
) -> None:
    """PATCH /borehole/{id}/elevation via a foreign scope is 404 and moves nothing."""
    f = owner_and_stranger
    bh_id = f["borehole"].id

    resp = await async_client.patch(
        f"/borehole/{bh_id}/elevation?project_id={f['stranger'].id}",
        json={"elevation_m": 888.0},
    )
    assert resp.status_code == 404, resp.text
    fresh = (
        await db_session.execute(select(BoreholeOrm).where(BoreholeOrm.id == bh_id))
    ).scalar_one()
    await db_session.refresh(fresh)
    assert fresh.elevation_m == 3.0, "the foreign PATCH moved the elevation"

    assert (
        await async_client.patch(
            f"/borehole/{bh_id}/elevation?project_id={f['owner'].id}",
            json={"elevation_m": 4.0},
        )
    ).status_code == 200
