"""Integration tests for ResolveLithoInstances (body reconciliation).

Post-Task-3/4 the resolver operates at LAYER granularity: it loads
accepted ``litho_layer`` rows + user-approved correlation edges (whose
endpoints FK ``litho_layer.id``), runs the pure layer-level domain
resolver, reconciles one ``body`` row per connected component, and
stamps ``litho_layer.body_id`` on every member layer.

Coverage here:
1. Two uncorrelated same-formation SAND layers → two body rows
   (ordinals 0 + 1), every accepted layer stamped with a distinct
   body_id.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@dataclass
class _TwoSandLayerCtx:
    """Handles a fixture returns so the test can reference seeded ids.

    Attributes
    ----------
    project_id : UUID
        The owning project's id.
    model_id : UUID
        The lithostratigraphic model the layers + bodies belong to.
    formation_id : UUID
        The single SAND formation row both layers reference.
    """

    project_id: UUID
    model_id: UUID
    formation_id: UUID


@pytest_asyncio.fixture
async def litho_model_with_two_uncorrelated_sand_layers(
    db_session: AsyncSession,
) -> _TwoSandLayerCtx:
    """Seed one litho model with two accepted, uncorrelated SAND layers.

    Both layers share ONE formation row (litho_main_soil_code='ZAND'),
    sit on the same borehole anchor at different depths, and carry NO
    correlation edge between them — so the resolver must treat them as
    two distinct instances (two bodies).

    Returns
    -------
    _TwoSandLayerCtx
        project_id / model_id / formation_id for the test to query.
    """
    project = ProjectOrm(id=uuid7(), name="resolve-bodies test", status="active")
    db_session.add(project)
    await db_session.flush()

    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-RBI",
        kind="geological",
    )
    db_session.add(geo)
    await db_session.flush()

    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-RBI",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    parent = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Quat-RBI",
        color="#cccccc",
        display_order=0,
    )
    db_session.add_all([litho, parent])
    await db_session.flush()

    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND-RBI",
        color="#e0c068",
        display_order=0,
        parent_formation_id=parent.id,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    db_session.add(sand)
    await db_session.flush()

    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-RBI",
        app_project_id=project.id,
        project_id="RBI",
        test_id="BH-RBI-1",
        location_x=160000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add(borehole)
    await db_session.flush()

    # Two accepted SAND layers, same formation, same anchor, no edge.
    layer_a = LithoLayerOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=sand.id,
        borehole_id=borehole.id,
        depth_top_m=2.0,
        depth_base_m=4.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer_b = LithoLayerOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=sand.id,
        borehole_id=borehole.id,
        depth_top_m=10.0,
        depth_base_m=12.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add_all([layer_a, layer_b])
    await db_session.commit()

    return _TwoSandLayerCtx(
        project_id=project.id,
        model_id=litho.id,
        formation_id=sand.id,
    )


@pytest.mark.asyncio
async def test_two_uncorrelated_same_formation_layers_yield_two_bodies(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Distinct uncorrelated SAND layers -> two body rows, ordinals 0 and 1."""
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    bodies = (
        (
            await db_session.execute(
                select(BodyOrm)
                .where(BodyOrm.model_id == ctx.model_id)
                .order_by(BodyOrm.body_ordinal)
            )
        )
        .scalars()
        .all()
    )
    assert [b.body_ordinal for b in bodies] == [0, 1]

    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(LithoLayerOrm.model_id == ctx.model_id)
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    body_ids = {ly.body_id for ly in layers}
    assert None not in body_ids
    assert len(body_ids) == 2
