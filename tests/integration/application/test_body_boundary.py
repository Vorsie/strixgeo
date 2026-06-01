"""Integration tests for the body-boundary shape use cases (#body-with-extent 2026-05-31).

Replaces test_lens_boundary.py. The ``content_key`` concept is gone — body
rows are keyed by id (stable FK on ``body_boundary_shape.body_id``), so the
carry-forward test (which relied on a shared content_key surviving body
recreation) is intentionally dropped.

Verifies:
- GET/PUT round-trip: stores nodes + render style, returns sorted result.
- Full-replace: second PUT replaces prior node set rather than appending.
- Scope guard: wrong project_id → BodyNotFoundError.
- Precondition guard: no primary_section_id → BodyNoPrimarySectionError.
- Bundle serialises shape + nodes + body_id round-trip.
- Cascade: boundary nodes are removed when their shape row is deleted.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.body_boundary import (
    BodyBoundaryState,
    BodyNoPrimarySectionError,
    BodyNotFoundError,
    BoundaryNode,
    GetBodyBoundary,
    SaveBodyBoundary,
)
from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import build_project_bundle


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession):
    """A project + litho model + section + formation + a body row.

    The body carries a ``primary_section_id`` and a ``source_investigation_id``
    so the save path's preconditions are satisfied.
    """
    proj = ProjectOrm(id=uuid7(), name="body boundary test", status="active")
    db_session.add(proj)
    await db_session.flush()

    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-BBT-1",
        app_project_id=proj.id,
        project_id="BBT",
        test_id="BH-BBT-1",
        location_x=100.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add(borehole)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="S1",
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )
    parent = GeologicalFormationOrm(
        id=uuid7(), app_project_id=proj.id, name="Q", color="#ccc", display_order=0
    )
    db_session.add_all([geo, litho, section, parent])
    await db_session.flush()
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND lens",
        color="#abc",
        display_order=0,
        parent_formation_id=parent.id,
        litho_main_soil_code="ZAND",
        instance_ordinal=0,
    )
    db_session.add(formation)
    await db_session.flush()

    body = BodyOrm(
        id=uuid7(),
        app_project_id=proj.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        # source_investigation_id is NOT NULL — use the borehole we created above.
        source_investigation_id=borehole.id,
        primary_section_id=section.id,
    )
    db_session.add(body)
    await db_session.commit()
    return {
        "project": proj,
        "litho": litho,
        "section": section,
        "formation": formation,
        "body": body,
    }


@pytest.mark.asyncio
async def test_save_then_get_roundtrip_sorts_and_reindexes(
    db_session: AsyncSession, scene: dict
) -> None:
    """PUT stores nodes; GET returns them sorted by along_m + the render style."""
    proj, litho, body = scene["project"], scene["litho"], scene["body"]
    await SaveBodyBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        body_id=body.id,
        # deliberately out of order — server must sort by along_m
        upper_nodes=[BoundaryNode(20.0, 8.0), BoundaryNode(10.0, 9.0)],
        lower_nodes=[BoundaryNode(15.0, 2.0)],
        render_style="blocky",
    )
    state = await GetBodyBoundary(db_session).execute(
        project_id=proj.id, model_id=litho.id, body_id=body.id
    )
    assert state.render_style == "blocky"
    assert [(n.along_m, n.elevation_m) for n in state.upper_nodes] == [(10.0, 9.0), (20.0, 8.0)]
    assert [(n.along_m, n.elevation_m) for n in state.lower_nodes] == [(15.0, 2.0)]


@pytest.mark.asyncio
async def test_save_is_full_replace(db_session: AsyncSession, scene: dict) -> None:
    """A second PUT replaces the prior node set rather than appending."""
    proj, litho, body = scene["project"], scene["litho"], scene["body"]
    await SaveBodyBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        body_id=body.id,
        upper_nodes=[BoundaryNode(5.0, 1.0), BoundaryNode(6.0, 2.0)],
        lower_nodes=[],
        render_style="straight",
    )
    await SaveBodyBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        body_id=body.id,
        upper_nodes=[BoundaryNode(7.0, 3.0)],
        lower_nodes=[],
        render_style="rounded",
    )
    state = await GetBodyBoundary(db_session).execute(
        project_id=proj.id, model_id=litho.id, body_id=body.id
    )
    assert [(n.along_m, n.elevation_m) for n in state.upper_nodes] == [(7.0, 3.0)]
    assert state.render_style == "rounded"


@pytest.mark.asyncio
async def test_save_rejects_body_without_primary_section(
    db_session: AsyncSession, scene: dict
) -> None:
    """A body with no primary section cannot anchor section-local nodes (→ 422)."""
    proj, litho, body = scene["project"], scene["litho"], scene["body"]
    body.primary_section_id = None
    await db_session.commit()
    with pytest.raises(BodyNoPrimarySectionError):
        await SaveBodyBoundary(db_session).execute(
            project_id=proj.id,
            model_id=litho.id,
            body_id=body.id,
            upper_nodes=[BoundaryNode(1.0, 1.0)],
            lower_nodes=[],
            render_style="straight",
        )


@pytest.mark.asyncio
async def test_bundle_serialises_shape_and_body_id(db_session: AsyncSession, scene: dict) -> None:
    """build_project_bundle carries the shape + nodes so the shaped body survives
    a .gmproj save/open round-trip. The shape is keyed by body_id (not content_key,
    which was dropped in slice 1)."""
    proj, litho, body = scene["project"], scene["litho"], scene["body"]
    await SaveBodyBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        body_id=body.id,
        upper_nodes=[BoundaryNode(10.0, 9.0)],
        lower_nodes=[BoundaryNode(15.0, 2.0)],
        render_style="blocky",
    )
    project_row = await db_session.get(type(proj), proj.id)
    bundle = await build_project_bundle(db_session, project_row)

    assert bundle["bodies"], "body row must be bundled"
    # body_id FK is present on the shape row (content_key was dropped in slice 1)
    shapes = bundle["body_boundary_shapes"]
    nodes = bundle["body_boundary_nodes"]
    assert len(shapes) == 1
    assert str(shapes[0]["body_id"]) == str(body.id)
    assert shapes[0]["render_style"] == "blocky"
    assert len(nodes) == 2
    assert {n["boundary"] for n in nodes} == {"upper", "lower"}


@pytest.mark.asyncio
async def test_out_of_scope_body_is_not_found(db_session: AsyncSession, scene: dict) -> None:
    """A body id under the wrong project raises BodyNotFoundError (→ 404)."""
    litho, body = scene["litho"], scene["body"]
    with pytest.raises(BodyNotFoundError):
        await GetBodyBoundary(db_session).execute(
            project_id=uuid7(), model_id=litho.id, body_id=body.id
        )


@pytest.mark.asyncio
async def test_nodes_cascade_delete_with_shape(db_session: AsyncSession, scene: dict) -> None:
    """Boundary nodes are removed when their shape row is deleted (CASCADE)."""
    proj, litho, body = scene["project"], scene["litho"], scene["body"]
    await SaveBodyBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        body_id=body.id,
        upper_nodes=[BoundaryNode(1.0, 1.0)],
        lower_nodes=[BoundaryNode(2.0, 2.0)],
        render_style="straight",
    )
    n_before = len((await db_session.execute(select(BodyBoundaryNodeOrm))).scalars().all())
    assert n_before == 2
    # Delete the model → CASCADE body_boundary_shape → CASCADE body_boundary_node.
    model = await db_session.get(GeologicalModelOrm, litho.id)
    await db_session.delete(model)
    await db_session.commit()
    n_after = len((await db_session.execute(select(BodyBoundaryNodeOrm))).scalars().all())
    assert n_after == 0
