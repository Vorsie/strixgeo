"""Integration tests for ResolveLithoInstances consuming layer-level edges.

Post-Task-3/4 the resolver runs at LAYER granularity: connectivity is
built over user-approved ``LithoContactCorrelationEdgeOrm`` rows whose
endpoints FK ``litho_layer.id``, and the result is reconciled into one
``body`` row per connected component (identity ``(formation_id,
body_ordinal)``). It no longer writes ``geological_formation.instance_ordinal``
— body identity is the durable record of an instance, so these tests
assert body ordinals.

Since 2026-10-04 (owner: "identity follows the drawing") only a geometry
fact unions; a tie is read but never joins. The scenes that expect one body
therefore seed the fact the renderer posts for the painted band
(``geometry_fact``) beside the tie.

Cases covered:
1. Two SAND layers (same formation, two columns) linked by ONE
   user-approved edge the fill paints as a band (+ its fact) → one
   connected component → exactly one body.
2. An unapproved (auto-proposed) edge between two SAND layers does NOT
   merge components → two distinct bodies (ordinals 0 + 1).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._litho_builders import (
    geo_model as _geo_model,
)
from tests.integration._litho_builders import (
    geometry_fact,
)
from tests.integration._litho_builders import (
    litho_model as _litho_model,
)

# ---------------------------------------------------------------------------
# Private fixture helpers (not reusable outside this module)
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved ``BoreholeOrm`` with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="RLIC",
        test_id=f"BH-RLIC-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _geo_formation(project: ProjectOrm, *, name: str = "Quaternary") -> GeologicalFormationOrm:
    """Return an unsaved geological-level ``GeologicalFormationOrm`` (no parent)."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#cccccc",
        display_order=0,
    )


def _formation(
    project: ProjectOrm,
    parent: GeologicalFormationOrm,
    *,
    name: str,
    soil_code: str,
) -> GeologicalFormationOrm:
    """Return an unsaved litho-level ``GeologicalFormationOrm``.

    Parameters
    ----------
    project : ProjectOrm
        Owning project.
    parent : GeologicalFormationOrm
        Geological parent formation (provides ``parent_formation_id``).
        Litho formations always carry a parent; the resolver groups
        ordinals per ``(parent_formation_id, litho_main_soil_code)``.
    name : str
        Human-readable formation name.
    soil_code : str
        BaseLithology token (ZAND/KLEI/SILT/GRIND/VEEN).
    """
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=0,
        parent_formation_id=parent.id,
        litho_main_soil_code=soil_code,
    )


def _layer(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth_top: float,
    depth_base: float,
) -> LithoLayerOrm:
    """Return an unsaved accepted ``LithoLayerOrm`` on a borehole anchor."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth_top,
        depth_base_m=depth_base,
        status="accepted",
        source="manual",
        confidence="medium",
    )


def _minimal_section(project: ProjectOrm, *, name: str) -> CrossSectionOrm:
    """Return an unsaved minimal CrossSectionOrm (just needs to exist for the FK)."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        start_x=100000.0,
        start_y=200000.0,
        end_x=200000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[],
    )


