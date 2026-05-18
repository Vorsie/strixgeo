"""Integration: dry_run path of ExtrapolatePinchOut persists nothing.

Exercises the real DB + real Delaunay surface build so we can assert:

1. ``dry_run=True`` returns valid tip geometry (along_m + elevation_m).
2. No ``FormationContact`` rows are created in the DB.
3. The ``FormationSurface`` is NOT marked stale by the dry_run.
4. The ``dry_run=False`` (commit) path DOES create rows as a control,
   ensuring the early-exit did not accidentally block the commit path.

Runs only via ``scripts/run-integration-tests.ps1`` against the sibling
``groundmodel_integration`` DB (the integration conftest guard refuses
any other target).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.extrapolate_pinch_out import ExtrapolatePinchOut
from groundmodel.application.recompute_formation_surface import RecomputeFormationSurface
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

from ..conftest import make_project

# ---------------------------------------------------------------------------
# Shared geometry for both tests.
#
# Section runs east-west along y=200000 (Lambert 72).  Pinching formation
# dips from z=10 @ x=150000 to z=5 @ x=150050; target flat at z=0.
# Crossing is at x = 150050 + 5/0.1 = 150100 (along_m = 100 from start).
# ---------------------------------------------------------------------------
_START_X = 150000.0
_START_Y = 200000.0
_END_X = 150300.0
_END_Y = 200000.0

# Pinching surface: three non-collinear contacts.
_PINCHING_PTS = [
    (_START_X, _START_Y, 10.0),
    (_START_X + 50.0, _START_Y, 5.0),
    (_START_X + 25.0, _START_Y + 10.0, 7.5),
]
# Target surface: flat at z=0, wide enough for the ray to cross.
_TARGET_PTS = [
    (_START_X, _START_Y, 0.0),
    (_START_X + 300.0, _START_Y, 0.0),
    (_START_X + 150.0, _START_Y + 10.0, 0.0),
]


async def _setup(
    db_session: AsyncSession,
) -> tuple[GeologicalModelOrm, GeologicalFormationOrm, GeologicalFormationOrm, CrossSectionOrm]:
    """Create project, model, two formations, one section.

    Returns (model, pinching_formation, target_formation, section).
    """
    project = await make_project(db_session)

    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="TestModel",
        kind="geological",
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
        projection_buffer_m=30.0,  # NOT NULL, no server default
    )
    db_session.add_all([model, pinching, target, section])
    await db_session.flush()

    # No junction table: formations are project-level and are linked to a
    # model through FormationContact rows.  Simply insert contacts below.

    # Insert TIN-control contacts and build the surfaces. These use
    # source="interpolated" (a non-pinch source) deliberately: the
    # RecomputeFormationSurface synthetic branch is source-agnostic (it
    # keys only on borehole_id/cpt_id NULL + synthetic_x set), so these
    # still build the TIN — but they must NOT carry source=
    # 'pinch_out_extrapolation' or they would trip the use case's
    # idempotency guard (which is correctly source-filtered) and the
    # commit-path control test would be non-deterministic.
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

    # Build TIN surfaces (required for the use case to slice).
    await RecomputeFormationSurface(db_session).execute(model.id, pinching.id)
    await RecomputeFormationSurface(db_session).execute(model.id, target.id)

    return model, pinching, target, section


@pytest.mark.asyncio
async def test_dry_run_returns_geometry_no_db_rows(db_session: AsyncSession) -> None:
    """dry_run path returns valid tip geometry and creates zero contacts.

    After the call, the FormationContact count for the pinching formation
    must equal the 3 seed rows inserted during setup — no new rows.
    The FormationSurface for the pinching formation must NOT be stale
    (the dry_run must not have called mark_surfaces_stale).
    """
    model, pinching, target, section = await _setup(db_session)

    # Count contacts BEFORE the dry_run call.
    before_count = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == model.id,
                    FormationContactOrm.formation_id == pinching.id,
                )
            )
        )
        .scalars()
        .all()
    )
    seed_count = len(before_count)
    assert seed_count == 3  # the three synthetic seed contacts from _setup

    # Confirm the surface is currently NOT stale (was just rebuilt).
    surface_before = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.model_id == model.id,
                FormationSurfaceOrm.formation_id == pinching.id,
            )
        )
    ).scalar_one()
    assert surface_before.is_stale is False

    result = await ExtrapolatePinchOut(db_session).execute(
        project_id=section.app_project_id,
        model_id=model.id,
        formation_id=pinching.id,
        target_formation_id=target.id,
        section_id=section.id,
        direction="right",
        dry_run=True,
    )

    # Geometry must be computable and tip must be beyond the last slice point.
    assert result.created_contact_ids == []
    assert result.updated_section is None
    assert result.was_idempotent is False
    # The last pinching contact is at x=start+50 → along_m=50.
    # The crossing tip must lie further right.
    assert result.tip_along_m > 50.0
    assert 0.0 <= result.tip_elevation_m <= 5.0

    # No new contacts in the DB.
    after_count = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == model.id,
                    FormationContactOrm.formation_id == pinching.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(after_count) == seed_count

    # Surface must still be fresh (dry_run did not call mark_surfaces_stale).
    surface_after = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.model_id == model.id,
                FormationSurfaceOrm.formation_id == pinching.id,
            )
        )
    ).scalar_one()
    assert surface_after.is_stale is False


@pytest.mark.asyncio
async def test_commit_path_creates_contacts(db_session: AsyncSession) -> None:
    """Control: dry_run=False creates 2 new contacts + marks surface stale.

    Regression guard for the dry_run early-exit: the commit path must
    remain fully functional.
    """
    model, pinching, target, section = await _setup(db_session)

    before = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == model.id,
                    FormationContactOrm.formation_id == pinching.id,
                )
            )
        )
        .scalars()
        .all()
    )
    seed_count = len(before)

    result = await ExtrapolatePinchOut(db_session).execute(
        project_id=section.app_project_id,
        model_id=model.id,
        formation_id=pinching.id,
        target_formation_id=target.id,
        section_id=section.id,
        direction="right",
        dry_run=False,
    )

    # Clean path: the TIN-seed contacts are source='interpolated', so the
    # pinch-out idempotency guard (source-filtered to 'pinch_out_extrapolation')
    # does NOT fire — the commit creates exactly the tip + perpendicular twin.
    assert result.was_idempotent is False
    assert len(result.created_contact_ids) == 2

    after = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == model.id,
                    FormationContactOrm.formation_id == pinching.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(after) == seed_count + 2
    # The two created rows are the synthetic pinch-out pair.
    created = [c for c in after if str(c.id) in {str(i) for i in result.created_contact_ids}]
    assert len(created) == 2
    assert all(c.source == "pinch_out_extrapolation" for c in created)
    assert all(c.borehole_id is None and c.cpt_id is None for c in created)
    assert all(c.synthetic_x is not None for c in created)
    assert result.tip_along_m > 50.0
    assert 0.0 <= result.tip_elevation_m <= 5.0

    # The surface was marked stale by the commit path.
    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.model_id == model.id,
                FormationSurfaceOrm.formation_id == pinching.id,
            )
        )
    ).scalar_one()
    assert surface.is_stale is True
