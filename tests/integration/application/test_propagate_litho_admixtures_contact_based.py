"""Integration tests for PropagateLithoAdmixtures consuming contact edges (#133 Phase 3).

Verifies that admixture propagation derives its BFS graph from
user_approved=True ``LithoContactCorrelationEdgeOrm`` rows rather than
formation-level ``LithoCorrelationEdgeOrm`` rows.

Three cases are covered:

1. Approved contact edge propagates admixtures to both formations.
2. An unapproved contact edge (user_approved=False) does NOT propagate.
3. A chain of two approved edges (F1↔F2↔F3) propagates to all three.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.propagate_litho_admixtures import PropagateLithoAdmixtures
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
# Private fixture helpers (not reusable outside this module)
# ---------------------------------------------------------------------------

_ADMIXTURES_A = [{"soil_code": "KLEI", "amount": "weinig", "locally": False}]
_ADMIXTURES_B = [
    {"soil_code": "SILT", "amount": "veel", "locally": False},
    {"soil_code": "GRIND", "amount": "weinig", "locally": True},
]


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved ``BoreholeOrm`` with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="PLAB",
        test_id=f"BH-PLAB-{suffix}",
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
        Geological parent (``parent_formation_id`` must be non-null for a
        litho unit).
    name : str
        Human-readable name.
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


def _contact_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
    *,
    user_approved: bool = True,
    section_id: UUID,
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved contact-correlation edge, canonically ordered by id.

    The DB CHECK constraint requires ``contact_a_id < contact_b_id``.

    Parameters
    ----------
    section_id : UUID
        The section this edge was authored on (NOT NULL post Task 4).
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
        section_id=section_id,
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for admixture-propagation tests."""
    proj = ProjectOrm(id=uuid7(), name="admixture propagation contact test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: approved contact edge → admixtures propagate to both formations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approved_contact_edge_propagates_admixtures(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Admixtures on the seed propagate to the peer formation via an approved edge.

    Setup: two formations linked by a single user_approved=True contact edge.
    After calling PropagateLithoAdmixtures on f_a, both f_a and f_b must carry
    the supplied admixture list.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary T1")
    f_a = _formation(project, geo_parent, name="ZAND occ A", soil_code="ZAND")
    f_b = _formation(project, geo_parent, name="ZAND occ B", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="101", x=150000.0)
    bh_b = _borehole(project.id, suffix="102", x=150300.0)

    db_session.add_all([geo, litho, geo_parent, f_a, f_b, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, f_a, bh_a, depth=3.0)
    cb = _contact(litho, f_b, bh_b, depth=4.0)
    db_session.add_all([ca, cb])
    await db_session.flush()

    sec = _minimal_section(project, name="Sec-PLAB-T1")
    db_session.add(sec)
    await db_session.flush()

    edge = _contact_edge(litho, ca, cb, user_approved=True, section_id=sec.id)
    db_session.add(edge)
    await db_session.commit()

    result = await PropagateLithoAdmixtures(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        seed_formation_id=f_a.id,
        admixtures=_ADMIXTURES_A,
    )

    assert result.component_size == 2, (
        f"Connected component must contain both formations; got size={result.component_size}"
    )

    # Refresh to read committed DB state.
    await db_session.refresh(f_a)
    await db_session.refresh(f_b)

    assert f_a.litho_admixtures == _ADMIXTURES_A, (
        f"Seed formation must carry the new admixtures; got {f_a.litho_admixtures}"
    )
    assert f_b.litho_admixtures == _ADMIXTURES_A, (
        f"Peer formation must also carry the propagated admixtures; got {f_b.litho_admixtures}"
    )


# ---------------------------------------------------------------------------
# Test 2: unapproved contact edge → admixtures do NOT propagate to peer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unapproved_contact_edge_does_not_propagate_admixtures(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """An unapproved contact edge must not form part of the propagation graph.

    The seed formation gets its admixtures; the isolated peer formation must
    be unchanged (empty litho_admixtures list).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary T2")
    f_a = _formation(project, geo_parent, name="KLEI occ A", soil_code="KLEI")
    f_b = _formation(project, geo_parent, name="KLEI occ B", soil_code="KLEI")
    bh_a = _borehole(project.id, suffix="111", x=150000.0)
    bh_b = _borehole(project.id, suffix="112", x=150300.0)

    db_session.add_all([geo, litho, geo_parent, f_a, f_b, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, f_a, bh_a, depth=5.0)
    cb = _contact(litho, f_b, bh_b, depth=6.0)
    db_session.add_all([ca, cb])
    await db_session.flush()

    sec = _minimal_section(project, name="Sec-PLAB-T2")
    db_session.add(sec)
    await db_session.flush()

    # user_approved=False — must be invisible to the propagation graph.
    unapproved_edge = _contact_edge(litho, ca, cb, user_approved=False, section_id=sec.id)
    db_session.add(unapproved_edge)
    await db_session.commit()

    result = await PropagateLithoAdmixtures(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        seed_formation_id=f_a.id,
        admixtures=_ADMIXTURES_B,
    )

    # Seed is a singleton component (unapproved edge is invisible).
    assert result.component_size == 1, (
        f"Unapproved edge must not extend the component; got size={result.component_size}"
    )

    await db_session.refresh(f_a)
    await db_session.refresh(f_b)

    assert f_a.litho_admixtures == _ADMIXTURES_B, (
        f"Seed must carry its own admixtures; got {f_a.litho_admixtures}"
    )
    assert (f_b.litho_admixtures or []) == [], (
        f"Isolated peer must have no admixtures; got {f_b.litho_admixtures}"
    )


# ---------------------------------------------------------------------------
# Test 3: chain F1↔F2↔F3 via two approved edges → all three receive admixtures
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chain_of_approved_edges_propagates_to_all_formations(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """BFS must traverse both edges in a linear chain F1↔F2↔F3.

    Seeding on F1 must write the admixtures to all three formations because
    all edges are user_approved=True.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary T3")
    f1 = _formation(project, geo_parent, name="ZAND occ 1", soil_code="ZAND")
    f2 = _formation(project, geo_parent, name="ZAND occ 2", soil_code="ZAND")
    f3 = _formation(project, geo_parent, name="ZAND occ 3", soil_code="ZAND")
    bh1 = _borehole(project.id, suffix="121", x=150000.0)
    bh2 = _borehole(project.id, suffix="122", x=150200.0)
    bh3 = _borehole(project.id, suffix="123", x=150400.0)

    db_session.add_all([geo, litho, geo_parent, f1, f2, f3, bh1, bh2, bh3])
    await db_session.flush()

    # Each formation gets one contact at its respective borehole.
    c1 = _contact(litho, f1, bh1, depth=3.0)
    c2 = _contact(litho, f2, bh2, depth=3.5)
    c3 = _contact(litho, f3, bh3, depth=4.0)
    db_session.add_all([c1, c2, c3])
    await db_session.flush()

    # Two approved edges: F1↔F2 (via c1,c2) and F2↔F3 (via c2b,c3).
    # F2 needs a second contact to form the F2↔F3 edge from a different borehole.
    # Alternatively, use c2 on the left side of both edges — but that would create
    # two edges sharing the same contact, which is valid (contact can participate
    # in multiple edges).  Use distinct contacts for cleaner semantics.
    c2b = _contact(litho, f2, bh2, depth=3.6)
    db_session.add(c2b)
    await db_session.flush()

    sec = _minimal_section(project, name="Sec-PLAB-T3")
    db_session.add(sec)
    await db_session.flush()

    edge_12 = _contact_edge(litho, c1, c2, user_approved=True, section_id=sec.id)
    edge_23 = _contact_edge(litho, c2b, c3, user_approved=True, section_id=sec.id)
    db_session.add_all([edge_12, edge_23])
    await db_session.commit()

    result = await PropagateLithoAdmixtures(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        seed_formation_id=f1.id,
        admixtures=_ADMIXTURES_A,
    )

    assert result.component_size == 3, (
        f"Chain of two edges must form a 3-formation component; got size={result.component_size}"
    )

    await db_session.refresh(f1)
    await db_session.refresh(f2)
    await db_session.refresh(f3)

    assert f1.litho_admixtures == _ADMIXTURES_A, (
        f"F1 (seed) must carry admixtures; got {f1.litho_admixtures}"
    )
    assert f2.litho_admixtures == _ADMIXTURES_A, (
        f"F2 (middle of chain) must carry admixtures; got {f2.litho_admixtures}"
    )
    assert f3.litho_admixtures == _ADMIXTURES_A, (
        f"F3 (end of chain) must carry admixtures; got {f3.litho_admixtures}"
    )
