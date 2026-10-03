"""Integration tests — ZAND and ZAND (SL:M) never weld into one body.

Owner ruling 2026-10-03, verbatim: *"a zand and zand/matig siltig are 2 different
lithologies, never weld those."* An admixture variant is a litho unit in its own
right: a band of unit X and a band of unit Y never share a body, whatever their
main soil family, and each unit numbers its bodies from #0. A litho tie across the
two units is KEPT (it states a shared surface) but never joins bodies. Join by hand
(a GROUP, never a merge) stays the way to pool the two.

Scene
-----
* CPT-A and CPT-B stand 500 m apart on one section.
* CPT-A's 0..6 m is accepted as clean ZAND; CPT-B's 0..6 m as ZAND with a
  medium silt admixture (``SL`` / ``M``) — a separate litho formation row.
* The two layers are litho-correlated (the tie the owner's model carried).

Test assertions
---------------
NW-1  After the resolver the two layers carry DIFFERENT body ids.
NW-2  Each body is numbered #0 within its own unit (ZAND #0, ZAND (SL:M) #0).
NW-3  The cross-unit tie survives as a correlation edge (a surface statement).
NW-4  A Join (group) of the two bodies is ACCEPTED — the hand-pooling path stays.

⚠ NOT RUN by the author — the integration suite must go through the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_never_weld_litho_variants.py
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

from .geotech_scene_helpers import two_layer_qc


@pytest_asyncio.fixture
async def nw_project(db_session: AsyncSession) -> ProjectOrm:
    """A project for this module's scene."""
    project = ProjectOrm(id=uuid7(), name="NW-Project", status="active")
    db_session.add(project)
    await db_session.commit()
    return project


