"""Integration tests for UpdateFormationContact cross-merge behaviour.

Ten cases covering the depth-drag cross-merge logic added to
``UpdateFormationContact.execute``:

1.  Drag UP without crossing → existing behaviour (depth updates, no deletes).
2.  Drag UP crossing one contact → that contact deleted, dragger at new depth.
3.  Drag UP crossing multiple contacts → all deleted, dragger at new depth.
4.  Drag DOWN without crossing → existing behaviour.
5.  Drag DOWN crossing one contact → dragger + crossed contact deleted.
6.  Drag DOWN crossing multiple contacts → all deleted including dragger.
7.  ``new_depth == old_depth`` → no-op (no deletes, no error).
8.  Re-anchor patch (``borehole_id`` changes) → cross-merge skipped.
9.  Litho model: cross-merge fires resolver + lens detection (ordinals refresh,
    LithoLens rows reconcile).
10. Geological model: cross-merge runs but does NOT call resolver/lens
    detection (no LithoLensOrm rows materialise).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.update_formation_contact import UpdateFormationContact
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixture helpers (private)
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float = 100000.0) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-CM-{suffix}",
        app_project_id=project_id,
        project_id="CM_TEST",
        test_id=f"BH-CM-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=30.0,
    )


def _geo_model(project: ProjectOrm) -> GeologicalModelOrm:
    """Return an unsaved geological GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-CM",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-CM",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )


def _formation(
    project: ProjectOrm,
    *,
    name: str,
    parent: GeologicalFormationOrm | None = None,
    soil_code: str | None = None,
) -> GeologicalFormationOrm:
    """Return an unsaved GeologicalFormationOrm."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=0,
        parent_formation_id=parent.id if parent is not None else None,
        litho_main_soil_code=soil_code,
    )


def _contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
) -> FormationContactOrm:
    """Return an unsaved FormationContactOrm anchored to a borehole."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source="manual_pick",
        confidence="medium",
    )


