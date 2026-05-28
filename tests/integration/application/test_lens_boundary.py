"""Integration tests for the lens-boundary shape use cases (#163f Slice 2).

Verifies the GET/PUT round-trip, atomic full-replace, the scope/precondition
guards, and the carry-forward invariant: a shape keyed by ``content_key``
re-attaches to a freshly-recreated lens row (simulating a resolver-driven
``body_ordinal`` shift) without being lost.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.lens_boundary import (
    BoundaryNode,
    GetLensBoundary,
    LensNoPrimarySectionError,
    LensNotDetectedError,
    LensNotFoundError,
    SaveLensBoundary,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_boundary_node_orm import (
    LithoLensBoundaryNodeOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import build_project_bundle

KEY = "k-aaa|k-bbb|k-ccc"


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession):
    """A project + litho model + section + formation + a detected lens row.

    The lens carries a stable ``content_key`` and a ``primary_section_id`` so
    the save path's preconditions are satisfied.
    """
    proj = ProjectOrm(id=uuid7(), name="lens boundary test", status="active")
    db_session.add(proj)
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
    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=proj.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        primary_section_id=section.id,
        content_key=KEY,
    )
    db_session.add(lens)
    await db_session.commit()
    return {
        "project": proj,
        "litho": litho,
        "section": section,
        "formation": formation,
        "lens": lens,
    }


@pytest.mark.asyncio
async def test_save_then_get_roundtrip_sorts_and_reindexes(
    db_session: AsyncSession, scene: dict
) -> None:
    """PUT stores nodes; GET returns them sorted by along_m + the render style."""
    proj, litho, lens = scene["project"], scene["litho"], scene["lens"]
    await SaveLensBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        lens_id=lens.id,
        # deliberately out of order — server must sort by along_m
        upper_nodes=[BoundaryNode(20.0, 8.0), BoundaryNode(10.0, 9.0)],
        lower_nodes=[BoundaryNode(15.0, 2.0)],
        render_style="blocky",
    )
    state = await GetLensBoundary(db_session).execute(
        project_id=proj.id, model_id=litho.id, lens_id=lens.id
    )
    assert state.render_style == "blocky"
    assert [(n.along_m, n.elevation_m) for n in state.upper_nodes] == [(10.0, 9.0), (20.0, 8.0)]
    assert [(n.along_m, n.elevation_m) for n in state.lower_nodes] == [(15.0, 2.0)]


@pytest.mark.asyncio
async def test_save_is_full_replace(db_session: AsyncSession, scene: dict) -> None:
    """A second PUT replaces the prior node set rather than appending."""
    proj, litho, lens = scene["project"], scene["litho"], scene["lens"]
    await SaveLensBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        lens_id=lens.id,
        upper_nodes=[BoundaryNode(5.0, 1.0), BoundaryNode(6.0, 2.0)],
        lower_nodes=[],
        render_style="straight",
    )
    await SaveLensBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        lens_id=lens.id,
        upper_nodes=[BoundaryNode(7.0, 3.0)],
        lower_nodes=[],
        render_style="rounded",
    )
    state = await GetLensBoundary(db_session).execute(
        project_id=proj.id, model_id=litho.id, lens_id=lens.id
    )
    assert [(n.along_m, n.elevation_m) for n in state.upper_nodes] == [(7.0, 3.0)]
    assert state.render_style == "rounded"


@pytest.mark.asyncio
async def test_shape_carries_forward_across_lens_recreation(
    db_session: AsyncSession, scene: dict
) -> None:
    """The shape is keyed by content_key, so a NEW lens row with the same key
    (simulating a resolver-driven body_ordinal shift that deletes + recreates
    the lens) reads the SAME shape — the carry-forward invariant (#163f)."""
    proj, litho, lens, section, formation = (
        scene["project"],
        scene["litho"],
        scene["lens"],
        scene["section"],
        scene["formation"],
    )
    await SaveLensBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        lens_id=lens.id,
        upper_nodes=[BoundaryNode(12.0, 5.0)],
        lower_nodes=[],
        render_style="blocky",
    )
    # Simulate re-detection: delete the lens row, create a new one with a
    # different ordinal but the SAME content_key.
    await db_session.delete(lens)
    await db_session.flush()
    new_lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=proj.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=3,  # shifted
        primary_section_id=section.id,
        content_key=KEY,  # same stable key
    )
    db_session.add(new_lens)
    await db_session.commit()

    state = await GetLensBoundary(db_session).execute(
        project_id=proj.id, model_id=litho.id, lens_id=new_lens.id
    )
    assert state.render_style == "blocky"
    assert [(n.along_m, n.elevation_m) for n in state.upper_nodes] == [(12.0, 5.0)]


