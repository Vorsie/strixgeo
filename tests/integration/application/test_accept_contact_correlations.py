"""Integration tests for AcceptContactCorrelations — #133 Phase 2+3.

Six cases:
1. Section-scoped accept flips only edges whose both endpoints are in the
   section's seeded_formation_contact_ids; edges on another section are
   unchanged.
2. Model-scoped accept (section_id=None) flips every unapproved edge in
   the model.
3. Accept does NOT auto-fire body/lens detection (owner directive 2026-05-31):
   bodies_created and bodies_removed are always 0 on the AcceptResult.
4. Accept is idempotent when nothing is unapproved: edges_accepted=0,
   downstream resolver still runs (no-op).
5. Edge-scoped accept flips only the named edge.
6. Edge-scoped accept rejects an edge that belongs to a different model.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.accept_contact_correlations import AcceptContactCorrelations
from groundmodel.infrastructure.db.models.body_orm import BodyOrm as LithoLensOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._litho_builders import (
    contact as _contact,
)
from tests.integration._litho_builders import (
    geo_model as _geo_model,
)
from tests.integration._litho_builders import (
    litho_model as _litho_model,
)

# ---------------------------------------------------------------------------
# Private fixture helpers (mirror test_detect_litho_lenses.py conventions)
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="ACCEPT",
        test_id=f"BH-ACCEPT-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _geo_parent(project: ProjectOrm, *, name: str = "Quaternary") -> GeologicalFormationOrm:
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
    soil_code: str = "ZAND",
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
    )


def _raw_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
    *,
    user_approved: bool = False,
    source: str = "auto",
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved LithoContactCorrelationEdgeOrm (canonical min/max ordering)."""
    a_id = min(ca.id, cb.id)
    b_id = max(ca.id, cb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source=source,
        user_approved=user_approved,
    )


