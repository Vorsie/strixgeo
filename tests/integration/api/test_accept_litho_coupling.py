"""Integration tests: litho↔geo contact coupling on accept (#162 Task 3 + Task 4).

Verifies that ``AcceptLithoSuggestions.execute`` links a newly-accepted litho
contact to the nearest geological contact within ``couple_tolerance_m`` (default
0.20 m) and snaps the geo contact's depth to the litho depth.

Test cases
----------
CP1  Litho top within tolerance of a geo contact → ``parent_geo_contact_id``
     is set on the litho contact AND the geo contact's ``depth_top_m`` is
     snapped to the litho depth.
CP2  Litho top mid-formation, far from every geo contact → ``parent_geo_contact_id``
     is None (no spurious coupling).
CP3  After a coupling snap, the parent geological model's surface for the
     touched formation is rebuilt (``is_stale=False``) — once per accept,
     not per contact (#162 Task 4).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for coupling tests."""
    proj = ProjectOrm(id=uuid7(), name="litho-geo coupling test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def stack(db_session: AsyncSession, project: ProjectOrm, async_client: AsyncClient) -> dict:
    """Create the full geo/litho stack, a borehole, and one geological contact at 3.0 m.

    Returns a dict with keys:
        geo_model, litho_model, geo_formation, borehole, geo_contact
    """
    # Geological model + one formation.
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model = geo_resp.json()

    geo_f_resp = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={"name": "Boom Klei", "color": "#888", "display_order": 0},
    )
    assert geo_f_resp.status_code == 201, geo_f_resp.text
    geo_formation = geo_f_resp.json()

    # Litho model — child of the geological model.
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model = litho_resp.json()

    # Borehole used as the contact anchor.
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-coupling",
        app_project_id=project.id,
        project_id="TEST",
        test_id="CP-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=30.0,
    )
    db_session.add(bh)
    await db_session.commit()

    # Geological contact at 3.0 m (the coupling target).
    geo_contact_resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{geo_model['id']}/contacts",
        json={
            "formation_id": geo_formation["id"],
            "depth_top_m": 3.0,
            "borehole_id": str(bh.id),
            "source": "manual_pick",
            "confidence": "high",
        },
    )
    assert geo_contact_resp.status_code == 201, geo_contact_resp.text
    geo_contact = geo_contact_resp.json()

    return {
        "geo_model": geo_model,
        "litho_model": litho_model,
        "geo_formation": geo_formation,
        "borehole": bh,
        "geo_contact": geo_contact,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _accept(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    litho_model_id: str,
    *,
    top: float,
    base: float,
    lithology: str,
    borehole_id: str,
) -> dict:
    """POST accept-litho-suggestions for a single layer; assert 200."""
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
        json={
            "borehole_id": borehole_id,
            "suggestions": [
                {
                    "depth_top_m": top,
                    "depth_base_m": base,
                    "suggested_lithology": lithology,
                    "confidence": "high",
                    "source": "borehole_observation",
                    "suggested_admixtures": [],
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# CP1 — litho top within tolerance → coupled + geo contact snapped
# ---------------------------------------------------------------------------


async def test_cp1_litho_within_tolerance_couples_and_snaps(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """A litho contact accepted within couple_tolerance_m (0.20 m) of a geological
    contact on the same borehole must be linked and the geo contact snapped.

    Setup: geo contact at 3.0 m.  Litho suggestion top at 2.95 m (delta 0.05 m,
    within 0.20 m tolerance).

    Expected:
    - The created litho contact has ``parent_geo_contact_id`` == geo contact id.
    - The geological contact's ``depth_top_m`` is snapped from 3.0 → 2.95 m.
    """
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]
    geo_contact_id = stack["geo_contact"]["id"]

    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=2.95,
        base=8.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )

    # Re-query the litho contact.
    litho_rows = list(
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == stack["litho_model"]["id"]
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(litho_rows) == 1, f"Expected 1 litho contact, got {len(litho_rows)}"
    litho_contact = litho_rows[0]

    assert litho_contact.parent_geo_contact_id is not None, (
        "Litho contact accepted within couple_tolerance_m must have parent_geo_contact_id set"
    )
    assert str(litho_contact.parent_geo_contact_id) == geo_contact_id, (
        f"parent_geo_contact_id {litho_contact.parent_geo_contact_id} "
        f"does not match the geological contact {geo_contact_id}"
    )

    # Re-query the geo contact to verify the snap.
    geo_row = (
        await db_session.execute(
            select(FormationContactOrm).where(
                FormationContactOrm.id == litho_contact.parent_geo_contact_id
            )
        )
    ).scalar_one_or_none()
    assert geo_row is not None
    assert geo_row.depth_top_m == pytest.approx(2.95, abs=1e-6), (
        f"Geo contact depth should have been snapped from 3.0 → 2.95 m, got {geo_row.depth_top_m}"
    )


# ---------------------------------------------------------------------------
# CP2 — litho top mid-formation → no coupling
# ---------------------------------------------------------------------------


async def test_cp2_mid_formation_litho_has_no_coupling(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """A litho contact accepted far from every geological contact (mid-formation)
    must have ``parent_geo_contact_id = None`` — no spurious link.

    Setup: geo contact at 3.0 m.  Litho suggestion top at 1.0 m (delta 2.0 m,
    well outside 0.20 m tolerance).

    Expected: ``parent_geo_contact_id`` is None.
    """
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]

    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=1.0,
        base=2.5,
        lithology="ZAND",
        borehole_id=bh_id,
    )

    litho_rows = list(
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == stack["litho_model"]["id"]
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(litho_rows) == 1, f"Expected 1 litho contact, got {len(litho_rows)}"
    litho_contact = litho_rows[0]

    assert litho_contact.parent_geo_contact_id is None, (
        f"Litho contact at 1.0 m (2.0 m from geo contact at 3.0 m) must NOT be "
        f"coupled; got parent_geo_contact_id={litho_contact.parent_geo_contact_id}"
    )


# ---------------------------------------------------------------------------
# CP3 — geo surface rebuilt after coupling snap (#162 Task 4)
# ---------------------------------------------------------------------------


async def test_cp3_geo_surface_rebuilt_after_coupling_snap(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """After a litho accept that snaps a geological contact, the parent geological
    model's surface for the touched formation must be rebuilt (is_stale=False).

    Setup:
    - Geo contact at 3.0 m with a pre-existing surface row (is_stale=True to
      simulate the state immediately after the snap mutates the contact's depth
      and before the router triggers the rebuild).  We seed the surface as stale
      so the test exercises the rebuild leg rather than the "no surface" case.
    - Litho suggestion top at 2.95 m (delta 0.05 m, within 0.20 m tolerance)
      → coupling fires, geo contact snapped, router should call
      RebuildModelSurfaces on the parent geo model.

    Expected:
    - After the accept HTTP call, the FormationSurface row for (geo_model,
      geo_formation) has is_stale=False (the rebuild cleared it).
    - The surface row exists (created by the rebuild if it did not exist
      beforehand, or refreshed if it was stale).
    """
    geo_model = stack["geo_model"]
    geo_formation = stack["geo_formation"]
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]

    # Pre-create a stale surface row for the geo formation so we can assert
    # that the rebuild clears it.  Stale mirrors the state the contact-update
    # path would leave behind (mark_surfaces_stale fires on every depth change).
    stale_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo_model["id"],
        formation_id=geo_formation["id"],
        method="tin",
        # Minimal valid geometry — the rebuild will replace this.
        vertices=[
            [149990.0, 199990.0, -3.0],
            [150010.0, 199990.0, -3.0],
            [150000.0, 200010.0, -3.0],
        ],
        triangles=[[0, 1, 2]],
        source_contact_count=1,
        source_contact_checksum=b"\x01" * 8,
        is_stale=True,  # stale — rebuild must clear this
    )
    db_session.add(stale_surface)
    await db_session.commit()

    # Accept a litho suggestion within coupling tolerance (2.95 m vs geo at 3.0 m).
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=2.95,
        base=8.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )

    # The router must have called RebuildModelSurfaces on the parent geo model;
    # that rebuilds (or upserts) the surface and sets is_stale=False.
    await db_session.refresh(stale_surface)
    assert stale_surface.is_stale is False, (
        "After a coupling snap the parent geo model's surface for the touched "
        f"formation must be rebuilt (is_stale=False); got is_stale={stale_surface.is_stale}"
    )


# ---------------------------------------------------------------------------
# CP4 — a re-accept RESTORES a severed link (owner ruling F34)
# ---------------------------------------------------------------------------


async def test_cp4_a_reaccept_restores_a_severed_link_without_resnapping(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """CP4 — the found-existing branch re-links; it still never re-snaps.

    The branch deliberately skips the SNAP on re-accept ("a re-accept never
    silently snaps a geo contact a second time") — and used to throw the LINK
    out with it, which is how the dev model grew litho rows sitting bit-for-bit
    on a geological contact with no ``parent_geo_contact_id``. Owner ruling
    2026-08-11 (audit F34): *"it shouldn't be that easy to unlink them."* A
    re-accept that finds the layer unlinked and a geo contact within tolerance
    restores the link; the geo contact's depth is left exactly where it is.
    """
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]
    geo_contact_id = stack["geo_contact"]["id"]

    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=2.95,
        base=8.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )

    # Sever the link the way history did — the label goes, the depths stay.
    layer = (
        await db_session.execute(
            select(LithoLayerOrm).where(
                LithoLayerOrm.model_id == litho_mid,
                LithoLayerOrm.depth_top_m == 2.95,
            )
        )
    ).scalar_one()
    layer.parent_geo_contact_id = None
    await db_session.commit()
    layer_id = layer.id

    # Nudge the geo contact slightly so a re-snap would be observable.
    geo_row = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == geo_contact_id)
        )
    ).scalar_one()
    geo_row.depth_top_m = 3.05  # still within the 0.20 m couple tolerance
    await db_session.commit()
    geo_row_id = geo_row.id  # plain value: expire_all detaches loaded attributes

    # The same suggestion again — the found-existing path.
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=2.95,
        base=8.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )

    db_session.expire_all()
    layer_after = await db_session.get(LithoLayerOrm, layer_id)
    assert layer_after is not None
    assert str(layer_after.parent_geo_contact_id) == geo_contact_id, (
        "the re-accept must restore the severed link"
    )
    geo_after = await db_session.get(FormationContactOrm, geo_row_id)
    assert geo_after is not None
    assert geo_after.depth_top_m == pytest.approx(3.05, abs=1e-6), (
        "the re-accept must NOT re-snap the geo contact — only the link returns"
    )