@pytest.mark.asyncio
async def test_save_rejects_lens_without_content_key(db_session: AsyncSession, scene: dict) -> None:
    """A lens with no content_key cannot be shaped (→ LensNotDetectedError/422)."""
    proj, litho, lens = scene["project"], scene["litho"], scene["lens"]
    lens.content_key = None
    await db_session.commit()
    with pytest.raises(LensNotDetectedError):
        await SaveLensBoundary(db_session).execute(
            project_id=proj.id,
            model_id=litho.id,
            lens_id=lens.id,
            upper_nodes=[BoundaryNode(1.0, 1.0)],
            lower_nodes=[],
            render_style="straight",
        )


@pytest.mark.asyncio
async def test_save_rejects_lens_without_primary_section(
    db_session: AsyncSession, scene: dict
) -> None:
    """A lens with no primary section cannot anchor section-local nodes (→ 422)."""
    proj, litho, lens = scene["project"], scene["litho"], scene["lens"]
    lens.primary_section_id = None
    await db_session.commit()
    with pytest.raises(LensNoPrimarySectionError):
        await SaveLensBoundary(db_session).execute(
            project_id=proj.id,
            model_id=litho.id,
            lens_id=lens.id,
            upper_nodes=[BoundaryNode(1.0, 1.0)],
            lower_nodes=[],
            render_style="straight",
        )


@pytest.mark.asyncio
async def test_bundle_serialises_shape_and_content_key(
    db_session: AsyncSession, scene: dict
) -> None:
    """build_project_bundle carries the lens content_key + the shape + nodes so
    the shaped lens survives a .gmproj save/open round-trip (#163f)."""
    proj, litho, lens = scene["project"], scene["litho"], scene["lens"]
    await SaveLensBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        lens_id=lens.id,
        upper_nodes=[BoundaryNode(10.0, 9.0)],
        lower_nodes=[BoundaryNode(15.0, 2.0)],
        render_style="blocky",
    )
    project_row = await db_session.get(type(proj), proj.id)
    bundle = await build_project_bundle(db_session, project_row)

    assert bundle["litho_lenses"], "lens row must be bundled"
    assert bundle["litho_lenses"][0]["content_key"] == KEY
    shapes = bundle["litho_lens_shapes"]
    nodes = bundle["litho_lens_boundary_nodes"]
    assert len(shapes) == 1
    assert shapes[0]["content_key"] == KEY
    assert shapes[0]["render_style"] == "blocky"
    assert len(nodes) == 2
    assert {n["boundary"] for n in nodes} == {"upper", "lower"}


@pytest.mark.asyncio
async def test_out_of_scope_lens_is_not_found(db_session: AsyncSession, scene: dict) -> None:
    """A lens id under the wrong project raises LensNotFoundError (→ 404)."""
    litho, lens = scene["litho"], scene["lens"]
    with pytest.raises(LensNotFoundError):
        await GetLensBoundary(db_session).execute(
            project_id=uuid7(), model_id=litho.id, lens_id=lens.id
        )


@pytest.mark.asyncio
async def test_nodes_cascade_delete_with_shape(db_session: AsyncSession, scene: dict) -> None:
    """Boundary nodes are removed when their shape row is deleted (CASCADE)."""
    proj, litho, lens = scene["project"], scene["litho"], scene["lens"]
    await SaveLensBoundary(db_session).execute(
        project_id=proj.id,
        model_id=litho.id,
        lens_id=lens.id,
        upper_nodes=[BoundaryNode(1.0, 1.0)],
        lower_nodes=[BoundaryNode(2.0, 2.0)],
        render_style="straight",
    )
    n_before = len((await db_session.execute(select(LithoLensBoundaryNodeOrm))).scalars().all())
    assert n_before == 2
    # Delete the model → CASCADE litho_lens_shape → CASCADE boundary nodes.
    model = await db_session.get(GeologicalModelOrm, litho.id)
    await db_session.delete(model)
    await db_session.commit()
    n_after = len((await db_session.execute(select(LithoLensBoundaryNodeOrm))).scalars().all())
    assert n_after == 0