def _section(
    project: ProjectOrm,
    *,
    seeded_contact_ids: list[UUID] | None = None,
    name: str = "Section",
) -> CrossSectionOrm:
    """Return an unsaved CrossSectionOrm with the given seeded contacts."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        start_x=100000.0,
        start_y=200000.0,
        end_x=110000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=seeded_contact_ids or [],
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for AcceptContactCorrelations tests."""
    proj = ProjectOrm(id=uuid7(), name="accept correlations test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: Section-scoped accept flips only in-scope edges
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_section_scoped_accept_flips_only_in_scope_edges(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Insert 4 unapproved edges: 2 on section A, 2 on section B.
    Accept section A → only the 2 on A flip to approved=True.
    The 2 on B remain False.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t1")
    f1 = _formation(project, parent, name="ZAND-t1a", soil_code="ZAND")
    f2 = _formation(project, parent, name="ZAND-t1b", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="T1A", x=150000.0)
    bh_b = _borehole(project.id, suffix="T1B", x=150500.0)
    bh_c = _borehole(project.id, suffix="T1C", x=151000.0)
    bh_d = _borehole(project.id, suffix="T1D", x=151500.0)

    db_session.add_all([geo, litho, parent, f1, f2, bh_a, bh_b, bh_c, bh_d])
    await db_session.flush()

    # Contacts: two pairs for section A, two pairs for section B.
    ca1 = _contact(litho, f1, bh_a, depth=3.0)
    ca2 = _contact(litho, f1, bh_b, depth=3.0)
    cb1 = _contact(litho, f2, bh_c, depth=3.0)
    cb2 = _contact(litho, f2, bh_d, depth=3.0)

    db_session.add_all([ca1, ca2, cb1, cb2])
    await db_session.flush()

    # Section A contains ca1 + ca2; section B contains cb1 + cb2.
    sec_a = _section(project, seeded_contact_ids=[ca1.id, ca2.id], name="Section A")
    sec_b = _section(project, seeded_contact_ids=[cb1.id, cb2.id], name="Section B")
    db_session.add_all([sec_a, sec_b])
    await db_session.flush()

    # Four unapproved edges: 2 on A, 2 on B (cross-pair so they're canonical).
    edge_a1 = _raw_edge(litho, ca1, ca2, user_approved=False)
    # Add a second edge touching only section-A contacts to give us 2 on A.
    # We re-use ca1 as the pivot and create a "self-cross" via different formations.
    ca3 = _contact(litho, f2, bh_a, depth=5.0)
    db_session.add(ca3)
    await db_session.flush()
    # Extend section A's seeded ids to include ca3.
    sec_a.seeded_formation_contact_ids = [ca1.id, ca2.id, ca3.id]
    await db_session.flush()
    edge_a2 = _raw_edge(litho, ca2, ca3, user_approved=False)
    edge_b1 = _raw_edge(litho, cb1, cb2, user_approved=False)
    # Second edge on section B — need another contact on bh_c or bh_d.
    cb3 = _contact(litho, f1, bh_c, depth=6.0)
    db_session.add(cb3)
    await db_session.flush()
    sec_b.seeded_formation_contact_ids = [cb1.id, cb2.id, cb3.id]
    await db_session.flush()
    edge_b2 = _raw_edge(litho, cb2, cb3, user_approved=False)

    db_session.add_all([edge_a1, edge_a2, edge_b1, edge_b2])
    await db_session.commit()

    # Accept section A only.
    result = await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=sec_a.id,
    )

    assert result.edges_accepted == 2, (
        f"Expected 2 edges accepted (section A only); got {result.edges_accepted}"
    )

    # Section-A edges must now be approved.
    for edge_id in [edge_a1.id, edge_a2.id]:
        row = await db_session.get(LithoContactCorrelationEdgeOrm, edge_id)
        assert row is not None
        assert row.user_approved is True, (
            f"Edge {edge_id} on section A must be approved after accept"
        )

    # Section-B edges must remain unapproved.
    for edge_id in [edge_b1.id, edge_b2.id]:
        row = await db_session.get(LithoContactCorrelationEdgeOrm, edge_id)
        assert row is not None
        assert row.user_approved is False, f"Edge {edge_id} on section B must stay unapproved"


# ---------------------------------------------------------------------------
# Test 2: Model-scoped accept flips everything
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_model_scoped_accept_flips_everything(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Accept with section_id=None flips all unapproved edges in the model."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t2")
    f1 = _formation(project, parent, name="ZAND-t2a", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="T2A", x=160000.0)
    bh_b = _borehole(project.id, suffix="T2B", x=160500.0)
    bh_c = _borehole(project.id, suffix="T2C", x=161000.0)
    bh_d = _borehole(project.id, suffix="T2D", x=161500.0)

    db_session.add_all([geo, litho, parent, f1, bh_a, bh_b, bh_c, bh_d])
    await db_session.flush()

    c1 = _contact(litho, f1, bh_a, depth=3.0)
    c2 = _contact(litho, f1, bh_b, depth=3.0)
    c3 = _contact(litho, f1, bh_c, depth=3.0)
    c4 = _contact(litho, f1, bh_d, depth=3.0)

    db_session.add_all([c1, c2, c3, c4])
    await db_session.flush()

    edge1 = _raw_edge(litho, c1, c2, user_approved=False)
    edge2 = _raw_edge(litho, c2, c3, user_approved=False)
    edge3 = _raw_edge(litho, c3, c4, user_approved=False)
    edge4 = _raw_edge(litho, c1, c4, user_approved=False)

    db_session.add_all([edge1, edge2, edge3, edge4])
    await db_session.commit()

    result = await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=None,
    )

    assert result.edges_accepted == 4, (
        f"Expected 4 edges accepted (model-scoped); got {result.edges_accepted}"
    )

    # All four edges must now be approved.
    for edge_id in [edge1.id, edge2.id, edge3.id, edge4.id]:
        row = await db_session.get(LithoContactCorrelationEdgeOrm, edge_id)
        assert row is not None
        assert row.user_approved is True, (
            f"Edge {edge_id} must be approved after model-scoped accept"
        )


