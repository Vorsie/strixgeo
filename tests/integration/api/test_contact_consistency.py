"""End to end: a borehole 0.4 m from another that disagrees by 2 m is flagged.

Run only through ``.\\scripts\\run-integration-tests.ps1`` (a bare pytest
TRUNCATEs whatever ``DATABASE_URL`` names).
"""

from __future__ import annotations

import asyncio
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._section_builders import covering_section


async def _setup(
    client: AsyncClient,
    session: AsyncSession,
    *,
    n: int,
    pair: bool,
    surface_formation: str | None = None,
) -> tuple[ProjectOrm, str]:
    """Create a project with ``n`` smoothly dipping picks (+ an outlier twin of BH-3).

    ``surface_formation`` adds a second formation picked at 0 m depth on every
    borehole (a top at the ground surface).
    """
    project = ProjectOrm(id=uuid7(), name="Pick check", status="active")
    session.add(project)
    await session.flush()
    # Only tests a cross-section draws feed a model (owner 2026-09-23).
    session.add(covering_section(project.id))
    holes = [(f"BH-{i}", 50.0 * i, 5.0 + 0.005 * 50.0 * i) for i in range(n)]
    if pair:
        # 0.4 m from BH-3 (x = 150) and 2 m deeper: the two cannot both be right.
        holes.append(("BH-P", 150.4, 5.0 + 0.005 * 150.0 + 2.0))
    rows = []
    for name, x, depth in holes:
        bh = BoreholeOrm(
            id=uuid7(),
            name=name,
            app_project_id=project.id,
            project_id="DOV",
            test_id=name,
            location_x=x,
            location_y=0.0,
            epsg=31370,
            elevation_m=10.0,
            total_depth_m=30.0,
        )
        rows.append((bh, depth))
        session.add(bh)
    await session.commit()
    formation = (
        await client.post(
            f"/projects/{project.id}/geology/formations",
            json={"name": "Egem", "color": "#84cc16"},
        )
    ).json()
    model = (
        await client.post(f"/projects/{project.id}/geology/models", json={"name": "Model"})
    ).json()
    for bh, depth in rows:
        resp = await client.post(
            f"/projects/{project.id}/geology/models/{model['id']}/contacts",
            json={"formation_id": formation["id"], "borehole_id": str(bh.id), "depth_top_m": depth},
        )
        assert resp.status_code == 201, resp.text
    if surface_formation is not None:
        surface = (
            await client.post(
                f"/projects/{project.id}/geology/formations",
                json={"name": surface_formation, "color": "#a8a29e"},
            )
        ).json()
        for bh, _ in rows:
            resp = await client.post(
                f"/projects/{project.id}/geology/models/{model['id']}/contacts",
                json={"formation_id": surface["id"], "borehole_id": str(bh.id), "depth_top_m": 0.0},
            )
            assert resp.status_code == 201, resp.text
    return project, model["id"]


async def _ready(client: AsyncClient, url: str) -> dict[str, Any]:
    """Poll the report until it says ``ready`` (the desktop does the same)."""
    for _ in range(100):
        body: dict[str, Any] = (await client.get(url)).json()
        if body["status"] == "ready":
            return body
        await asyncio.sleep(0.1)
    raise AssertionError("contact-consistency never became ready")


async def test_disagreeing_pair_is_flagged(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Seven smooth picks plus a 2 m outlier 0.4 m from BH-3 → BH-P flagged, BH-3 named.

    In a field this smooth only the outlier is flagged: with BH-3 held out,
    BH-P stays in the refit and inflates its nugget, so BH-3 looks normal
    (offline domain run: BH-P z = -7.3, nothing else). The flag names BH-3
    as the closest pick, which is what the user opens the section on.
    """
    project, model_id = await _setup(async_client, db_session, n=7, pair=True)
    body = await _ready(
        async_client, f"/projects/{project.id}/geology/models/{model_id}/contact-consistency"
    )
    (formation,) = body["formations"]
    assert formation["status"] == "checked"
    assert formation["n_picks"] == 8
    assert [f["investigation_name"] for f in formation["flags"]] == ["BH-P"]
    (flag,) = formation["flags"]
    assert flag["z"] < -3.0
    assert flag["nearest"]["investigation_name"] == "BH-3"
    assert abs(flag["nearest"]["distance_m"] - 0.4) < 1e-6


async def test_too_few_picks_is_reported(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Three picks → too_few_picks, no flags, ready at once."""
    project, model_id = await _setup(async_client, db_session, n=3, pair=False)
    body = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model_id}/contact-consistency"
        )
    ).json()
    assert body["status"] == "ready"
    assert body["formations"][0]["status"] == "too_few_picks"
    assert body["formations"][0]["flags"] == []


async def test_foreign_model_is_404(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """Project A cannot read project B's model."""
    _, model_id = await _setup(async_client, db_session, n=3, pair=False)
    other = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(other)
    await db_session.commit()
    resp = await async_client.get(
        f"/projects/{other.id}/geology/models/{model_id}/contact-consistency"
    )
    assert resp.status_code == 404


async def test_a_formation_with_every_top_at_zero_is_not_checked(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """Owner ruling 2026-10-20: "Skip formations with top at 0, we're pretty sure
    about the surface level." A formation picked only at 0 m leaves the report
    (not even as too_few_picks); the formation below it is still checked.
    """
    project, model_id = await _setup(
        async_client, db_session, n=7, pair=False, surface_formation="Aangevuld"
    )
    body = await _ready(
        async_client, f"/projects/{project.id}/geology/models/{model_id}/contact-consistency"
    )
    names = [f["formation_name"] for f in body["formations"]]
    assert "Aangevuld" not in names
    assert names == ["Egem"]
    assert body["formations"][0]["n_picks"] == 7
