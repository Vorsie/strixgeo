"""Integration tests for ResolveLithoInstances consuming contact edges (#133 Phase 3).

Verifies that the resolver derives the formation connectivity graph from
user_approved=True ``LithoContactCorrelationEdgeOrm`` rows rather than
formation-level ``LithoCorrelationEdgeOrm`` rows.

Three cases are covered:
1. Two formations linked via a single user-approved contact edge → same
   connected component → both receive ``instance_ordinal=1``.
2. An unapproved contact edge (user_approved=False) between two formations
   does NOT form a connected component → each formation keeps a distinct
   ordinal.
3. A formation with ``instance_ordinal_locked=True`` keeps its ordinal
   even when topology would re-assign it; other formations flow around it.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

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


def _geo_model(project: ProjectOrm) -> GeologicalModelOrm:
    """Return an unsaved geological ``GeologicalModelOrm``."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-RLIC",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic ``GeologicalModelOrm``."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-RLIC",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
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
        The resolver query filters ``parent_formation_id IS NOT NULL``,
        so litho formations MUST carry a parent or the resolver skips them.
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


def _contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
) -> FormationContactOrm:
    """Return an unsaved ``FormationContactOrm`` for a given (model, formation, borehole)."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source="borehole_observation",
        confidence="medium",
    )


def _contact_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
    *,
    user_approved: bool = True,
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved contact-correlation edge between two contacts.

    Canonically orders ``contact_a_id < contact_b_id`` to satisfy the DB
    CHECK constraint.
    """
    a_id = min(ca.id, cb.id)
    b_id = max(ca.id, cb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=user_approved,
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for resolver tests."""
    proj = ProjectOrm(id=uuid7(), name="resolver contact test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: approved contact edge → single connected component
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approved_contact_edge_forms_one_component(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Two formations linked via a user_approved contact edge get the same ordinal.

    The resolver must detect the connected component and assign
    ``instance_ordinal=1`` to both formations (they are the only ZAND
    body in the model, so ordinal 1 is the correct assignment).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    # A geological-level parent formation is required: the resolver query
    # filters parent_formation_id IS NOT NULL to restrict to litho units.
    geo_parent = _geo_formation(project, name="Quaternary A")
    f_a = _formation(project, geo_parent, name="ZAND occ A", soil_code="ZAND")
    f_b = _formation(project, geo_parent, name="ZAND occ B", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="001", x=150000.0)
    bh_b = _borehole(project.id, suffix="002", x=150300.0)

    db_session.add_all([geo, litho, geo_parent, f_a, f_b, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, f_a, bh_a, depth=3.0)
    cb = _contact(litho, f_b, bh_b, depth=4.0)
    db_session.add_all([ca, cb])
    await db_session.flush()

    edge = _contact_edge(litho, ca, cb, user_approved=True)
    db_session.add(edge)
    await db_session.commit()

    result = await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    # Both formations must receive the same ordinal (they are one body).
    updated_ids = {u.formation_id for u in result.updated}
    assert f_a.id in updated_ids or f_b.id in updated_ids, (
        "At least one formation should have had its ordinal updated "
        "(both start at None, so both must be written)"
    )

    # Refresh both ORM rows to read the committed ordinal values.
    await db_session.refresh(f_a)
    await db_session.refresh(f_b)
    assert f_a.instance_ordinal == f_b.instance_ordinal, (
        f"Formations linked by an approved contact edge must share the same ordinal; "
        f"got {f_a.instance_ordinal} vs {f_b.instance_ordinal}"
    )
    assert f_a.instance_ordinal == 1, (
        f"The only body in the model must be ordinal 1; got {f_a.instance_ordinal}"
    )


# ---------------------------------------------------------------------------
# Test 2: unapproved contact edge → two separate components
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unapproved_contact_edge_does_not_merge_components(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """An unapproved (auto-proposed) contact edge must NOT form a connected component.

    The two formations must receive distinct ordinals (1 and 2 in depth order)
    because the resolver only consumes user_approved=True edges.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary B")
    # f_a is shallower (depth=2.0) → ordinal 1; f_b is deeper (depth=5.0) → ordinal 2.
    f_a = _formation(project, geo_parent, name="ZAND occ A", soil_code="ZAND")
    f_b = _formation(project, geo_parent, name="ZAND occ B", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="011", x=150000.0)
    bh_b = _borehole(project.id, suffix="012", x=150300.0)

    db_session.add_all([geo, litho, geo_parent, f_a, f_b, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, f_a, bh_a, depth=2.0)
    cb = _contact(litho, f_b, bh_b, depth=5.0)
    db_session.add_all([ca, cb])
    await db_session.flush()

    # user_approved=False — this edge must be invisible to the resolver.
    unapproved_edge = _contact_edge(litho, ca, cb, user_approved=False)
    db_session.add(unapproved_edge)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    await db_session.refresh(f_a)
    await db_session.refresh(f_b)

    assert f_a.instance_ordinal != f_b.instance_ordinal, (
        "Formations connected only by an unapproved edge must receive distinct ordinals; "
        f"got both = {f_a.instance_ordinal}"
    )
    # Depth-ordered: shallower f_a gets ordinal 1, deeper f_b gets ordinal 2.
    assert f_a.instance_ordinal == 1, (
        f"Shallower formation should be ordinal 1; got {f_a.instance_ordinal}"
    )
    assert f_b.instance_ordinal == 2, (
        f"Deeper formation should be ordinal 2; got {f_b.instance_ordinal}"
    )


# ---------------------------------------------------------------------------
# Test 3: instance_ordinal_locked=True is respected across a re-resolve
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_locked_ordinal_is_preserved(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A locked formation's ordinal must survive a re-resolve even when topology changes.

    Setup:
    * f_a has instance_ordinal=5, instance_ordinal_locked=True.
    * f_b is unlocked and has no prior ordinal.
    * An approved contact edge connects them → they form one component.

    After resolve: f_a must still have ordinal=5 (locked); f_b must adopt
    the same component ordinal (5, since the locked formation's ordinal wins).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary C")
    f_a = _formation(project, geo_parent, name="ZAND locked", soil_code="ZAND")
    f_b = _formation(project, geo_parent, name="ZAND unlocked", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="021", x=150000.0)
    bh_b = _borehole(project.id, suffix="022", x=150300.0)

    # Pre-set the locked ordinal directly on the ORM before flush.
    f_a.instance_ordinal = 5
    f_a.instance_ordinal_locked = True

    db_session.add_all([geo, litho, geo_parent, f_a, f_b, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, f_a, bh_a, depth=3.0)
    cb = _contact(litho, f_b, bh_b, depth=4.0)
    db_session.add_all([ca, cb])
    await db_session.flush()

    edge = _contact_edge(litho, ca, cb, user_approved=True)
    db_session.add(edge)
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    await db_session.refresh(f_a)
    await db_session.refresh(f_b)

    # The locked formation must not have been changed.
    assert f_a.instance_ordinal == 5, (
        f"Locked formation must retain ordinal 5; got {f_a.instance_ordinal}"
    )
    # The unlocked formation in the same component takes the component ordinal.
    assert f_b.instance_ordinal == 5, (
        f"Unlocked formation in the same component as the locked one must adopt "
        f"ordinal 5; got {f_b.instance_ordinal}"
    )