# ---------------------------------------------------------------------------
# Test 3: Accept no longer auto-fires lens detection (explicit verb needed)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_accept_does_not_auto_fire_lens_detection(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Owner directive 2026-05-31 — AcceptContactCorrelations no longer
    auto-fires DetectLithoLenses.  Two unapproved edges that form the
    #135 topology yield zero lens rows after accept; the user must
    explicitly invoke DetectLithoLenses to materialise the row.

    Topology (bilateral pinch-out — owner directive 2026-05-31):
      bh_a: c_top (f_cap, depth=2), c_body (f_lens, depth=4), c_base (f_base, depth=6)
      bh_b: c_single_b (f_b, depth=3)
      bh_c: c_single_c (f_b, depth=3)
      Edges 1-2: c_body / c_base ↔ c_single_b (lens pinches to bh_b)
      Edges 3-4: c_body / c_base ↔ c_single_c (lens pinches to bh_c)
    The lens body carries formation_id=f_lens (the formation whose top is c_body).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t3")
    f_cap = _formation(project, parent, name="ZAND cap t3", soil_code="ZAND")
    f_lens = _formation(project, parent, name="KLEI lens t3", soil_code="KLEI")
    f_base = _formation(project, parent, name="ZAND base t3", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b t3", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="T3A", x=170000.0)
    bh_b = _borehole(project.id, suffix="T3B", x=170300.0)
    bh_c = _borehole(project.id, suffix="T3C", x=169700.0)

    db_session.add_all([geo, litho, parent, f_cap, f_lens, f_base, f_b, bh_a, bh_b, bh_c])
    await db_session.flush()

    c_top = _contact(litho, f_cap, bh_a, depth=2.0)
    c_body = _contact(litho, f_lens, bh_a, depth=4.0)
    c_base = _contact(litho, f_base, bh_a, depth=6.0)
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)
    c_single_c = _contact(litho, f_b, bh_c, depth=3.0)

    db_session.add_all([c_top, c_body, c_base, c_single_b, c_single_c])
    await db_session.flush()

    # Four unapproved edges forming the BILATERAL lens topology —
    # bypass use case to keep them unapproved.
    edge1 = _raw_edge(litho, c_body, c_single_b, user_approved=False, source="auto")
    edge2 = _raw_edge(litho, c_base, c_single_b, user_approved=False, source="auto")
    edge3 = _raw_edge(litho, c_body, c_single_c, user_approved=False, source="auto")
    edge4 = _raw_edge(litho, c_base, c_single_c, user_approved=False, source="auto")
    db_session.add_all([edge1, edge2, edge3, edge4])
    await db_session.commit()

    # Before accept: no LithoLensOrm rows.
    pre_lens_count = len(
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert pre_lens_count == 0, f"Expected 0 lens rows before accept; got {pre_lens_count}"

    result = await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=None,
    )

    assert result.edges_accepted == 4, f"Expected 4 edges accepted; got {result.edges_accepted}"
    # AcceptResult.bodies_created / .bodies_removed are kept on the
    # response shape for client compatibility but are ALWAYS 0 since
    # 2026-05-31 (renamed from lenses_created/lenses_removed in Slice 3.3).
    assert result.bodies_created == 0, (
        f"Accept must not auto-fire body detection; got {result.bodies_created}"
    )
    assert result.bodies_removed == 0, (
        f"Accept must not auto-fire body detection; got {result.bodies_removed}"
    )


# ---------------------------------------------------------------------------
# Test 4: Accept is idempotent when nothing is unapproved
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_accept_is_idempotent_when_nothing_unapproved(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Re-run accept when all edges are already approved → edges_accepted=0.
    The resolver + lens detector still run (no-op) without error.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t4")
    f1 = _formation(project, parent, name="ZAND-t4a", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="T4A", x=180000.0)
    bh_b = _borehole(project.id, suffix="T4B", x=180500.0)

    db_session.add_all([geo, litho, parent, f1, bh_a, bh_b])
    await db_session.flush()

    c1 = _contact(litho, f1, bh_a, depth=3.0)
    c2 = _contact(litho, f1, bh_b, depth=3.0)
    db_session.add_all([c1, c2])
    await db_session.flush()

    # Edge already approved.
    edge = _raw_edge(litho, c1, c2, user_approved=True, source="manual")
    db_session.add(edge)
    await db_session.commit()

    result = await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=None,
    )

    assert result.edges_accepted == 0, (
        f"Expected edges_accepted=0 (nothing to flip); got {result.edges_accepted}"
    )
    # Downstream calls must have run without raising.
    assert result.bodies_created == 0
    assert result.bodies_removed == 0
    # The edge remains approved.
    row = await db_session.get(LithoContactCorrelationEdgeOrm, edge.id)
    assert row is not None
    assert row.user_approved is True


