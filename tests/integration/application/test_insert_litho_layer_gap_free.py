"""Integration test: inserting an accepted litho layer keeps the column gap-free.

Owner directive 2026-06-04: the soil has no gaps. The FC↔LL mirror triggers
re-derive each accepted layer's ``depth_base_m`` from the next contact, so
inserting a new accepted unit inside an existing one must split it into
contiguous pieces (no gap, no overlap). This pins that the insert path relies
on the trigger correctly.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)

TOTAL_DEPTH_M = 8.0


class _Ctx:
    def __init__(self, model_id: UUID, bh_id: UUID, sand_id: UUID, clay_id: UUID) -> None:
        self.model_id = model_id
        self.bh_id = bh_id
        self.sand_id = sand_id
        self.clay_id = clay_id


@pytest_asyncio.fixture
async def two_layer_column(db_session: AsyncSession) -> _Ctx:
    """Two accepted layers spanning [0,4] and [4,8] on one borehole."""
    project = ProjectOrm(id=uuid7(), name="insert test", status="active")
    db_session.add(project)
    await db_session.flush()
    geo = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="Geo", kind="geological")
    db_session.add(geo)
    await db_session.flush()
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    parent = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="Quat", color="#ccc", display_order=0
    )
    db_session.add_all([litho, parent])
    await db_session.flush()

    def _formation(name: str, soil: str, color: str) -> GeologicalFormationOrm:
        return GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project.id,
            name=name,
            color=color,
            display_order=0,
            parent_formation_id=parent.id,
            litho_main_soil_code=soil,
        )

    sand = _formation("ZAND", "ZAND", "#e0c068")
    clay = _formation("KLEI", "KLEI", "#6f9e64")
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH",
        app_project_id=project.id,
        project_id="P",
        test_id="BH-1",
        location_x=160000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=TOTAL_DEPTH_M,
    )
    db_session.add_all([sand, clay, bh])
    await db_session.flush()

    repo = LithoLayerRepository(db_session)
    await repo.create_layer(
        model_id=litho.id,
        formation_id=sand.id,
        depth_top_m=0.0,
        depth_base_m=4.0,
        status="accepted",
        source="manual",
        borehole_id=bh.id,
    )
    await repo.create_layer(
        model_id=litho.id,
        formation_id=sand.id,
        depth_top_m=4.0,
        depth_base_m=8.0,
        status="accepted",
        source="manual",
        borehole_id=bh.id,
    )
    await db_session.commit()
    return _Ctx(litho.id, bh.id, sand.id, clay.id)


@pytest.mark.asyncio
async def test_insert_layer_splits_host_contiguously(
    db_session: AsyncSession, two_layer_column: _Ctx
) -> None:
    """Inserting a KLEI unit at [1,2] inside the [0,4] ZAND splits it gap-free.

    Result column: [0,1] ZAND, [1,2] KLEI, [2,4] ZAND, [4,8] ZAND — every base
    meets the next top, surface→test-bottom covered, no overlap.
    """
    ctx = two_layer_column
    repo = LithoLayerRepository(db_session)
    # Insert the new unit's TOP contact at 1 m (the FC→LL trigger re-derives all
    # bases). A second contact at 2 m closes the inserted unit's base.
    await repo.create_layer(
        model_id=ctx.model_id,
        formation_id=ctx.clay_id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="accepted",
        source="manual",
        borehole_id=ctx.bh_id,
    )
    await repo.create_layer(
        model_id=ctx.model_id,
        formation_id=ctx.sand_id,  # reuse the host (ZAND) formation for the lower split
        depth_top_m=2.0,
        depth_base_m=4.0,
        status="accepted",
        source="manual",
        borehole_id=ctx.bh_id,
    )
    await db_session.commit()

    rows = await repo.list_layers(ctx.model_id, status="accepted")
    depths = [(round(r.depth_top_m, 3), round(r.depth_base_m, 3)) for r in rows]
    # Gap-free + overlap-free: consecutive bases meet, 0→8 covered.
    assert depths[0][0] == pytest.approx(0.0, abs=0.01)
    assert depths[-1][1] == pytest.approx(TOTAL_DEPTH_M, abs=0.01)
    for upper, lower in zip(depths, depths[1:]):
        assert upper[1] == pytest.approx(lower[0], abs=0.01), f"gap/overlap between {upper} {lower}"
