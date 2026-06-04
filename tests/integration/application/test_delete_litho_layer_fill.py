"""Integration tests: deleting an accepted litho layer keeps the column gap-free.

Owner directive 2026-06-04: the soil has no gaps — every change to a litho
boundary must leave the column contiguous in the DB. The FC↔LL mirror triggers
re-derive each layer's ``depth_base_m`` from the next contact (or the test
bottom), so deleting a MIDDLE or BOTTOM layer auto-closes the column. This test
pins that invariant and surfaces the one case the trigger does NOT cover: a TOP
delete, where the new first layer would start below the surface.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.delete_litho_layer import DeleteLithoLayer
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)

TOTAL_DEPTH_M = 8.0


class _Ctx:
    """Ids the three-layer fixture exposes."""

    def __init__(
        self, project_id: UUID, model_id: UUID, top_id: UUID, mid_id: UUID, bot_id: UUID
    ) -> None:
        self.project_id = project_id
        self.model_id = model_id
        self.top_id = top_id
        self.mid_id = mid_id
        self.bot_id = bot_id


@pytest_asyncio.fixture
async def three_contiguous_layers(db_session: AsyncSession) -> _Ctx:
    """Seed one borehole with three accepted, contiguous ZAND layers.

    [0, 2] (top), [2, 5] (mid), [5, 8] (bot); test bottom = 8 so the last
    layer's trigger-derived base equals its seeded base.
    """
    project = ProjectOrm(id=uuid7(), name="delete-fill test", status="active")
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
    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND",
        color="#e0c068",
        display_order=0,
        parent_formation_id=parent.id,
        litho_main_soil_code="ZAND",
    )
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
    db_session.add_all([sand, bh])
    await db_session.flush()

    def _layer(top: float, base: float) -> LithoLayerOrm:
        return LithoLayerOrm(
            id=uuid7(),
            model_id=litho.id,
            formation_id=sand.id,
            borehole_id=bh.id,
            depth_top_m=top,
            depth_base_m=base,
            status="accepted",
            source="manual",
            confidence="medium",
        )

    top, mid, bot = _layer(0.0, 2.0), _layer(2.0, 5.0), _layer(5.0, 8.0)
    db_session.add_all([top, mid, bot])
    await db_session.commit()
    return _Ctx(project.id, litho.id, top.id, mid.id, bot.id)


async def _depths(session: AsyncSession, model_id: UUID) -> list[tuple[float, float]]:
    rows = await LithoLayerRepository(session).list_layers(model_id, status="accepted")
    return [(round(r.depth_top_m, 3), round(r.depth_base_m, 3)) for r in rows]


def _assert_gap_free(depths: list[tuple[float, float]], *, surface: float, bottom: float) -> None:
    """Every consecutive pair must meet; column must span surface→bottom."""
    assert depths, "column must not be empty"
    assert depths[0][0] == pytest.approx(surface, abs=0.01), f"top must start at surface: {depths}"
    assert depths[-1][1] == pytest.approx(bottom, abs=0.01), (
        f"bottom must reach test base: {depths}"
    )
    for upper, lower in zip(depths, depths[1:]):
        assert upper[1] == pytest.approx(lower[0], abs=0.01), f"gap between {upper} and {lower}"


@pytest.mark.asyncio
async def test_delete_middle_layer_is_gap_free(
    db_session: AsyncSession, three_contiguous_layers: _Ctx
) -> None:
    """Deleting the middle [2,5] — the trigger closes the column to [0,5],[5,8]."""
    ctx = three_contiguous_layers
    await DeleteLithoLayer(db_session).execute(
        ctx.mid_id, project_id=ctx.project_id, model_id=ctx.model_id
    )
    _assert_gap_free(await _depths(db_session, ctx.model_id), surface=0.0, bottom=TOTAL_DEPTH_M)


@pytest.mark.asyncio
async def test_delete_bottom_layer_is_gap_free(
    db_session: AsyncSession, three_contiguous_layers: _Ctx
) -> None:
    """Deleting the bottom [5,8] — the middle extends down to the test base."""
    ctx = three_contiguous_layers
    await DeleteLithoLayer(db_session).execute(
        ctx.bot_id, project_id=ctx.project_id, model_id=ctx.model_id
    )
    _assert_gap_free(await _depths(db_session, ctx.model_id), surface=0.0, bottom=TOTAL_DEPTH_M)


@pytest.mark.asyncio
async def test_delete_top_layer_is_gap_free(
    db_session: AsyncSession, three_contiguous_layers: _Ctx
) -> None:
    """Deleting the topmost [0,2] — the new first layer must still start at the surface."""
    ctx = three_contiguous_layers
    await DeleteLithoLayer(db_session).execute(
        ctx.top_id, project_id=ctx.project_id, model_id=ctx.model_id
    )
    _assert_gap_free(await _depths(db_session, ctx.model_id), surface=0.0, bottom=TOTAL_DEPTH_M)
