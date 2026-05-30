"""Pin the post-A4 migration that prunes historical FC rows for litho models.

Migration ``r2l3m4n5o6p7_delete_litho_formation_contacts`` removes the
vestigial formation_contact mirror rows for litho models, keeping the
LL→FC trigger active so new accepted-layer INSERTs still create their
own FC mirror. Synthetic pinch-out FCs (anchor-less) are preserved —
debt #131-b future work has no LL counterpart.

Covered:
* Anchored litho FCs are deleted by the migration.
* Synthetic pinch-out litho FCs (no anchor) are preserved.
* Geological-model FCs are untouched.
* Existing accepted LL rows survive the migration (the FC→LL trigger
  is disabled around the DELETE so the cascade can't fire).
* Post-migration, the LL→FC trigger still re-creates an FC mirror on
  a fresh accepted-layer INSERT.
* The migration is idempotent (second run matches 0 rows).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.migrations.versions.r2l3m4n5o6p7_delete_litho_formation_contacts import (  # noqa: E501
    _DELETE_LITHO_FCS_SQL,
    _DISABLE_FC_TRIGGER_SQL,
    _ENABLE_FC_TRIGGER_SQL,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


async def _run_migration_upgrade(db_session: AsyncSession) -> None:
    """Execute the three-step migration in order — same shape the
    Alembic ``upgrade()`` body runs. asyncpg rejects multi-statement
    strings so each must be its own ``execute`` call."""
    await db_session.execute(text(_DISABLE_FC_TRIGGER_SQL))
    await db_session.execute(text(_DELETE_LITHO_FCS_SQL))
    await db_session.execute(text(_ENABLE_FC_TRIGGER_SQL))
    await db_session.commit()


@pytest_asyncio.fixture
async def setup(db_session: AsyncSession) -> dict:
    """Project + 1 geological model + 1 litho model + 1 BH + 1 formation."""
    project = ProjectOrm(id=uuid7(), name="Delete-litho-FC", status="active")
    db_session.add(project)
    await db_session.flush()
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="T",
        test_id="T",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="G", kind="geological"
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    db_session.add_all([bh, geo_model, litho_model, sand])
    await db_session.commit()
    return {
        "project": project,
        "bh": bh,
        "geo_model": geo_model,
        "litho_model": litho_model,
        "sand": sand,
    }


async def _row_exists(db_session: AsyncSession, table: str, row_id) -> bool:
    """SELECT bypassing the identity map — required because the
    integration session uses expire_on_commit=False and would otherwise
    return cached objects after a server-side DELETE removes the row.
    """
    result = await db_session.execute(text(f"SELECT 1 FROM {table} WHERE id = :id"), {"id": row_id})
    return result.first() is not None


@pytest.mark.asyncio
async def test_anchored_litho_fc_is_deleted(db_session: AsyncSession, setup: dict) -> None:
    """A historical anchored FC for a litho model is removed by the migration."""
    # Insert via LL (the LL→FC trigger creates the FC mirror).
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=3.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()
    # Sanity: mirror exists pre-migration.
    assert await _row_exists(db_session, "formation_contact", layer.id)

    await _run_migration_upgrade(db_session)

    # FC mirror gone; LL survives.
    assert not await _row_exists(db_session, "formation_contact", layer.id)
    assert await _row_exists(db_session, "litho_layer", layer.id)


@pytest.mark.asyncio
async def test_synthetic_pinch_out_litho_fc_is_preserved(
    db_session: AsyncSession, setup: dict
) -> None:
    """Anchor-less FCs (debt #131-b litho pinch-outs) survive the migration —
    no LL counterpart by Shape A, so deleting them would lose data."""
    synthetic_fc = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=None,
        cpt_id=None,
        depth_top_m=2.0,
        source="pinch_out_extrapolation",
        confidence="low",
        synthetic_x=150000.0,
        synthetic_y=200000.0,
        synthetic_elevation_m=-1.5,
    )
    db_session.add(synthetic_fc)
    await db_session.commit()
    fc_id = synthetic_fc.id

    await _run_migration_upgrade(db_session)

    assert await _row_exists(db_session, "formation_contact", fc_id)


@pytest.mark.asyncio
async def test_geological_model_fcs_are_untouched(db_session: AsyncSession, setup: dict) -> None:
    """Only litho-model FCs go — geological-model FCs are preserved."""
    geo_fc = FormationContactOrm(
        id=uuid7(),
        model_id=setup["geo_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(geo_fc)
    await db_session.commit()
    fc_id = geo_fc.id

    await _run_migration_upgrade(db_session)

    assert await _row_exists(db_session, "formation_contact", fc_id)


@pytest.mark.asyncio
async def test_accepted_layers_survive_the_delete(db_session: AsyncSession, setup: dict) -> None:
    """The FC→LL trigger is disabled around the DELETE — accepted LLs survive.

    Without the disable, the trigger's DELETE-NOT-IN clause would
    observe the FC deletion and prune every accepted LL on the same
    (model, anchor). This test pins that LL state IS preserved.
    """
    layer_ids = [uuid7() for _ in range(3)]
    layers = [
        LithoLayerOrm(
            id=lid,
            model_id=setup["litho_model"].id,
            formation_id=setup["sand"].id,
            borehole_id=setup["bh"].id,
            depth_top_m=depth,
            depth_base_m=depth + 1.0,
            status="accepted",
            source="manual",
            confidence="medium",
        )
        for lid, depth in zip(layer_ids, [0.0, 2.0, 4.0])
    ]
    db_session.add_all(layers)
    await db_session.commit()

    await _run_migration_upgrade(db_session)

    surviving = list(
        (await db_session.execute(select(LithoLayerOrm.id).where(LithoLayerOrm.id.in_(layer_ids))))
        .scalars()
        .all()
    )
    assert len(surviving) == 3
    assert set(surviving) == set(layer_ids)


@pytest.mark.asyncio
async def test_pending_and_rejected_layers_survive_too(
    db_session: AsyncSession, setup: dict
) -> None:
    """Pending and rejected LLs never had FC counterparts, so the DELETE
    can't touch them — but verify directly to pin the invariant."""
    pending = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=5.0,
        depth_base_m=6.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    rejected = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=7.0,
        depth_base_m=8.0,
        status="rejected",
        source="segmenter",
        confidence="low",
    )
    db_session.add_all([pending, rejected])
    await db_session.commit()

    await _run_migration_upgrade(db_session)

    assert await _row_exists(db_session, "litho_layer", pending.id)
    assert await _row_exists(db_session, "litho_layer", rejected.id)


@pytest.mark.asyncio
async def test_trigger_still_materialises_fc_for_new_layers_after_migration(
    db_session: AsyncSession, setup: dict
) -> None:
    """The LL→FC trigger stays alive — new accepted-layer INSERTs after
    the migration still produce FC mirrors. This pins the "pruning the
    historical data doesn't break future writes" invariant.
    """
    await _run_migration_upgrade(db_session)

    # Post-migration: insert a fresh accepted layer.
    new_layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(new_layer)
    await db_session.commit()

    # The LL→FC trigger should have created the FC mirror.
    assert await _row_exists(db_session, "formation_contact", new_layer.id)


@pytest.mark.asyncio
async def test_migration_is_idempotent(db_session: AsyncSession, setup: dict) -> None:
    """Running the migration twice is safe — the second run matches zero rows."""
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=3.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()

    # First run.
    await _run_migration_upgrade(db_session)
    # Second run — must not raise.
    await _run_migration_upgrade(db_session)

    # LL survives both runs.
    assert await _row_exists(db_session, "litho_layer", layer.id)
