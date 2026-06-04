"""Integration tests for ClearBodyExtent.

Coverage:
1. Clears one side (NULL); body row survives because other side has a kind.
2. Clears one side; body row survives because name is set.
3. Clears the only remaining extent → body row hard-deleted.
4. Cascade: body deletion drops body_boundary_shape + body_boundary_node.
5. Invalid side raises ValueError.
6. Body not in project raises (scope guard).
7. Body from a sibling model in the same project raises (S1 model scope guard).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.clear_body_extent import ClearBodyExtent
from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_OPEN,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
)
from tests.integration._litho_builders import (
    geo_model as _geo_model,
)
from tests.integration._litho_builders import (
    litho_model as _litho_model,
)

# ---------------------------------------------------------------------------
# Private fixture helpers (copied from test_claim_body_extent.py)
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="CBR",
        test_id=f"BH-CBR-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _geo_parent(project: ProjectOrm, *, name: str = "Quaternary-CBR") -> GeologicalFormationOrm:
    """Return an unsaved geological-level GeologicalFormationOrm (no parent)."""
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
    soil_code: str = "KLEI",
    ordinal: int | None = 0,
) -> GeologicalFormationOrm:
    """Return an unsaved litho-level GeologicalFormationOrm."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=0,
        parent_formation_id=parent.id,
        litho_main_soil_code=soil_code,
        instance_ordinal=ordinal,
    )