async def _accept(
    client: AsyncClient,
    project_id: str,
    litho_model_id: str,
    *,
    cpt_id: str,
    admixtures: list[dict[str, object]],
) -> str:
    """Accept one 0..6 m ZAND layer (with the given admixtures) on a CPT.

    Parameters
    ----------
    client : AsyncClient
        HTTP test client.
    project_id : str
        Owning project id.
    litho_model_id : str
        Litho model id.
    cpt_id : str
        CPT id.
    admixtures : list[dict[str, object]]
        ``AdmixtureItem`` payloads; empty for a clean sand.

    Returns
    -------
    str
        The created layer id.
    """
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
        json={
            "cpt_id": cpt_id,
            "suggestions": [
                {
                    "depth_top_m": 0.0,
                    "depth_base_m": 6.0,
                    "suggested_lithology": "ZAND",
                    "confidence": "high",
                    "source": "robertson_2015",
                    "suggested_admixtures": admixtures,
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    created = resp.json()["created_contact_ids"]
    assert len(created) >= 1
    return str(created[0])


@pytest_asyncio.fixture
async def nw_scene(
    db_session: AsyncSession,
    nw_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Two CPTs: clean ZAND on one, ZAND (SL:M) on the other, litho-tied.

    Returns
    -------
    dict
        ``project``, ``litho_model_id``, ``section_id``, ``layer_a``, ``layer_b``.
    """
    pid = str(nw_project.id)
    geo = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "NW-Geo", "kind": "geological"},
    )
    assert geo.status_code == 201, geo.text
    litho = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "NW-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo.json()["id"],
        },
    )
    assert litho.status_code == 201, litho.text
    litho_model_id = litho.json()["id"]

    section = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "NW-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_400.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert section.status_code == 201, section.text
    section_id = section.json()["id"]

    depths, qc = two_layer_qc(150, 150, 8.0, 8.0)
    cpt_ids: list[str] = []
    for index, x in enumerate((148_800.0, 149_300.0)):
        cpt = CptOrm(
            id=uuid7(),
            name=f"NW-{index}",
            cpt_type="CPTU",
            project_id="NW",
            test_id=f"NW/{index}",
            app_project_id=nw_project.id,
            location_x=x,
            location_y=200_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=6.0,
        )
        cpt.series = CptSeriesOrm(
            depths_m=depths,
            qc_mpa=qc,
            fs_mpa=[0.05] * len(depths),
            u2_mpa=None,
        )
        db_session.add(cpt)
        await db_session.flush()
        cpt_ids.append(str(cpt.id))
    await db_session.commit()

    layer_a = await _accept(async_client, pid, litho_model_id, cpt_id=cpt_ids[0], admixtures=[])
    layer_b = await _accept(
        async_client,
        pid,
        litho_model_id,
        cpt_id=cpt_ids[1],
        admixtures=[{"soil_code": "SL", "amount": "M", "locally": False}],
    )
    correlate = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/contact-correlations",
        json={"layer_a_id": layer_a, "layer_b_id": layer_b, "request_section_id": section_id},
    )
    assert correlate.status_code in (200, 201), correlate.text
    await db_session.commit()
    return {
        "project": nw_project,
        "litho_model_id": litho_model_id,
        "section_id": section_id,
        "layer_a": layer_a,
        "layer_b": layer_b,
    }


async def _layer(session: AsyncSession, layer_id: str) -> LithoLayerOrm:
    """Re-read one litho layer row (expire first so the resolver's stamp shows)."""
    session.expire_all()
    row = await session.get(LithoLayerOrm, layer_id)
    assert row is not None
    return row


@pytest.mark.asyncio
async def test_nw1_touching_zand_and_zand_matig_siltig_are_two_bodies(
    db_session: AsyncSession, nw_scene: dict
) -> None:
    """NW-1 — "a zand and zand/matig siltig are 2 different lithologies"."""
    a = await _layer(db_session, nw_scene["layer_a"])
    b = await _layer(db_session, nw_scene["layer_b"])
    assert a.formation_id != b.formation_id, "scene: the variant must be its own litho unit"
    assert a.body_id is not None and b.body_id is not None
    assert a.body_id != b.body_id, "a tie across two litho units welded them into one body"


@pytest.mark.asyncio
async def test_nw2_each_unit_numbers_its_bodies_from_zero(
    db_session: AsyncSession, nw_scene: dict
) -> None:
    """NW-2 — the variant is a unit in its own right, counting from #0."""
    a = await _layer(db_session, nw_scene["layer_a"])
    b = await _layer(db_session, nw_scene["layer_b"])
    body_a = await db_session.get(BodyOrm, a.body_id)
    body_b = await db_session.get(BodyOrm, b.body_id)
    assert body_a is not None and body_b is not None
    assert body_a.formation_id == a.formation_id
    assert body_b.formation_id == b.formation_id
    assert body_a.body_ordinal == 0
    assert body_b.body_ordinal == 0


@pytest.mark.asyncio
async def test_nw3_the_cross_unit_tie_survives_as_a_surface_statement(
    db_session: AsyncSession, nw_scene: dict
) -> None:
    """NW-3 — the tie is kept; it only stops joining bodies."""
    edges = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == nw_scene["litho_model_id"]
                )
            )
        )
        .scalars()
        .all()
    )
    pairs = {frozenset((str(e.layer_a_id), str(e.layer_b_id))) for e in edges}
    assert frozenset((nw_scene["layer_a"], nw_scene["layer_b"])) in pairs


@pytest.mark.asyncio
async def test_nw4_a_join_still_groups_the_two_units_by_hand(
    db_session: AsyncSession, nw_scene: dict, async_client: AsyncClient
) -> None:
    """NW-4 — Join (group, never merge) stays the way to pool the two units."""
    pid = str(nw_scene["project"].id)
    lm = nw_scene["litho_model_id"]
    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": nw_scene["layer_a"], "layer_b_id": nw_scene["layer_b"]},
    )
    assert resp.status_code == 201, resp.text
    a = await _layer(db_session, nw_scene["layer_a"])
    b = await _layer(db_session, nw_scene["layer_b"])
    assert a.body_id != b.body_id, "a Join is a GROUP, never a merge"