# ---------------------------------------------------------------------------
# Test 5: Edge-scoped accept flips only the named edge (dogfeed 2026-05-31)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_edge_scoped_accept_flips_only_named_edge(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """``edge_id`` filter approves the single edge and leaves siblings unapproved.

    Right-click "Accept correlation" menu item powers this — the menu fires
    per-edge so the use case must accept exactly that one without dragging
    the rest of the section's pending edges along.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t5")
    f1 = _formation(project, parent, name="ZAND-t5", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="T5A", x=170000.0)
    bh_b = _borehole(project.id, suffix="T5B", x=170500.0)
    bh_c = _borehole(project.id, suffix="T5C", x=171000.0)

    db_session.add_all([geo, litho, parent, f1, bh_a, bh_b, bh_c])
    await db_session.flush()

    c1 = _contact(litho, f1, bh_a, depth=3.0)
    c2 = _contact(litho, f1, bh_b, depth=3.0)
    c3 = _contact(litho, f1, bh_c, depth=3.0)
    db_session.add_all([c1, c2, c3])
    await db_session.flush()

    target_edge = _raw_edge(litho, c1, c2, user_approved=False)
    sibling_edge = _raw_edge(litho, c2, c3, user_approved=False)
    db_session.add_all([target_edge, sibling_edge])
    await db_session.commit()

    result = await AcceptContactCorrelations(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        edge_id=target_edge.id,
    )

    assert result.edges_accepted == 1, (
        f"Expected exactly one edge accepted; got {result.edges_accepted}"
    )

    target_row = await db_session.get(LithoContactCorrelationEdgeOrm, target_edge.id)
    assert target_row is not None
    assert target_row.user_approved is True

    sibling_row = await db_session.get(LithoContactCorrelationEdgeOrm, sibling_edge.id)
    assert sibling_row is not None
    assert sibling_row.user_approved is False, (
        "Sibling edge must remain unapproved when edge_id targets only one edge"
    )


# ---------------------------------------------------------------------------
# Test 6: Edge-scoped accept rejects an edge that belongs to a different model
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_edge_scoped_accept_rejects_cross_model_edge(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """An ``edge_id`` whose model differs from ``model_id`` must raise ValueError.

    Guards against a routing or client bug aiming a single-edge accept at
    the wrong model and accidentally bypassing the model scope check.
    """
    geo = _geo_model(project)
    litho_a = _litho_model(project, geo)
    litho_b = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t6")
    f1 = _formation(project, parent, name="ZAND-t6", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="T6A", x=180000.0)
    bh_b = _borehole(project.id, suffix="T6B", x=180500.0)

    db_session.add_all([geo, litho_a, litho_b, parent, f1, bh_a, bh_b])
    await db_session.flush()

    # Both contacts belong to litho_b; the edge therefore belongs to litho_b.
    c1 = _contact(litho_b, f1, bh_a, depth=3.0)
    c2 = _contact(litho_b, f1, bh_b, depth=3.0)
    db_session.add_all([c1, c2])
    await db_session.flush()
    edge = _raw_edge(litho_b, c1, c2, user_approved=False)
    db_session.add(edge)
    await db_session.commit()

    # Aim the accept at litho_a — the wrong model.
    with pytest.raises(ValueError, match="does not belong to model"):
        await AcceptContactCorrelations(db_session).execute(
            project_id=project.id,
            model_id=litho_a.id,
            edge_id=edge.id,
        )

    # Edge must still be unapproved.
    row = await db_session.get(LithoContactCorrelationEdgeOrm, edge.id)
    assert row is not None
    assert row.user_approved is False