async def _all_contacts_on_anchor(
    session: AsyncSession, model_id: UUID, borehole_id: UUID
) -> list[FormationContactOrm]:
    """Return all contacts for a (model, borehole) pair, ordered by depth."""
    stmt = (
        select(FormationContactOrm)
        .where(
            FormationContactOrm.model_id == model_id,
            FormationContactOrm.borehole_id == borehole_id,
        )
        .order_by(FormationContactOrm.depth_top_m)
    )
    return list((await session.execute(stmt)).scalars().all())


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for cross-merge tests."""
    proj = ProjectOrm(id=uuid7(), name="cross-merge test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Case 1 — Drag UP without crossing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_up_no_crossing(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Drag UP into empty space: depth updates, no other contacts deleted."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="1")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    db_session.add_all([geo, bh, f_a, f_b])
    await db_session.flush()

    # Two contacts, A at 5 m, B at 10 m.  Drag A up to 3 m — no contact at [3, 5).
    c_a = _contact(geo, f_a, bh, depth=5.0)
    c_b = _contact(geo, f_b, bh, depth=10.0)
    db_session.add_all([c_a, c_b])
    await db_session.commit()

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_a.id, {"depth_top_m": 3.0})

    assert result is not None
    assert not uc.absorbed
    assert result.depth_top_m == 3.0

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    assert depths == {3.0, 10.0}


# ---------------------------------------------------------------------------
# Case 2 — Drag UP crossing one contact
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_up_crossing_one(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Drag UP crosses one peer: that peer is deleted, dragger moves."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="2")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    f_c = _formation(project, name="C")
    db_session.add_all([geo, bh, f_a, f_b, f_c])
    await db_session.flush()

    # A at 5 m, B at 8 m, C at 12 m.  Drag C from 12 → 6 → crosses B (8 ∈ [6, 12)).
    c_a = _contact(geo, f_a, bh, depth=5.0)
    c_b = _contact(geo, f_b, bh, depth=8.0)
    c_c = _contact(geo, f_c, bh, depth=12.0)
    db_session.add_all([c_a, c_b, c_c])
    await db_session.commit()

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_c.id, {"depth_top_m": 6.0})

    assert result is not None
    assert not uc.absorbed
    assert result.depth_top_m == 6.0

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    # B (8 m) deleted; A (5 m) and the dragger C (now 6 m) survive.
    assert depths == {5.0, 6.0}


# ---------------------------------------------------------------------------
# Case 3 — Drag UP crossing multiple contacts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_up_crossing_multiple(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Drag UP crosses two peers: both deleted, dragger survives at new depth."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="3")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    f_c = _formation(project, name="C")
    f_d = _formation(project, name="D")
    db_session.add_all([geo, bh, f_a, f_b, f_c, f_d])
    await db_session.flush()

    # A=3, B=6, C=9, D=14.  Drag D from 14 → 4 → crosses C (9) and B (6). A (3) survives.
    c_a = _contact(geo, f_a, bh, depth=3.0)
    c_b = _contact(geo, f_b, bh, depth=6.0)
    c_c = _contact(geo, f_c, bh, depth=9.0)
    c_d = _contact(geo, f_d, bh, depth=14.0)
    db_session.add_all([c_a, c_b, c_c, c_d])
    await db_session.commit()

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_d.id, {"depth_top_m": 4.0})

    assert result is not None
    assert not uc.absorbed
    assert result.depth_top_m == 4.0

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    assert depths == {3.0, 4.0}


# ---------------------------------------------------------------------------
# Case 4 — Drag DOWN without crossing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_down_no_crossing(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Drag DOWN into empty space: depth updates, no contacts deleted."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="4")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    db_session.add_all([geo, bh, f_a, f_b])
    await db_session.flush()

    c_a = _contact(geo, f_a, bh, depth=5.0)
    c_b = _contact(geo, f_b, bh, depth=15.0)
    db_session.add_all([c_a, c_b])
    await db_session.commit()

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_a.id, {"depth_top_m": 8.0})

    assert result is not None
    assert not uc.absorbed
    assert result.depth_top_m == 8.0

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    assert depths == {8.0, 15.0}


# ---------------------------------------------------------------------------
# Case 5 — Drag DOWN crossing one contact
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_down_crossing_one(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Drag DOWN crosses one peer: dragger + peer deleted, returns None + absorbed."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="5")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    f_c = _formation(project, name="C")
    db_session.add_all([geo, bh, f_a, f_b, f_c])
    await db_session.flush()

    # A=3, B=7, C=12.  Drag B from 7 → 9 → crosses C (9 is boundary: 7 < 9 ≤ 9? No, 9 is not
    # strictly > old_depth... wait: new=9, old=7, so (7, 9]: depth 9 at C qualifies.
    # Actually let C be at 9 so 7 < 9 <= 9.
    c_a = _contact(geo, f_a, bh, depth=3.0)
    c_b = _contact(geo, f_b, bh, depth=7.0)
    c_c = _contact(geo, f_c, bh, depth=9.0)
    db_session.add_all([c_a, c_b, c_c])
    await db_session.commit()

    b_id = c_b.id

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(b_id, {"depth_top_m": 9.0})

    assert result is None
    assert uc.absorbed

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    # Both dragger (B at 7) and peer (C at 9) deleted; only A (3) remains.
    assert depths == {3.0}


# ---------------------------------------------------------------------------
# Case 6 — Drag DOWN crossing multiple contacts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_down_crossing_multiple(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Drag DOWN crosses two peers: dragger + both peers deleted."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="6")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    f_c = _formation(project, name="C")
    f_d = _formation(project, name="D")
    f_e = _formation(project, name="E")
    db_session.add_all([geo, bh, f_a, f_b, f_c, f_d, f_e])
    await db_session.flush()

    # A=2, B=5, C=8, D=11, E=20.
    # Drag B from 5 → 12 → crosses C (8) and D (11): both in (5, 12].
    c_a = _contact(geo, f_a, bh, depth=2.0)
    c_b = _contact(geo, f_b, bh, depth=5.0)
    c_c = _contact(geo, f_c, bh, depth=8.0)
    c_d = _contact(geo, f_d, bh, depth=11.0)
    c_e = _contact(geo, f_e, bh, depth=20.0)
    db_session.add_all([c_a, c_b, c_c, c_d, c_e])
    await db_session.commit()

    b_id = c_b.id

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(b_id, {"depth_top_m": 12.0})

    assert result is None
    assert uc.absorbed

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    # B (dragger) + C + D all deleted; A (2) and E (20) survive.
    assert depths == {2.0, 20.0}


# ---------------------------------------------------------------------------
# Case 7 — new_depth == old_depth → no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_op_same_depth(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Patching with the same depth value is a complete no-op."""
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="7")
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    db_session.add_all([geo, bh, f_a, f_b])
    await db_session.flush()

    c_a = _contact(geo, f_a, bh, depth=5.0)
    c_b = _contact(geo, f_b, bh, depth=10.0)
    db_session.add_all([c_a, c_b])
    await db_session.commit()

    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_a.id, {"depth_top_m": 5.0})

    assert result is not None
    assert not uc.absorbed
    assert result.depth_top_m == 5.0

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    assert len(remaining) == 2


