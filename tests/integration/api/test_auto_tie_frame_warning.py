"""Integration tests: the MACHINE tie path carries the litho-frame warning too.

The hand-drawn packing tie (``POST .../contact-correlations``) runs the
frame-conformance check and, when a tie exceeds the litho frame, is born with
the violet ``review_reason='frame_mismatch'`` badge (see
``test_geotech_frame_conformance_flag.py``).  The machine path
(``POST .../geotech/auto-correlate``) restates a direct top-to-top litho tie
onto the top packing bands REGARDLESS of class (owner ruling 2026-08-13), so a
CROSS-SOIL litho surface tie makes it propose exactly the kind of tie the hand
path would flag — silently, until now.

Owner's standing recommendation (his notes): give the machine path the
WARNING, not the refusal — a restatement is legitimate, but the engineer must
be told at review time, not discover an "onlap that should band" on the canvas.

Scene
-----
Two CPTs, each SAND (0-4 m) over a lower unit (4-9 m); uniform qc so exactly one
packing band per litho unit.  The SAND tops are litho-correlated (a conforming
tie the machine restates onto the sand bands).  In the positive case the LOWER
units are litho-correlated CROSS-SOIL (SILT on A to KLEI on B): a lawful litho
surface tie the machine restates onto the silt band and the clay band, which
can never become one mass.

Cases
-----
AT1  The machine restates the cross-soil litho tie onto the two lower packing
     bands: that edge IS written (no refusal), it carries
     ``review_reason='frame_mismatch'`` exactly as a hand-drawn tie would, the
     run reports ``frame_flagged_count == 1``, and the conforming sand-band
     restatement in the SAME run stays unflagged (the flag is selective, not a
     blanket "warn on every machine tie").
AT2  Negative control - every correlated unit pair is same-soil and
     litho-connected, so no machine tie exceeds the frame: nothing is flagged
     and ``frame_flagged_count == 0``.

Run via the integration wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_auto_tie_frame_warning.py
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

#: Both columns: sand 0-4 m over a second unit 4-9 m.
_SPLIT_M = 4.0
_COLUMN_DEPTH_M = 9.0
#: Uniform qc - one packing band per litho unit, so a band's top IS the litho
#: contact and the restated tie under test is unambiguous.
_QC_MPA = 12.0


async def _build_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
    *,
    lower_soil_b: str,
    correlate_lower: bool,
) -> dict:
    """Two CPTs, sand over ``SILT``/*lower_soil_b*, sand tops always correlated.

    Mirrors ``test_geotech_frame_conformance_flag._build_scene`` but stops
    BEFORE any hand-drawn tie: the machine (auto-correlate) is what proposes the
    packing ties here.

    Parameters
    ----------
    db_session : AsyncSession
        Session for direct row inspection.
    async_client : AsyncClient
        HTTP test client.
    lower_soil_b : str
        Main soil code of column B's lower unit (``"SILT"`` matches A).
    correlate_lower : bool
        Whether to litho-correlate the two LOWER units as well - a cross-soil
        surface tie in the positive case.

    Returns
    -------
    dict
        ``project_id``, ``section_id``, ``geotech_model_id``, ``cpt_a_id``,
        ``cpt_b_id``.
    """
    proj = ProjectOrm(id=uuid7(), name="Auto-tie frame warning test", status="active")
    db_session.add(proj)
    await db_session.commit()
    pid = str(proj.id)

    geo = await async_client.post(
        f"/projects/{pid}/geology/models", json={"name": "AT-Geo", "kind": "geological"}
    )
    assert geo.status_code == 201, geo.text
    litho = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "AT-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo.json()["id"],
        },
    )
    assert litho.status_code == 201, litho.text
    litho_model_id = litho.json()["id"]

    sec = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "AT-Section",
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
            project_id="AT",
            test_id=f"AT/{name}",
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

    # The SAND tops are always correlated - a same-soil, litho-connected pair.
    # The machine restates it onto the sand bands: a CONFORMING tie that must
    # stay unflagged, the in-scene negative control.
    await correlate(
        async_client,
        pid,
        litho_model_id,
        contact_a=contacts_a[0],
        contact_b=contacts_b[0],
        section_id=section_id,
    )
    if correlate_lower:
        # The LOWER tops - SILT (A) to KLEI/SILT (B). A lawful litho surface tie
        # even when it crosses soils; the machine will restate it onto the two
        # lower packing bands.
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
    """The geotech band on *cpt_id* whose top sits at *depth_top_m* (its id)."""
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


async def _auto_correlate(async_client: AsyncClient, scene: dict) -> dict:
    """Run the machine auto-correlate verb across the whole project."""
    resp = await async_client.post(
        f"/projects/{scene['project_id']}/geology/models/"
        f"{scene['geotech_model_id']}/geotech/auto-correlate",
        json={},
    )
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _edge_between(
    db_session: AsyncSession, geotech_model_id: str, band_a: str, band_b: str
) -> LithoContactCorrelationEdgeOrm:
    """The geotech edge joining *band_a* and *band_b* (canonical order agnostic)."""
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    wanted = {band_a, band_b}
    for row in rows:
        if {str(row.layer_a_id), str(row.layer_b_id)} == wanted:
            return row
    raise AssertionError(
        f"no edge between {band_a} and {band_b} among "
        f"{[(str(r.layer_a_id), str(r.layer_b_id)) for r in rows]}"
    )


@pytest.mark.asyncio
async def test_at1_machine_cross_soil_restatement_lands_flagged(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """AT1: the machine restates a cross-soil litho tie and the edge is born flagged."""
    scene = await _build_scene(db_session, async_client, lower_soil_b="KLEI", correlate_lower=True)
    lower_a = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_a_id"], _SPLIT_M)
    lower_b = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_b_id"], _SPLIT_M)
    sand_a = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_a_id"], 0.0)
    sand_b = await _band_top_at(db_session, scene["geotech_model_id"], scene["cpt_b_id"], 0.0)

    result = await _auto_correlate(async_client, scene)

    # The machine DID propose the cross-soil lower tie (no refusal) - the
    # precondition the whole test rests on.
    lower_edge = await _edge_between(db_session, scene["geotech_model_id"], lower_a, lower_b)
    # ... and it carries the exact badge a hand-drawn tie would, same field,
    # same reason constant.
    assert lower_edge.review_reason == "frame_mismatch", (
        "a machine restatement that exceeds the litho frame must be born flagged, "
        "exactly as the hand path flags the same tie"
    )
    # The run reports how many machine ties it flagged.
    assert result.get("frame_flagged_count") == 1

    # Selectivity: the conforming sand-band restatement in the SAME run is NOT
    # flagged. The warning is targeted, never a blanket "every machine tie".
    sand_edge = await _edge_between(db_session, scene["geotech_model_id"], sand_a, sand_b)
    assert sand_edge.review_reason is None, "a conforming machine tie must not be flagged"


@pytest.mark.asyncio
async def test_at2_conforming_machine_run_flags_nothing(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> None:
    """AT2: negative control - same-soil, litho-connected pairs flag nothing."""
    scene = await _build_scene(db_session, async_client, lower_soil_b="SILT", correlate_lower=True)

    result = await _auto_correlate(async_client, scene)

    assert result.get("frame_flagged_count") == 0
    flagged = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == scene["geotech_model_id"],
                    LithoContactCorrelationEdgeOrm.review_reason.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert flagged == [], f"a conforming run must flag nothing, flagged={flagged!r}"
