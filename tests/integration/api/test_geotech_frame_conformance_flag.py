"""Integration tests for the litho-frame conformance FLAG (owner order 2026-08-21).

The owner drew two packing ties between a silt on one column and a clay on
another, saw the render answer with an onlap instead of a band, deleted the
ties himself and ordered: *"next time flag a tie like that when it doesn't
conform to the litho model!"*

The existing litho-body guard admits those ties lawfully — a contact is a
SURFACE and both endpoints touched the same sand body ABOVE them (ruling
2026-08-04).  So the scene here reproduces that shape exactly: sand on top of
both columns, litho-correlated (one body), and a DIFFERENT soil below each.

Cases
-----
FW-DB1  Different soils below: the tie IS created (201), the response carries
        a ``frame_warning`` naming both columns and depths — never an id —
        and the stored edge is born with ``review_reason='frame_mismatch'``.
FW-DB2  Same soil below but NO litho correlation between those units: the
        warning advises correlating the litho units first.
FW-DB3  Negative control — same soil, litho-correlated: no warning, and the
        edge carries no review flag.  The flag is not a blanket "warn always".

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 `
        tests/integration/api/test_geotech_frame_conformance_flag.py
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.geotech_scene_helpers import correlate, paint_accepted_ties

#: Both columns: sand 0–4 m over a second unit 4–9 m.
_SPLIT_M = 4.0
_COLUMN_DEPTH_M = 9.0
#: Uniform qc — one packing band per litho unit, so a band's top IS the
#: litho contact and the tie under test is unambiguous.
_QC_MPA = 12.0


async def _build_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
    *,
    lower_soil_b: str,
    correlate_lower: bool,
) -> dict:
    """Two CPTs, sand over ``SILT``/*lower_soil_b*, sand tops always correlated.

    Parameters
    ----------
    db_session : AsyncSession
        Session for direct row inspection.
    async_client : AsyncClient
        HTTP test client.
    lower_soil_b : str
        Main soil code of column B's lower unit (``"SILT"`` matches A).
    correlate_lower : bool
        Whether to litho-correlate the two LOWER units as well.

    Returns
    -------
    dict
        ``project_id``, ``geotech_model_id``, ``cpt_a_id``, ``cpt_b_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Frame conformance flag test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo = await async_client.post(
        f"/projects/{pid}/geology/models", json={"name": "FW-Geo", "kind": "geological"}
    )
    assert geo.status_code == 201, geo.text
    litho = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "FW-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo.json()["id"],
        },
    )
    assert litho.status_code == 201, litho.text
    litho_model_id = litho.json()["id"]

    sec = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "FW-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_900.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert sec.status_code == 201, sec.text
    section_id = sec.json()["id"]

    depths = [round(0.02 * i, 2) for i in range(1, int(_COLUMN_DEPTH_M / 0.02) + 1)]

    def _cpt(name: str, x: float) -> CptOrm:
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="FW",
            test_id=f"FW/{name}",
            app_project_id=proj.id,
            location_x=x,
            location_y=200_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=_COLUMN_DEPTH_M,
        )
        cpt.series = CptSeriesOrm(
            depths_m=depths,
            qc_mpa=[_QC_MPA] * len(depths),
            fs_mpa=[0.05] * len(depths),
            u2_mpa=None,
            rf_pct=None,
            q_total_mpa=None,
        )
        return cpt

    cpt_a = _cpt("CPT-A", 149_000.0)
    cpt_b = _cpt("CPT-B", 149_600.0)
    db_session.add_all([cpt_a, cpt_b])
    await db_session.commit()

    async def _accept(cpt_id: str, lower_soil: str) -> list[str]:
        resp = await async_client.post(
            f"/projects/{pid}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
            json={
                "cpt_id": cpt_id,
                "suggestions": [
                    {
                        "depth_top_m": 0.0,
                        "depth_base_m": _SPLIT_M,
                        "suggested_lithology": "ZAND",
                        "confidence": "high",
                        "source": "robertson_2015",
                        "suggested_admixtures": [],
                    },
                    {
                        "depth_top_m": _SPLIT_M,
                        "depth_base_m": _COLUMN_DEPTH_M,
                        "suggested_lithology": lower_soil,
                        "confidence": "high",
                        "source": "robertson_2015",
                        "suggested_admixtures": [],
                    },
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        return [str(c) for c in resp.json()["created_contact_ids"]]

    contacts_a = await _accept(str(cpt_a.id), "SILT")
    contacts_b = await _accept(str(cpt_b.id), lower_soil_b)

    # The SAND tops are always correlated — that shared body is what admits the
    # tie past the 2026-08-04 surface guard, exactly as on the owner's section.
    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contacts_a[0],
        contact_b=contacts_b[0],
        section_id=section_id,
    )
    if correlate_lower:
        await correlate(
            async_client,
            pid,
            litho_model_id,
            contact_a=contacts_a[1],
            contact_b=contacts_b[1],
            section_id=section_id,
        )

    # The fill paints the litho ties as bands; the recompute's facts make the tied
    # sands ONE litho body (identity follows the drawing, owner 2026-10-04).
    await paint_accepted_ties(db_session, litho_model_id)

    sub = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/geotech/subdivide-cpts",
        json={"litho_model_id": litho_model_id},
    )
    assert sub.status_code == 200, sub.text
    return {
        "project_id": pid,
        "section_id": section_id,
        "geotech_model_id": str(sub.json()["geotech_model_id"]),
        "cpt_a_id": cpt_a.id,
        "cpt_b_id": cpt_b.id,
    }


async def _band_top_at(
    db_session: AsyncSession, geotech_model_id: str, cpt_id, depth_top_m: float
) -> str:
    """The geotech band on *cpt_id* whose top sits at *depth_top_m* (its contact id)."""
    rows = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(
                    LithoLayerOrm.model_id == geotech_model_id,
                    LithoLayerOrm.cpt_id == cpt_id,
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        if abs(row.depth_top_m - depth_top_m) <= 0.05:
            return str(row.id)
    raise AssertionError(f"no band top at {depth_top_m} m among {[r.depth_top_m for r in rows]}")


async def _draw_tie(client: AsyncClient, scene: dict, a_id: str, b_id: str):
    """POST a manual packing tie on the geotech model."""
    return await client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['geotech_model_id']}/contact-correlations",
        json={
            "layer_a_id": a_id,
            "layer_b_id": b_id,
            "source": "manual",
            "request_section_id": scene["section_id"],
            "layer_a_side": "top",
            "layer_b_side": "top",
        },
    )


@pytest.mark.asyncio
async def test_fwdb1_cross_soil_tie_lands_flagged_with_a_warning(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """FW-DB1: silt↔clay lands, warns about different soils, and is born flagged."""
    scene = await _build_scene(db_session, async_client, lower_soil_b="KLEI", correlate_lower=False)
    a = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_a_id"], _SPLIT_M)
    b = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_b_id"], _SPLIT_M)

    resp = await _draw_tie(async_client, scene, a, b)

    assert resp.status_code == 201, resp.text
    warning = resp.json()["frame_warning"]
    assert warning is not None, "a cross-soil packing tie must be flagged"
    assert "different soils" in warning
    # The owner's D5 complaint: the message names columns, never database ids.
    assert "CPT-A" in warning and "CPT-B" in warning
    assert str(a) not in warning and str(b) not in warning

    edge = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id == resp.json()["edge_id"]
                )
            )
        )
        .scalars()
        .one()
    )
    assert edge.review_reason == "frame_mismatch"


@pytest.mark.asyncio
async def test_fwdb2_same_soil_without_a_litho_path_advises_correlating_litho(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """FW-DB2: silt↔silt with no litho tie between those units — correlate first."""
    scene = await _build_scene(db_session, async_client, lower_soil_b="SILT", correlate_lower=False)
    a = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_a_id"], _SPLIT_M)
    b = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_b_id"], _SPLIT_M)

    resp = await _draw_tie(async_client, scene, a, b)

    assert resp.status_code == 201, resp.text
    warning = resp.json()["frame_warning"]
    assert warning is not None, "an unconnected same-soil packing tie must be flagged"
    assert "Correlate the litho units first" in warning


@pytest.mark.asyncio
async def test_fwdb3_conforming_tie_is_silent_and_unflagged(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """FW-DB3: negative control — same soil WITH a litho path warns nothing."""
    scene = await _build_scene(db_session, async_client, lower_soil_b="SILT", correlate_lower=True)
    a = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_a_id"], _SPLIT_M)
    b = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_b_id"], _SPLIT_M)

    resp = await _draw_tie(async_client, scene, a, b)

    assert resp.status_code == 201, resp.text
    assert resp.json()["frame_warning"] is None, "a conforming tie must not be flagged"
    edge = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.id == resp.json()["edge_id"]
                )
            )
        )
        .scalars()
        .one()
    )
    assert edge.review_reason is None
