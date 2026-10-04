"""Integration tests for ResolveLithoInstances (body reconciliation).

Post-Task-3/4 the resolver operates at LAYER granularity: it loads
accepted ``litho_layer`` rows + geometry facts (the union) + accepted ties
(never a union since 2026-10-04 — identity follows the drawing), runs the
pure layer-level domain resolver, reconciles one ``body`` row per connected
component, and stamps ``litho_layer.body_id`` on every member layer.

Coverage here:
1. Two uncorrelated same-formation SAND layers → two body rows
   (ordinals 0 + 1), every accepted layer stamped with a distinct
   body_id.
2. Reconcile create-on-split: one painted band (geometry fact) collapses
   the two layers into a single body (ordinal 0); deleting the fact
   re-splits the component, so the resolver CREATES a second body
   (ordinal 1) — even though the accepted tie stays.
2b. Identity follows the drawing (owner 2026-10-04): an accepted tie with
   no geometry fact joins nothing — two bodies.
3. Reconcile preserve-named-orphan: a named body whose (formation,
   ordinal) instance disappears survives, while an equivalent UNNAMED
   orphan body is deleted.

Note: the test for anchor-carry-forward across ordinal renumber
(test_anchored_extent_carries_forward_across_ordinal_renumber) was
removed alongside the ClaimBodyExtent use case it depended on.
The carry-forward logic is exercised by the unit-level tests for
the domain service.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._litho_builders import geometry_fact


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
        parent_model_id=geo.id,
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
    *, model_id: UUID, layer_x: UUID, layer_y: UUID, section_id: UUID
) -> LithoContactCorrelationEdgeOrm:
    """Build a user-approved correlation edge with canonical endpoint order.

    The ``litho_contact_correlation_edge`` table enforces
    ``layer_a_id < layer_b_id`` (CHECK + caller normalisation), so the
    two layer ids are sorted before assignment.

    Parameters
    ----------
    model_id : UUID
        The lithostratigraphic model the edge belongs to.
    layer_x, layer_y : UUID
        The two litho_layer endpoints (order does not matter — sorted here).
    section_id : UUID
        The section this edge was authored on (NOT NULL post Task 4).

    Returns
    -------
    LithoContactCorrelationEdgeOrm
        A manual, user-approved edge ready to ``session.add``.
    """
    a_id, b_id = sorted((layer_x, layer_y), key=str)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model_id,
        layer_a_id=a_id,
        layer_b_id=b_id,
        source="manual",
        user_approved=True,
        section_id=section_id,
    )


async def _add_section(db_session: AsyncSession, project_id: UUID) -> CrossSectionOrm:
    """Add a minimal section so a tie's NOT NULL ``section_id`` FK holds."""
    sec = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Sec-RBI",
        start_x=100000.0,
        start_y=200000.0,
        end_x=200000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[],
    )
    db_session.add(sec)
    await db_session.flush()
    return sec


async def _distinct_body_ids(db_session: AsyncSession, model_id: UUID) -> set[UUID | None]:
    """The set of ``body_id`` stamps on the model's layers."""
    db_session.expire_all()
    layers = (
        (await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.model_id == model_id)))
        .scalars()
        .all()
    )
    return {ly.body_id for ly in layers}


@pytest.mark.asyncio
async def test_an_accepted_tie_the_fill_does_not_band_leaves_two_bodies(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Owner 2026-10-04, "identity follows the drawing": a tie alone joins nothing.

    The CS4 case: two ZAND (SL:M) bands joined by one accepted top tie that the
    fill does not paint as a band (sub-TD, no base tie = no band), so there is
    NO geometry fact for the pair. Two bodies. Once the fill paints the band
    (the renderer posts the fact), one body.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    sec = await _add_section(db_session, ctx.project_id)
    db_session.add(
        _canonical_edge(
            model_id=ctx.model_id,
            layer_x=ctx.layer_a_id,
            layer_y=ctx.layer_b_id,
            section_id=sec.id,
        )
    )
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    body_ids = await _distinct_body_ids(db_session, ctx.model_id)
    assert None not in body_ids
    assert len(body_ids) == 2, "a tie the fill does not band must not join the bands"

    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    await db_session.commit()
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    assert len(await _distinct_body_ids(db_session, ctx.model_id)) == 1, (
        "the painted band (its geometry fact) joins the two bands into one body"
    )


@pytest.mark.asyncio
async def test_deleting_edge_creates_a_second_body_on_split(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Reconcile create path: one painted body splits into two when its fact goes.

    A tie the fill paints as a band (tie + geometry fact) makes ONE component →
    ONE body (ordinal 0). Deleting the fact (the fill no longer paints the
    band) re-splits the component even though the tie stays, so the resolver
    must CREATE a second body (ordinal 1) — exercising the create-on-split
    branch of body reconciliation.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers

    sec = await _add_section(db_session, ctx.project_id)

    # One user-approved tie the fill paints as a band: tie + its geometry fact.
    edge = _canonical_edge(
        model_id=ctx.model_id,
        layer_x=ctx.layer_a_id,
        layer_y=ctx.layer_b_id,
        section_id=sec.id,
    )
    fact = _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    db_session.add_all([edge, fact])
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    bodies_before = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == ctx.model_id)))
        .scalars()
        .all()
    )
    assert len(bodies_before) == 1
    assert bodies_before[0].body_ordinal == 0

    # The fill stops painting the band: delete the fact (the tie stays), re-resolve.
    await db_session.delete(fact)
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


