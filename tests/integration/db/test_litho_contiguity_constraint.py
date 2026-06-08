"""Integration tests: the deferred contiguity guard makes litho gaps un-committable.

Migration ``e1c2d3a4b5f6`` installs ``trg_litho_column_contiguous`` — a DEFERRED
constraint trigger that asserts, at COMMIT, that every accepted litho layer's
base meets the next accepted layer's top per (model, anchor). Normal flows stay
contiguous via the FC↔LL recompute, so the guard never fires for them; a stranded
gap (a write that bypasses the recompute, as legacy data did) is rejected loudly
instead of leaving a silent hole (dogfeed 2026-06-08, S13).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


class _Ctx:
    """Ids exposed by the litho-column fixture."""

    def __init__(self, model_id: UUID, formation_id: UUID, borehole_id: UUID) -> None:
        self.model_id = model_id
        self.formation_id = formation_id
        self.borehole_id = borehole_id


@pytest_asyncio.fixture
async def litho_column(db_session: AsyncSession) -> _Ctx:
    """A project + litho model + ZAND formation + one borehole (8 m), no layers."""
    project = ProjectOrm(id=uuid7(), name="contiguity test", status="active")
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
    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND",
        color="#e0c068",
        display_order=0,
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
        total_depth_m=8.0,
    )
    db_session.add_all([litho, sand, bh])
    await db_session.commit()
    return _Ctx(litho.id, sand.id, bh.id)


def _layer(ctx: _Ctx, top: float, base: float) -> LithoLayerOrm:
    """Build an accepted ZAND layer on the fixture borehole."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=ctx.model_id,
        formation_id=ctx.formation_id,
        borehole_id=ctx.borehole_id,
        depth_top_m=top,
        depth_base_m=base,
        status="accepted",
        source="manual",
        confidence="medium",
    )


@pytest.mark.asyncio
async def test_contiguous_column_commits_clean(
    db_session: AsyncSession, litho_column: _Ctx
) -> None:
    """A gap-free accepted column commits without tripping the guard."""
    db_session.add_all([_layer(litho_column, 0.0, 5.0), _layer(litho_column, 5.0, 8.0)])
    await db_session.commit()  # must not raise


@pytest.mark.asyncio
async def test_stranded_gap_rejected_at_commit(
    db_session: AsyncSession, litho_column: _Ctx
) -> None:
    """A gap that bypasses the FC↔LL recompute is rejected at COMMIT.

    Disabling the two mirror triggers strands a gap exactly as a legacy /
    bypassing write would (base 2 with the next layer's top at 5). The deferred
    contiguity trigger — left enabled — must raise at commit.
    """
    # Disable the mirrors BEFORE any insert (no pending trigger events yet, so
    # the ALTER is allowed — you cannot ALTER a table with deferred events
    # queued). The DDL is part of this transaction; the failing commit rolls it
    # back, so nothing leaks to other tests.
    await db_session.execute(
        text("ALTER TABLE litho_layer DISABLE TRIGGER trg_mirror_litho_layer_to_contact")
    )
    await db_session.execute(
        text("ALTER TABLE formation_contact DISABLE TRIGGER trg_mirror_litho_contact_to_layer")
    )
    # base 2 but the next layer starts at 5 → a 3 m gap the recompute would have
    # closed; with the mirrors off it survives to commit.
    db_session.add_all([_layer(litho_column, 0.0, 2.0), _layer(litho_column, 5.0, 8.0)])
    with pytest.raises(Exception, match="not contiguous"):
        await db_session.commit()
