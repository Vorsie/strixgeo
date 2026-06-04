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
2. Reconcile create-on-split: one correlation edge collapses the two
   layers into a single body (ordinal 0); deleting the edge re-splits
   the component, so the resolver CREATES a second body (ordinal 1).
3. Reconcile preserve-named-orphan: a named body whose (formation,
   ordinal) instance disappears survives, while an equivalent UNNAMED
   orphan body is deleted.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.claim_body_extent import ClaimBodyExtent
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@dataclass
class _TwoSandLayerCtx:
    """Seeded-row ids the two-SAND-layer fixture exposes to its tests.

    Attributes
    ----------
    project_id : UUID
        The owning project's id.
    model_id : UUID
        The lithostratigraphic model the layers + bodies belong to.
    formation_id : UUID
        The single SAND formation row both layers reference.
    layer_a_id : UUID
        The shallower accepted SAND layer (depth_top_m=2.0).
    layer_b_id : UUID
        The deeper accepted SAND layer (depth_top_m=10.0).
    """

    project_id: UUID
    model_id: UUID
    formation_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID


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
        layer_a_id=layer_a.id,
        layer_b_id=layer_b.id,
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


def _canonical_edge(
    *, model_id: UUID, layer_x: UUID, layer_y: UUID
) -> LithoContactCorrelationEdgeOrm:
    """Build a user-approved correlation edge with canonical endpoint order.

    The ``litho_contact_correlation_edge`` table enforces
    ``contact_a_id < contact_b_id`` (CHECK + caller normalisation), so the
    two layer ids are sorted before assignment.

    Parameters
    ----------
    model_id : UUID
        The lithostratigraphic model the edge belongs to.
    layer_x, layer_y : UUID
        The two litho_layer endpoints (order does not matter — sorted here).

    Returns
    -------
    LithoContactCorrelationEdgeOrm
        A manual, user-approved edge ready to ``session.add``.
    """
    a_id, b_id = sorted((layer_x, layer_y), key=str)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model_id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=True,
    )


@pytest.mark.asyncio
async def test_deleting_edge_creates_a_second_body_on_split(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Reconcile create path: one correlated body splits into two when the edge is deleted.

    Correlating both SAND layers makes ONE component → ONE body (ordinal
    0).  Deleting the edge re-splits the component, so the resolver must
    CREATE a second body (ordinal 1) — exercising the create-on-split
    branch of body reconciliation.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers

    # One user-approved edge: the two layers form a single component.
    edge = _canonical_edge(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    db_session.add(edge)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    bodies_before = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == ctx.model_id)))
        .scalars()
        .all()
    )
    assert len(bodies_before) == 1
    assert bodies_before[0].body_ordinal == 0

    # Uncorrelate by deleting the edge, then re-resolve.
    await db_session.delete(edge)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    bodies_after = (
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
    # A second body was created for the freed instance (ordinal 1).
    assert [b.body_ordinal for b in bodies_after] == [0, 1]

    # Both accepted layers now point at distinct, non-null bodies.
    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == ctx.model_id)
            )
        )
        .scalars()
        .all()
    )
    distinct = {ly.body_id for ly in layers}
    assert None not in distinct
    assert len(distinct) == 2


@pytest.mark.asyncio
async def test_named_orphan_body_is_preserved_while_unnamed_orphan_is_deleted(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Reconcile delete path: a named orphan survives, an unnamed orphan is deleted.

    First resolve produces two bodies (ordinals 0 + 1) for the two
    uncorrelated SAND layers.  Then BOTH member layers are deleted, so
    neither ``(formation, 0)`` nor ``(formation, 1)`` instance is wanted
    any more.  After naming the ordinal-0 body and re-resolving, the named
    body must survive (preserve-named guard) while the unnamed ordinal-1
    orphan is deleted.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers

    # First resolve → two bodies, ordinals 0 and 1.
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
    named_body_id = bodies[0].id
    unnamed_body_id = bodies[1].id

    # Name the ordinal-0 body; leave ordinal-1 unnamed.
    bodies[0].name = "Kept"
    await db_session.commit()

    # Orphan BOTH instances: delete both member layers so no instance is
    # wanted on the next resolve.
    for lid in (ctx.layer_a_id, ctx.layer_b_id):
        layer = await db_session.get(LithoLayerOrm, lid)
        assert layer is not None
        await db_session.delete(layer)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    # Read committed rows back: named body survives, unnamed orphan gone.
    surviving = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == ctx.model_id)))
        .scalars()
        .all()
    )
    surviving_ids = {b.id for b in surviving}
    assert named_body_id in surviving_ids
    assert unnamed_body_id not in surviving_ids
    assert len(surviving) == 1
    assert surviving[0].name == "Kept"


@pytest.mark.asyncio
async def test_anchored_extent_carries_forward_across_ordinal_renumber(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """A user-claimed open survives an instance renumber via its anchor (#195).

    Two stacked SAND instances resolve to bodies ordinal 0 (shallow=layer_a)
    and 1 (deep=layer_b). The deep body gets an ``open`` cap anchored to its
    own layer. Rejecting the shallow layer collapses the model to a single
    instance, so the deep layer renumbers 1 -> 0: the old (formation, 1) body
    is orphan-deleted and the (formation, 0) body is reused for the deep layer.
    Without carry-forward the open would vanish; the carry-forward re-attaches
    it to the body that now owns the anchor layer.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    # Claim open-left on the DEEP body (ordinal 1), anchored to layer_b.
    deep_body = (
        await db_session.execute(
            select(BodyOrm).where(
                BodyOrm.model_id == ctx.model_id,
                BodyOrm.body_ordinal == 1,
            )
        )
    ).scalar_one()
    await ClaimBodyExtent(db_session).execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        body_id=deep_body.id,
        side="left",
        kind="open",
        anchor_layer_id=ctx.layer_b_id,
    )

    # Collapse to a single instance: reject the shallow layer so only the deep
    # one remains accepted → it renumbers to ordinal 0.
    shallow = await db_session.get(LithoLayerOrm, ctx.layer_a_id)
    assert shallow is not None
    shallow.status = "rejected"
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    # Exactly one body remains, it owns the deep layer, and it carries the open
    # anchored to layer_b — the claim followed its anchor across the renumber.
    bodies = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == ctx.model_id)))
        .scalars()
        .all()
    )
    assert len(bodies) == 1
    survivor = bodies[0]
    deep_layer = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert deep_layer is not None and deep_layer.body_id == survivor.id
    assert survivor.extent_left_kind == "open"
    assert survivor.extent_left_anchor_layer_id == ctx.layer_b_id