def _canonical_fact(*, model_id: UUID, layer_x: UUID, layer_y: UUID) -> BodyGeometryFactOrm:
    """Build a geometry fact with canonical endpoint order.

    ``body_geometry_fact`` enforces ``layer_a_id < layer_b_id`` (CHECK +
    caller normalisation, the correlation-edge pattern), so the two layer
    ids are sorted before assignment.

    Parameters
    ----------
    model_id : UUID
        The model the fact belongs to.
    layer_x, layer_y : UUID
        The two litho_layer endpoints (order does not matter — sorted here).

    Returns
    -------
    BodyGeometryFactOrm
        A fact row ready to ``session.add``.
    """
    return geometry_fact(model_id=model_id, layer_x=layer_x, layer_y=layer_y)


@pytest.mark.asyncio
async def test_fact_edge_unions_two_uncorrelated_same_litho_layers(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """A geometry fact unions (owner rulings 2026-08-12 and 2026-10-04).

    *"every same litho that is connected should get the same body id"*, where
    connected means painted as one mass (*"identity follows the drawing"*): the
    fact records that the fill painted the two layers as one mass, and it is the
    ONLY thing the resolver unions on. No tie exists in this scene, so before
    the fact the two SAND layers are two bodies; with the fact they must be ONE.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == ctx.model_id)
            )
        )
        .scalars()
        .all()
    )
    body_ids = {ly.body_id for ly in layers}
    assert None not in body_ids
    assert len(body_ids) == 1, "the geometry fact must union the two layers into one body"


@pytest.mark.asyncio
async def test_fact_edge_across_lithologies_is_dropped(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """The one-lithology invariant filters facts.

    A fact can only be born same-formation (the union rule requires it), but
    a later litho edit can flip one endpoint's soil. The pure resolver's
    soil-code filter must drop such a fact rather than weld a sand to a clay.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=ctx.project_id,
        name="KLEI-RBI",
        color="#8a9a5b",
        display_order=1,
        litho_main_soil_code="KLEI",
        instance_ordinal=0,
    )
    db_session.add(klei)
    await db_session.flush()
    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_b is not None
    layer_b.formation_id = klei.id
    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    layers = (
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == ctx.model_id)
            )
        )
        .scalars()
        .all()
    )
    body_ids = {ly.body_id for ly in layers}
    assert len(body_ids) == 2, "a cross-lithology fact must never union"