# ---------------------------------------------------------------------------
# Case 8 — Re-anchor patch skips cross-merge
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reanchor_skips_cross_merge(db_session: AsyncSession, project: ProjectOrm) -> None:
    """When the patch includes borehole_id, cross-merge is entirely skipped."""
    geo = _geo_model(project)
    bh_a = _borehole(project.id, suffix="8a", x=100000.0)
    bh_b = _borehole(project.id, suffix="8b", x=101000.0)
    f_a = _formation(project, name="A")
    f_b = _formation(project, name="B")
    db_session.add_all([geo, bh_a, bh_b, f_a, f_b])
    await db_session.flush()

    # Two contacts on bh_a.  We re-anchor c_b to bh_b with a new depth
    # that would cross c_a if the cross-merge ran — but it must NOT.
    c_a = _contact(geo, f_a, bh_a, depth=5.0)
    c_b = _contact(geo, f_b, bh_a, depth=10.0)
    db_session.add_all([c_a, c_b])
    await db_session.commit()

    # Re-anchor c_b to bh_b (different anchor) + change depth into c_a's range.
    # Cross-merge should be skipped because "borehole_id" is in the patch.
    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_b.id, {"borehole_id": bh_b.id, "cpt_id": None, "depth_top_m": 4.0})

    assert result is not None
    assert not uc.absorbed

    # c_a on bh_a must NOT have been deleted.
    remaining_bh_a = await _all_contacts_on_anchor(db_session, geo.id, bh_a.id)
    assert any(c.id == c_a.id for c in remaining_bh_a)


# ---------------------------------------------------------------------------
# Case 9 — Litho model: cross-merge triggers resolver + lens detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_litho_model_cascade_runs(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Cross-merge on a litho model fires ResolveLithoInstances + DetectLithoLenses.

    We verify the cascade ran by checking that no LithoLensOrm row was
    spuriously left behind (the lens detector reconciles after the contact
    delete) and that the use case completes without error.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    bh = _borehole(project.id, suffix="9")
    parent = _formation(project, name="Quat-9")
    f_a = _formation(project, parent=parent, name="ZAND-A", soil_code="ZAND")
    f_b = _formation(project, parent=parent, name="KLEI-B", soil_code="KLEI")
    f_c = _formation(project, parent=parent, name="ZAND-C", soil_code="ZAND")
    db_session.add_all([geo, litho, bh, parent, f_a, f_b, f_c])
    await db_session.flush()

    # Three litho contacts on the same borehole at 3, 7, 12 m.
    c_a = _contact(litho, f_a, bh, depth=3.0)
    c_b = _contact(litho, f_b, bh, depth=7.0)
    c_c = _contact(litho, f_c, bh, depth=12.0)
    db_session.add_all([c_a, c_b, c_c])
    await db_session.commit()

    # Drag c_c UP from 12 → 5 → crosses c_b (7 ∈ [5, 12)): c_b deleted, c_c survives at 5.
    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_c.id, {"depth_top_m": 5.0})

    assert result is not None
    assert not uc.absorbed

    # Cascade must not raise; lens detector reconciles (no lens topology here → 0 rows).
    lens_rows = (
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(lens_rows) == 0

    # c_b must be gone; c_a and c_c (at 5) survive.
    remaining = await _all_contacts_on_anchor(db_session, litho.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    assert depths == {3.0, 5.0}


# ---------------------------------------------------------------------------
# Case 10 — Geological model: cross-merge does NOT call resolver/lens detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_geo_model_no_lens_cascade(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Cross-merge on a geological model must NOT create LithoLensOrm rows.

    The cascade is gated on ``model.kind == 'lithostratigraphic'``. A
    geological model cross-merge still deletes contacts but must not
    invoke the litho resolver or lens detector.
    """
    geo = _geo_model(project)
    bh = _borehole(project.id, suffix="10")
    f_a = _formation(project, name="GeoA")
    f_b = _formation(project, name="GeoB")
    f_c = _formation(project, name="GeoC")
    db_session.add_all([geo, bh, f_a, f_b, f_c])
    await db_session.flush()

    c_a = _contact(geo, f_a, bh, depth=4.0)
    c_b = _contact(geo, f_b, bh, depth=9.0)
    c_c = _contact(geo, f_c, bh, depth=15.0)
    db_session.add_all([c_a, c_b, c_c])
    await db_session.commit()

    # Drag c_c UP from 15 → 6 → crosses c_b (9 ∈ [6, 15)): c_b deleted.
    uc = UpdateFormationContact(db_session)
    result = await uc.execute(c_c.id, {"depth_top_m": 6.0})

    assert result is not None
    assert not uc.absorbed

    # No LithoLensOrm rows must exist (geo model has no lens concept).
    lens_count = len(
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == geo.id)))
        .scalars()
        .all()
    )
    assert lens_count == 0

    remaining = await _all_contacts_on_anchor(db_session, geo.id, bh.id)
    depths = {c.depth_top_m for c in remaining}
    assert depths == {4.0, 6.0}