def _layer_edge(
    model: GeologicalModelOrm,
    la: LithoLayerOrm,
    lb: LithoLayerOrm,
    *,
    user_approved: bool = True,
    section_id: UUID,
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved layer-level correlation edge between two layers.

    Endpoints FK ``litho_layer.id`` (post-A4). Canonically orders the
    two layer ids to satisfy the DB CHECK constraint.

    Parameters
    ----------
    section_id : UUID
        The section this edge was authored on (NOT NULL post Task 4).
    """
    a_id = min(la.id, lb.id)
    b_id = max(la.id, lb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        layer_a_id=a_id,
        layer_b_id=b_id,
        source="manual",
        user_approved=user_approved,
        section_id=section_id,
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for resolver tests."""
    proj = ProjectOrm(id=uuid7(), name="resolver layer test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: approved layer edge → single connected component → one body
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approved_edge_forms_one_component_one_body(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Two SAND layers linked via a painted, user-approved edge resolve to one body.

    The resolver detects the connected component and reconciles exactly
    one ``body`` row (ordinal 0); both member layers are stamped with
    that body's id.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary A")
    f_sand = _formation(project, geo_parent, name="ZAND occ A", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="001", x=150000.0)
    bh_b = _borehole(project.id, suffix="002", x=150300.0)

    db_session.add_all([geo, litho, geo_parent, f_sand, bh_a, bh_b])
    await db_session.flush()

    la = _layer(litho, f_sand, bh_a, depth_top=3.0, depth_base=5.0)
    lb = _layer(litho, f_sand, bh_b, depth_top=4.0, depth_base=6.0)
    db_session.add_all([la, lb])
    await db_session.flush()

    sec = _minimal_section(project, name="Sec-RLIC-A")
    db_session.add(sec)
    await db_session.flush()

    edge = _layer_edge(litho, la, lb, user_approved=True, section_id=sec.id)
    db_session.add_all([edge, geometry_fact(model_id=litho.id, layer_x=la.id, layer_y=lb.id)])
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    bodies = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(bodies) == 1, (
        f"Expected exactly one body for the merged component; got {len(bodies)}"
    )
    assert bodies[0].body_ordinal == 0

    # Both member layers point at the same body.
    layers = (
        (await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    body_ids = {ly.body_id for ly in layers}
    assert body_ids == {bodies[0].id}


# ---------------------------------------------------------------------------
# Test 2: unapproved layer edge → two separate components → two bodies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unapproved_edge_does_not_merge_components(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """An unapproved (auto-proposed) edge must NOT form a connected component.

    The two SAND layers resolve to two distinct bodies (ordinals 0 + 1)
    because the resolver only consumes ``user_approved=True`` edges.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary B")
    f_sand = _formation(project, geo_parent, name="ZAND occ B", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="011", x=150000.0)
    bh_b = _borehole(project.id, suffix="012", x=150300.0)

    db_session.add_all([geo, litho, geo_parent, f_sand, bh_a, bh_b])
    await db_session.flush()

    la = _layer(litho, f_sand, bh_a, depth_top=2.0, depth_base=4.0)
    lb = _layer(litho, f_sand, bh_b, depth_top=5.0, depth_base=7.0)
    db_session.add_all([la, lb])
    await db_session.flush()

    sec = _minimal_section(project, name="Sec-RLIC-B")
    db_session.add(sec)
    await db_session.flush()

    # user_approved=False — this edge must be invisible to the resolver.
    unapproved_edge = _layer_edge(litho, la, lb, user_approved=False, section_id=sec.id)
    db_session.add(unapproved_edge)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    bodies = (
        (
            await db_session.execute(
                select(BodyOrm).where(BodyOrm.model_id == litho.id).order_by(BodyOrm.body_ordinal)
            )
        )
        .scalars()
        .all()
    )
    assert [b.body_ordinal for b in bodies] == [0, 1], (
        f"Layers connected only by an unapproved edge must resolve to two bodies; "
        f"got {[b.body_ordinal for b in bodies]}"
    )

    # The two accepted layers each map to a distinct body.
    layers = (
        (await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    body_ids = {ly.body_id for ly in layers}
    assert None not in body_ids
    assert len(body_ids) == 2


# ---------------------------------------------------------------------------
# Test 3 (audit #10): body_id stamping is one UPDATE per body, not per layer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_body_id_stamping_is_one_update_per_body(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Three layers in ONE component stamp in a single UPDATE (audit #10 N+1).

    The resolver groups layer ids by target body and issues one
    ``UPDATE litho_layer ... SET body_id`` per distinct body, instead of one
    per layer. With three members in one body the count must be 1, not 3.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary QC")
    f_sand = _formation(project, geo_parent, name="ZAND occ QC", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="021", x=150000.0)
    bh_b = _borehole(project.id, suffix="022", x=150300.0)
    bh_c = _borehole(project.id, suffix="023", x=150600.0)
    db_session.add_all([geo, litho, geo_parent, f_sand, bh_a, bh_b, bh_c])
    await db_session.flush()

    la = _layer(litho, f_sand, bh_a, depth_top=3.0, depth_base=5.0)
    lb = _layer(litho, f_sand, bh_b, depth_top=4.0, depth_base=6.0)
    lc = _layer(litho, f_sand, bh_c, depth_top=4.0, depth_base=6.0)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    sec = _minimal_section(project, name="Sec-RLIC-QC")
    db_session.add(sec)
    await db_session.flush()

    # Chain a-b-c via approved, painted edges → ONE connected component (one body).
    db_session.add_all(
        [
            _layer_edge(litho, la, lb, user_approved=True, section_id=sec.id),
            _layer_edge(litho, lb, lc, user_approved=True, section_id=sec.id),
            geometry_fact(model_id=litho.id, layer_x=la.id, layer_y=lb.id),
            geometry_fact(model_id=litho.id, layer_x=lb.id, layer_y=lc.id),
        ]
    )
    await db_session.commit()

    stamp_updates = {"n": 0}
    sync_engine = db_session.bind.sync_engine

    def _count(conn, cursor, statement, params, context, executemany):  # noqa: ANN001
        s = statement.lstrip().lower()
        if s.startswith("update litho_layer") and "body_id" in s:
            stamp_updates["n"] += 1

    event.listen(sync_engine, "before_cursor_execute", _count)
    try:
        await ResolveLithoInstances(db_session).execute(model_id=litho.id)
    finally:
        event.remove(sync_engine, "before_cursor_execute", _count)

    assert stamp_updates["n"] == 1, (
        f"Expected one grouped UPDATE for the single body; got {stamp_updates['n']}"
    )

    layers = (
        (await db_session.execute(select(LithoLayerOrm).where(LithoLayerOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len({ly.body_id for ly in layers}) == 1