@pytest.mark.asyncio
async def test_fact_edge_to_rejected_layer_is_ignored(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """The dangling-endpoint guard neutralises a fact whose layer was rejected.

    A status flip leaves the fact row in place (no cascade fires); the pure
    resolver ignores edges whose endpoints are not in the accepted-node set,
    and the fact must ride the same guard until the next recompute replaces it.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_b is not None
    layer_b.status = "rejected"
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    layer_a = await db_session.get(LithoLayerOrm, ctx.layer_a_id)
    assert layer_a is not None
    assert layer_a.body_id is not None, "the surviving layer still gets its own body"
    facts = (
        (
            await db_session.execute(
                select(BodyGeometryFactOrm).where(BodyGeometryFactOrm.model_id == ctx.model_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(facts) == 1, "a status flip must NOT delete the fact — only a recompute replaces it"


@pytest.mark.asyncio
async def test_fact_edge_to_deleted_layer_cascades_away(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Deleting a layer takes its facts with it (FK CASCADE), and resolve survives."""
    ctx = litho_model_with_two_uncorrelated_sand_layers
    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    await db_session.commit()

    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_b is not None
    await db_session.delete(layer_b)
    await db_session.commit()

    facts = (
        (
            await db_session.execute(
                select(BodyGeometryFactOrm).where(BodyGeometryFactOrm.model_id == ctx.model_id)
            )
        )
        .scalars()
        .all()
    )
    assert facts == [], "the FK cascade must remove facts whose layer died"

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    layer_a = await db_session.get(LithoLayerOrm, ctx.layer_a_id)
    assert layer_a is not None
    assert layer_a.body_id is not None


async def _bodies_of(db_session: AsyncSession, model_id: UUID) -> list[BodyOrm]:
    """All body rows of a model, oldest first."""
    return list(
        (
            await db_session.execute(
                select(BodyOrm).where(BodyOrm.model_id == model_id).order_by(BodyOrm.created_at)
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_merge_of_two_named_bodies_keeps_the_oldest_name(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """Owner ruling 2026-08-12: when named bodies merge, the OLDEST name wins.

    Age is the BODY's age via its layers' lineage, not the surviving row's
    ``created_at`` — ordinal renumbering recycles rows, so the row's age lies.
    The displaced name is reported so the toast can say what happened.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    db_session.expire_all()
    layer_a = await db_session.get(LithoLayerOrm, ctx.layer_a_id)
    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_a is not None and layer_b is not None
    body_a = await db_session.get(BodyOrm, layer_a.body_id)
    body_b = await db_session.get(BodyOrm, layer_b.body_id)
    assert body_a is not None and body_b is not None
    body_a.name = "Oldest sand"
    body_a.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    body_b.name = "Younger sand"
    body_b.created_at = datetime(2026, 6, 1, tzinfo=UTC)
    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    await db_session.commit()

    result = await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    db_session.expire_all()
    layer_a = await db_session.get(LithoLayerOrm, ctx.layer_a_id)
    assert layer_a is not None
    survivor = await db_session.get(BodyOrm, layer_a.body_id)
    assert survivor is not None
    assert survivor.name == "Oldest sand"
    assert "Younger sand" in result.renamed, "the displaced name must be reported"
    names = [b.name for b in await _bodies_of(db_session, ctx.model_id) if b.name]
    assert names.count("Oldest sand") == 1, "one name, one owner"


@pytest.mark.asyncio
async def test_merge_adopts_the_single_donors_name_onto_the_survivor(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """An unnamed survivor takes the lineage's only name — nothing is lost."""
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    db_session.expire_all()
    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_b is not None
    body_b = await db_session.get(BodyOrm, layer_b.body_id)
    assert body_b is not None
    body_b.name = "Solo"
    db_session.add(
        _canonical_fact(model_id=ctx.model_id, layer_x=ctx.layer_a_id, layer_y=ctx.layer_b_id)
    )
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    db_session.expire_all()
    bodies = await _bodies_of(db_session, ctx.model_id)
    assert len(bodies) == 1, "the merge leaves one body row — the donor's name MOVED"
    assert bodies[0].name == "Solo"


@pytest.mark.asyncio
async def test_ordinal_shift_alone_keeps_name_and_boundary(
    db_session: AsyncSession,
    litho_model_with_two_uncorrelated_sand_layers: _TwoSandLayerCtx,
) -> None:
    """A renumbering must not strip a body of its name or hand-drawn boundary.

    Deleting the shallow body's layer shifts the deep component's ordinal
    1 → 0, so the (formation, ordinal) key lands on the OTHER row. Without
    lineage adoption the live body forgot its name and the boundary shape
    died with the recycled row (FK CASCADE) — user-authored state destroyed
    by a background renumbering.
    """
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    db_session.expire_all()
    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_b is not None
    body_b = await db_session.get(BodyOrm, layer_b.body_id)
    assert body_b is not None
    body_b.name = "Keep"
    body_b.display_color = "#123456"
    db_session.add(BodyBoundaryShapeOrm(id=uuid7(), body_id=body_b.id, model_id=ctx.model_id))
    layer_a = await db_session.get(LithoLayerOrm, ctx.layer_a_id)
    assert layer_a is not None
    await db_session.delete(layer_a)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    db_session.expire_all()
    layer_b = await db_session.get(LithoLayerOrm, ctx.layer_b_id)
    assert layer_b is not None
    live = await db_session.get(BodyOrm, layer_b.body_id)
    assert live is not None
    assert live.name == "Keep"
    assert live.display_color == "#123456"
    shapes = (
        (
            await db_session.execute(
                select(BodyBoundaryShapeOrm).where(BodyBoundaryShapeOrm.body_id == live.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(shapes) == 1, "the hand-drawn boundary must follow the surviving body"
    assert len(await _bodies_of(db_session, ctx.model_id)) == 1
