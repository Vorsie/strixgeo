"""Integration tests for the litho-lens create + delete endpoints (#101 Slice 3).

Tests are HTTP-level (real FastAPI app + real DB) to pin the contracts
that unit tests cannot reach: routing, scope guards, DB round-trips,
section seeding, and synthetic-contact creation.

Test scenarios
--------------
L1 — Happy path: lens created, absence recorded, synthetic contacts
     committed, section's seeded_formation_contact_ids updated.
L2 — Wrong model kind (geological): 422.
L3 — parent_formation_id not in model: 422.
L4 — present_contact_id not on parent formation: 422.
L5 — absent investigation not in project: 422.
L6 — No geometry possible (lens at corridor edge, no target formation):
     lens created, skipped_absent_count = 1.
L7 — Delete happy path: lens gone, synthetic contacts gone, anchored
     contacts survive.
L8 — Delete wrong model: 404.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm

from ..conftest import make_project

# ---------------------------------------------------------------------------
# Lambert 72 geometry for a simple E-W section.
# BH-A is at x=0 (along=0 m), BH-B is at x=200 (along=200 m).
# BH-C (absent) is at x=100 (along=100 m) — bracketed by A and B.
# Formation "ZAND" has contacts at A (elev=8m) and B (elev=6m).
# Formation "KLEI" (target) has contacts at A (elev=4m) and B (elev=4m).
# Expected tip: along ~100 m (bracketed), elevation where ZAND ray meets KLEI.
# ---------------------------------------------------------------------------
_START_X = 150000.0
_START_Y = 200000.0
_END_X = 150200.0
_END_Y = 200000.0
_BUF = 50.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_scene(
    db_session: AsyncSession,
) -> tuple[
    object,  # project
    GeologicalModelOrm,  # litho model
    GeologicalFormationOrm,  # ZAND (pinching)
    GeologicalFormationOrm,  # KLEI (target, display_order lower)
    BoreholeOrm,  # BH-A (present, x=start_x)
    BoreholeOrm,  # BH-B (present, x=end_x)
    BoreholeOrm,  # BH-C (absent, x=mid)
    CrossSectionOrm,  # section
]:
    """Build a minimal lens-geometry scene in the integration DB."""
    project = await make_project(db_session)

    # Two models — geological parent + lithostratigraphic child.
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Geo", kind="geological"
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )

    # KLEI is older (display_order=0), ZAND is younger (display_order=1).
    klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI",
        color="#aaa",
        display_order=0,
    )
    zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND",
        color="#fceb9a",
        display_order=1,
    )

    # Three boreholes: A at start, B at end, C at midpoint.
    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-A",
        app_project_id=project.id,
        project_id="P",
        test_id="A",
        location_x=_START_X,
        location_y=_START_Y,
        epsg=31370,
        total_depth_m=15.0,
        elevation_m=10.0,
    )
    bh_b = BoreholeOrm(
        id=uuid7(),
        name="BH-B",
        app_project_id=project.id,
        project_id="P",
        test_id="B",
        location_x=_END_X,
        location_y=_END_Y,
        epsg=31370,
        total_depth_m=15.0,
        elevation_m=10.0,
    )
    bh_c = BoreholeOrm(
        id=uuid7(),
        name="BH-C",
        app_project_id=project.id,
        project_id="P",
        test_id="C",
        location_x=(_START_X + _END_X) / 2,
        location_y=_START_Y,
        epsg=31370,
        total_depth_m=15.0,
        elevation_m=10.0,
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
        projection_buffer_m=_BUF,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
    )

    for obj in (geo_model, litho_model, klei, zand, bh_a, bh_b, bh_c, section):
        db_session.add(obj)
    await db_session.flush()

    # ZAND contacts in the litho model at BH-A (depth 2m → elev 8m)
    # and BH-B (depth 4m → elev 6m).
    zand_contact_a = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=zand.id,
        borehole_id=bh_a.id,
        depth_top_m=2.0,
        source="borehole_observation",
        confidence="medium",
    )
    zand_contact_b = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=zand.id,
        borehole_id=bh_b.id,
        depth_top_m=4.0,
        source="borehole_observation",
        confidence="medium",
    )
    # KLEI contacts (target) in the litho model — flat at depth 6m → elev 4m.
    klei_contact_a = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=klei.id,
        borehole_id=bh_a.id,
        depth_top_m=6.0,
        source="borehole_observation",
        confidence="medium",
    )
    klei_contact_b = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=klei.id,
        borehole_id=bh_b.id,
        depth_top_m=6.0,
        source="borehole_observation",
        confidence="medium",
    )

    for c in (zand_contact_a, zand_contact_b, klei_contact_a, klei_contact_b):
        db_session.add(c)
    await db_session.commit()

    return project, litho_model, zand, klei, bh_a, bh_b, bh_c, section


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_lens_happy_path(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """L1 — Lens created, absence + synthetics committed, section seeded."""
    project, litho_model, zand, klei, bh_a, bh_b, bh_c, section = await _make_scene(db_session)

    # Load the present ZAND contacts so we can pass them in.
    present_contacts = (
        (
            await db_session.execute(
                select(FormationContactOrm.id).where(
                    FormationContactOrm.model_id == litho_model.id,
                    FormationContactOrm.formation_id == zand.id,
                )
            )
        )
        .scalars()
        .all()
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(zand.id),
            "section_id": str(section.id),
            "name": "Sand lens 1",
            "present_contact_ids": [str(c) for c in present_contacts],
            "absent_investigations": [{"kind": "borehole", "id": str(bh_c.id)}],
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()

    # Lens id present.
    assert "lens_id" in body
    lens_id = body["lens_id"]

    # At least one synthetic contact (geometry is computable — both sides
    # are bracketed by A and B → two tips expected).
    assert len(body["synthetic_contact_ids"]) >= 1, (
        "Expected synthetic contacts from bracketed absent column"
    )

    # skipped_absent_count is 0 since both sides have contacts.
    assert body["skipped_absent_count"] == 0

    # Section echoed back.
    assert "updated_section" in body
    seeded = body["updated_section"]["seeded_formation_contact_ids"]
    # All synthetic + present contact ids are in the seeded set.
    all_expected = set(str(c) for c in present_contacts) | set(body["synthetic_contact_ids"])
    assert all_expected.issubset(set(seeded))

    # DB side-effects — lens row exists.
    lens_orm = await db_session.get(LithoLensOrm, lens_id)
    assert lens_orm is not None
    assert lens_orm.name == "Sand lens 1"
    assert str(lens_orm.parent_formation_id) == str(zand.id)

    # Present contacts are tagged with lens_id.
    for cid in present_contacts:
        c = await db_session.get(FormationContactOrm, cid)
        assert c is not None
        assert str(c.lens_id) == lens_id

    # Synthetic contacts have lens_id + correct source.
    for sid in body["synthetic_contact_ids"]:
        c = await db_session.get(FormationContactOrm, sid)
        assert c is not None
        assert str(c.lens_id) == lens_id
        assert c.source == "pinch_out_extrapolation"
        assert c.synthetic_x is not None
        assert c.synthetic_elevation_m is not None


@pytest.mark.asyncio
async def test_create_lens_wrong_model_kind(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """L2 — geological model kind returns 422."""
    project = await make_project(db_session)
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Geo", kind="geological"
    )
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="F1", color="#aaa"
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
        projection_buffer_m=_BUF,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
    )
    for obj in (geo_model, formation, section):
        db_session.add(obj)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{geo_model.id}/lenses",
        json={
            "parent_formation_id": str(formation.id),
            "section_id": str(section.id),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "wrong_model_kind"


@pytest.mark.asyncio
async def test_create_lens_formation_not_in_model(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """L3 — parent_formation_id has no contacts in model → 422."""
    project, litho_model, zand, klei, bh_a, bh_b, bh_c, section = await _make_scene(db_session)
    # Use a random formation id that has no contacts in the model.
    foreign_formation_id = uuid7()
    db_session.add(
        GeologicalFormationOrm(
            id=foreign_formation_id,
            app_project_id=project.id,
            name="Foreign",
            color="#000",
        )
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(foreign_formation_id),
            "section_id": str(section.id),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "create_lens_error"


@pytest.mark.asyncio
async def test_create_lens_bad_present_contact(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """L4 — present_contact_id not on parent formation → 422."""
    project, litho_model, zand, klei, bh_a, bh_b, bh_c, section = await _make_scene(db_session)
    # KLEI contact belongs to KLEI, not ZAND.
    klei_contacts = (
        (
            await db_session.execute(
                select(FormationContactOrm.id).where(
                    FormationContactOrm.model_id == litho_model.id,
                    FormationContactOrm.formation_id == klei.id,
                )
            )
        )
        .scalars()
        .all()
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(zand.id),
            "section_id": str(section.id),
            "present_contact_ids": [str(klei_contacts[0])],
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "create_lens_error"


@pytest.mark.asyncio
async def test_create_lens_absent_investigation_wrong_project(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """L5 — absent investigation in a different project → 422."""
    project, litho_model, zand, klei, bh_a, bh_b, bh_c, section = await _make_scene(db_session)
    # Another project's borehole.
    other_project = await make_project(db_session, name="Other")
    other_bh = BoreholeOrm(
        id=uuid7(),
        name="OTHER",
        app_project_id=other_project.id,
        project_id="P2",
        test_id="X",
        location_x=_START_X + 100,
        location_y=_START_Y,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(other_bh)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(zand.id),
            "section_id": str(section.id),
            "absent_investigations": [{"kind": "borehole", "id": str(other_bh.id)}],
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "create_lens_error"


@pytest.mark.asyncio
async def test_create_lens_no_geometry_all_skipped(
    async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """L6 — absent column with no target formation → skipped_absent_count = 1."""
    project = await make_project(db_session)

    # Litho model with a formation that has no neighbour (oldest = no target).
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
    )
    zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND_ONLY",
        color="#fceb9a",
        display_order=0,  # oldest → no older neighbour exists
    )
    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-A",
        app_project_id=project.id,
        project_id="P",
        test_id="A2",
        location_x=_START_X,
        location_y=_START_Y,
        epsg=31370,
        total_depth_m=15.0,
        elevation_m=10.0,
    )
    bh_absent = BoreholeOrm(
        id=uuid7(),
        name="BH-ABSENT",
        app_project_id=project.id,
        project_id="P",
        test_id="ABS",
        location_x=_START_X + 100,
        location_y=_START_Y,
        epsg=31370,
        total_depth_m=15.0,
        elevation_m=10.0,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="S2",
        start_x=_START_X,
        start_y=_START_Y,
        end_x=_END_X,
        end_y=_END_Y,
        epsg=31370,
        projection_buffer_m=_BUF,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
    )
    for obj in (litho_model, zand, bh_a, bh_absent, section):
        db_session.add(obj)
    await db_session.flush()

    contact_a = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=zand.id,
        borehole_id=bh_a.id,
        depth_top_m=2.0,
        source="borehole_observation",
        confidence="medium",
    )
    db_session.add(contact_a)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(zand.id),
            "section_id": str(section.id),
            "absent_investigations": [{"kind": "borehole", "id": str(bh_absent.id)}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Lens was created despite no geometry.
    assert body["skipped_absent_count"] == 1
    assert body["synthetic_contact_ids"] == []


@pytest.mark.asyncio
async def test_delete_lens_happy_path(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """L7 — Delete removes lens + synthetics; anchored contacts survive."""
    project, litho_model, zand, klei, bh_a, bh_b, bh_c, section = await _make_scene(db_session)

    present_contacts = (
        (
            await db_session.execute(
                select(FormationContactOrm.id).where(
                    FormationContactOrm.model_id == litho_model.id,
                    FormationContactOrm.formation_id == zand.id,
                )
            )
        )
        .scalars()
        .all()
    )

    # Create the lens first.
    create_resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(zand.id),
            "section_id": str(section.id),
            "present_contact_ids": [str(c) for c in present_contacts],
            "absent_investigations": [{"kind": "borehole", "id": str(bh_c.id)}],
        },
    )
    assert create_resp.status_code == 201
    lens_id = create_resp.json()["lens_id"]
    synthetic_ids = create_resp.json()["synthetic_contact_ids"]

    # Delete the lens.
    del_resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses/{lens_id}"
    )
    assert del_resp.status_code == 204

    # Lens row gone.
    await db_session.reset()  # expire in-memory cache
    lens_orm = (
        await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    ).scalar_one_or_none()
    assert lens_orm is None

    # Synthetic contacts gone.
    for sid in synthetic_ids:
        c = await db_session.get(FormationContactOrm, sid)
        assert c is None, f"Synthetic contact {sid} should have been deleted"

    # Anchored (present) contacts survive, lens_id cleared.
    for cid in present_contacts:
        c = await db_session.get(FormationContactOrm, cid)
        assert c is not None, f"Anchored contact {cid} must survive lens deletion"
        assert c.lens_id is None


@pytest.mark.asyncio
async def test_delete_lens_wrong_model(async_client: AsyncClient, db_session: AsyncSession) -> None:
    """L8 — Delete with wrong model_id returns 404."""
    project, litho_model, zand, klei, bh_a, bh_b, bh_c, section = await _make_scene(db_session)

    # Create a lens.
    create_resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model.id}/lenses",
        json={
            "parent_formation_id": str(zand.id),
            "section_id": str(section.id),
        },
    )
    assert create_resp.status_code == 201
    lens_id = create_resp.json()["lens_id"]

    # Try to delete using a random model_id.
    wrong_model_id = uuid7()
    del_resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{wrong_model_id}/lenses/{lens_id}"
    )
    # The model doesn't exist in the project → 404 from the model scope guard.
    assert del_resp.status_code == 404