def _body(
    project: ProjectOrm,
    litho: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    source_bh: BoreholeOrm,
    *,
    left_kind: str | None = None,
    right_kind: str | None = None,
    left_neighbour_id: UUID | None = None,
    right_neighbour_id: UUID | None = None,
    name: str | None = None,
) -> BodyOrm:
    """Return an unsaved BodyOrm with configurable extent sides."""
    return BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=source_bh.id,
        name=name,
        extent_left_kind=left_kind,
        extent_left_neighbour_inv_id=left_neighbour_id,
        extent_right_kind=right_kind,
        extent_right_neighbour_inv_id=right_neighbour_id,
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for ClearBodyExtent tests."""
    proj = ProjectOrm(id=uuid7(), name="clear body extent test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: clears one side; body survives because other side has a kind
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clears_one_side_body_survives_other_side_set(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Clearing the left extent leaves the body row alive when the right
    side still carries a kind.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBR-t1")
    formation = _formation(project, parent, name="KLEI body t1")
    bh = _borehole(project.id, suffix="S01", x=160000.0)
    bh_n = _borehole(project.id, suffix="N01", x=160300.0)

    db_session.add_all([geo, litho, parent, formation, bh, bh_n])
    await db_session.flush()

    body = _body(
        project,
        litho,
        formation,
        bh,
        left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        left_neighbour_id=bh_n.id,
        right_kind=EXTENT_KIND_OPEN,
    )
    db_session.add(body)
    await db_session.commit()

    result = await ClearBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body.id,
        side="left",
    )

    # Body row must survive.
    assert result is not None
    assert result.id == body.id

    # Left side cleared.
    assert result.extent_left_kind is None
    assert result.extent_left_neighbour_inv_id is None
    assert result.extent_left_target_contact_id is None

    # Right side untouched.
    assert result.extent_right_kind == EXTENT_KIND_OPEN

    # Confirm DB round-trip.
    re_read = await db_session.get(BodyOrm, body.id)
    assert re_read is not None
    assert re_read.extent_left_kind is None
    assert re_read.extent_right_kind == EXTENT_KIND_OPEN


# ---------------------------------------------------------------------------
# Test 2: clears one side; body survives because name is set
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clears_only_extent_body_survives_because_name_set(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When both extents become NULL after the clear but the body has a
    non-empty name, the row must survive.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBR-t2")
    formation = _formation(project, parent, name="KLEI body t2")
    bh = _borehole(project.id, suffix="S02", x=161000.0)
    bh_n = _borehole(project.id, suffix="N02", x=161300.0)

    db_session.add_all([geo, litho, parent, formation, bh, bh_n])
    await db_session.flush()

    # Only the right side is set; left is already NULL; body has a name.
    body = _body(
        project,
        litho,
        formation,
        bh,
        right_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        right_neighbour_id=bh_n.id,
        name="Named body",
    )
    db_session.add(body)
    await db_session.commit()

    result = await ClearBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body.id,
        side="right",
    )

    # Body row must survive because name is set.
    assert result is not None
    assert result.id == body.id
    assert result.name == "Named body"

    # Right side cleared.
    assert result.extent_right_kind is None
    assert result.extent_right_neighbour_inv_id is None

    # Left was already NULL — still NULL.
    assert result.extent_left_kind is None

    # Confirm DB row still exists.
    re_read = await db_session.get(BodyOrm, body.id)
    assert re_read is not None


# ---------------------------------------------------------------------------
# Test 3: clears the only remaining extent → body row hard-deleted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clears_only_remaining_extent_body_deleted(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When clearing the last remaining extent leaves both sides NULL and
    the name is NULL, the body row must be hard-deleted.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBR-t3")
    formation = _formation(project, parent, name="KLEI body t3")
    bh = _borehole(project.id, suffix="S03", x=162000.0)

    db_session.add_all([geo, litho, parent, formation, bh])
    await db_session.flush()

    # Only right side set; no name.
    body = _body(
        project,
        litho,
        formation,
        bh,
        right_kind=EXTENT_KIND_OPEN,
    )
    db_session.add(body)
    await db_session.commit()

    body_id = body.id

    result = await ClearBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body_id,
        side="right",
    )

    # Use case returns None when it deletes the body.
    assert result is None

    # Body row must be gone from the DB.
    re_read = await db_session.get(BodyOrm, body_id)
    assert re_read is None, "Body row must be hard-deleted when both extents NULL and no name"


# ---------------------------------------------------------------------------
# Test 4: cascade — body deletion drops body_boundary_shape + node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cascade_deletes_boundary_shape_and_nodes(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When the body is deleted by ClearBodyExtent, the cascade must remove
    the linked body_boundary_shape and its body_boundary_node children.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBR-t4")
    formation = _formation(project, parent, name="KLEI body t4")
    bh = _borehole(project.id, suffix="S04", x=163000.0)

    db_session.add_all([geo, litho, parent, formation, bh])
    await db_session.flush()

    # Body with only the left side set (no name) — will be reaped when cleared.
    body = _body(
        project,
        litho,
        formation,
        bh,
        left_kind=EXTENT_KIND_OPEN,
    )
    db_session.add(body)
    await db_session.flush()

    # Seed a shape + two nodes linked to the body.
    shape = BodyBoundaryShapeOrm(
        id=uuid7(),
        body_id=body.id,
        model_id=litho.id,
        render_style="straight",
    )
    db_session.add(shape)
    await db_session.flush()

    node_upper = BodyBoundaryNodeOrm(
        id=uuid7(),
        shape_id=shape.id,
        boundary="upper",
        node_index=0,
        along_m=10.0,
        elevation_m=5.0,
    )
    node_lower = BodyBoundaryNodeOrm(
        id=uuid7(),
        shape_id=shape.id,
        boundary="lower",
        node_index=0,
        along_m=10.0,
        elevation_m=2.0,
    )
    db_session.add_all([node_upper, node_lower])
    await db_session.commit()

    body_id = body.id
    shape_id = shape.id
    node_upper_id = node_upper.id
    node_lower_id = node_lower.id

    # Clearing the only extent should delete the body + cascade.
    result = await ClearBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body_id,
        side="left",
    )

    assert result is None, "Body with no remaining extent or name must be deleted"

    # Expire the identity map so the subsequent gets hit the DB, not the
    # stale in-memory objects that were loaded earlier in this test.
    db_session.expire_all()

    # Body gone.
    assert await db_session.get(BodyOrm, body_id) is None

    # Shape gone via body_id CASCADE.
    assert await db_session.get(BodyBoundaryShapeOrm, shape_id) is None

    # Nodes gone via shape_id CASCADE.
    assert await db_session.get(BodyBoundaryNodeOrm, node_upper_id) is None
    assert await db_session.get(BodyBoundaryNodeOrm, node_lower_id) is None


# ---------------------------------------------------------------------------
# Test 5: invalid side raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_side_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Passing a side value that is not 'left' or 'right' must raise ValueError
    before any DB access.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBR-t5")
    formation = _formation(project, parent, name="KLEI body t5")
    bh = _borehole(project.id, suffix="S05", x=164000.0)

    db_session.add_all([geo, litho, parent, formation, bh])
    await db_session.flush()

    body = _body(project, litho, formation, bh, left_kind=EXTENT_KIND_OPEN)
    db_session.add(body)
    await db_session.commit()

    with pytest.raises(ValueError, match="side must be 'left' or 'right'"):
        await ClearBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body.id,
            side="centre",  # invalid
        )


# ---------------------------------------------------------------------------
# Test 6: body not in project raises (scope guard)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_body_not_in_project_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Passing a body_id that belongs to a DIFFERENT project must raise
    ValueError (scope guard — prevents cross-project data access).
    """
    # Create a second project and seed a body under it.
    other_project = ProjectOrm(id=uuid7(), name="other project", status="active")
    db_session.add(other_project)
    await db_session.flush()

    geo = _geo_model(other_project)
    litho = _litho_model(other_project, geo)
    parent = _geo_parent(other_project, name="Quat-CBR-t6-other")
    formation = _formation(other_project, parent, name="KLEI body t6-other")
    bh = _borehole(other_project.id, suffix="S06", x=165000.0)

    db_session.add_all([geo, litho, parent, formation, bh])
    await db_session.flush()

    other_body = _body(other_project, litho, formation, bh, left_kind=EXTENT_KIND_OPEN)
    db_session.add(other_body)
    await db_session.commit()

    # Try to clear using the first (original) project's scope — must fail.
    with pytest.raises(ValueError, match="not found in project"):
        await ClearBodyExtent(db_session).execute(
            project_id=project.id,  # wrong project
            model_id=litho.id,
            body_id=other_body.id,
            side="left",
        )


# ---------------------------------------------------------------------------
# Test 7: body from a sibling model in the same project raises (S1)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_clear_body_extent_wrong_model_id_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """S1 (audit fix): ClearBodyExtent must reject a body_id that belongs to a
    DIFFERENT model within the same project.

    The project-scope guard (app_project_id check) passes for sibling models;
    the model_id guard catches the mismatch and raises ValueError.
    """
    geo = _geo_model(project)
    # Two sibling litho models in the same project.
    litho_a = _litho_model(project, geo)
    litho_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-CBR-sibling",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    parent = _geo_parent(project, name="Quat-CBR-t7")
    formation = _formation(project, parent, name="KLEI body t7")
    bh = _borehole(project.id, suffix="S07", x=166000.0)

    db_session.add_all([geo, litho_a, litho_b, parent, formation, bh])
    await db_session.flush()

    # Body belongs to litho_a.
    body = _body(project, litho_a, formation, bh, left_kind=EXTENT_KIND_OPEN)
    db_session.add(body)
    await db_session.commit()

    # Attempt to clear using litho_b's model_id — must be rejected even though
    # project_id is correct.
    with pytest.raises(ValueError, match="cross-model clear is not allowed"):
        await ClearBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho_b.id,  # wrong model
            body_id=body.id,
            side="left",
        )
