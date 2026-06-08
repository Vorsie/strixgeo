"""Integration tests for UncorrelateLithoContacts — section-scope fix.

Pins two behaviours added in the section-scoped-correlations branch:

UC1.  When the SAME contact pair exists as edges on TWO sections (S1 and S2),
      uncorrelating on S1 removes only the S1 edge; the S2 edge survives and
      NO exception is raised.

      Before the fix, ``UncorrelateLithoContacts.execute`` queried only
      ``(model_id, contact_a_id, contact_b_id)`` and called
      ``scalar_one_or_none()`` — which raises ``MultipleResultsFound`` when
      two rows match (both sections have the same pair).

UC2.  Uncorrelating a pair/section with NO edge is a clean no-op (already
      idempotent, but pinned here so regression is visible).

UC3.  Passing ``request_section_id=None`` raises ``ValueError`` immediately
      (section-scoped invariant — uncorrelate is a section gesture, symmetric
      with correlate).
"""

from __future__ import annotations

import types
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
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
# Helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved ``BoreholeOrm`` at *x* along y=200000."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-UC-{suffix}",
        app_project_id=project_id,
        project_id="UC",
        test_id=f"BH-UC-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _section(project_id: UUID, *, name: str) -> CrossSectionOrm:
    """Return an unsaved ``CrossSectionOrm`` spanning bh_a and bh_b."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=name,
        start_x=149900.0,
        start_y=200000.0,
        end_x=150300.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=500.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
        vertical_exaggeration=1.0,
        display_order=0,
    )


# ---------------------------------------------------------------------------
# Shared fixture — two sections, same contact pair
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for UncorrelateLithoContacts tests."""
    proj = ProjectOrm(id=uuid7(), name="uncorrelate litho contacts test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def two_section_pair(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> types.SimpleNamespace:
    """Litho model + two boreholes + two contacts + two sections.

    Both sections span the same corridor so the same contact pair can be
    correlated on both.  Returns a ``SimpleNamespace`` with:

      project_id, model_id, section1_id, section2_id, layer_a_id, layer_b_id
    """
    geo = _geo_model(project, name="Geo UC")
    litho = _litho_model(project, geo, name="Litho UC")
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND UC",
        color="#aabbcc",
        display_order=0,
    )
    bh_a = _borehole(project.id, suffix="A", x=150000.0)
    bh_b = _borehole(project.id, suffix="B", x=150200.0)

    db_session.add_all([geo, litho, formation, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, formation, bh_a, depth=3.0)
    cb = _contact(litho, formation, bh_b, depth=3.1)
    db_session.add_all([ca, cb])
    await db_session.flush()

    sec1 = _section(project.id, name="Sec-UC-1")
    sec2 = _section(project.id, name="Sec-UC-2")
    db_session.add_all([sec1, sec2])
    await db_session.commit()

    return types.SimpleNamespace(
        project_id=project.id,
        model_id=litho.id,
        section1_id=sec1.id,
        section2_id=sec2.id,
        layer_a_id=ca.id,
        layer_b_id=cb.id,
    )


# ---------------------------------------------------------------------------
# UC1 — uncorrelate on S1 removes only the S1 edge; S2 edge survives
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uncorrelate_section_scoped_leaves_other_section_edge(
    db_session: AsyncSession,
    two_section_pair: types.SimpleNamespace,
) -> None:
    """Correlate the same pair on S1 AND S2, then uncorrelate on S1.

    The S1 edge must disappear; the S2 edge must survive; no exception raised.

    Before the fix: ``scalar_one_or_none()`` against (model_id, a_id, b_id)
    matched 2 rows → ``MultipleResultsFound`` (unhandled → 500).
    """
    ctx = two_section_pair
    correlate = CorrelateLithoContacts(db_session)

    # Correlate on S1.
    r1 = await correlate.execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        contact_a_id=ctx.layer_a_id,
        contact_b_id=ctx.layer_b_id,
        source="manual",
        request_section_id=ctx.section1_id,
    )
    assert r1.was_created, "Setup: edge on section 1 must be created"
    edge_s1_id = r1.edge.id

    # Correlate the SAME pair on S2 (different section → distinct row).
    r2 = await correlate.execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        contact_a_id=ctx.layer_a_id,
        contact_b_id=ctx.layer_b_id,
        source="manual",
        request_section_id=ctx.section2_id,
    )
    assert r2.was_created, "Setup: same pair on section 2 must create a SECOND edge"
    edge_s2_id = r2.edge.id
    assert edge_s1_id != edge_s2_id, "Setup: two distinct edges must exist"

    # Uncorrelate on S1 only — must NOT raise MultipleResultsFound.
    await UncorrelateLithoContacts(db_session).execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        contact_a_id=ctx.layer_a_id,
        contact_b_id=ctx.layer_b_id,
        request_section_id=ctx.section1_id,
    )

    # S1 edge gone.
    s1_row = await db_session.get(LithoContactCorrelationEdgeOrm, edge_s1_id)
    assert s1_row is None, "Edge authored on section 1 must be deleted"

    # S2 edge survives.
    s2_row = await db_session.get(LithoContactCorrelationEdgeOrm, edge_s2_id)
    assert s2_row is not None, "Edge authored on section 2 must survive the S1 uncorrelate"


# ---------------------------------------------------------------------------
# UC2 — no-op when no edge exists on the given section
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uncorrelate_no_edge_is_noop(
    db_session: AsyncSession,
    two_section_pair: types.SimpleNamespace,
) -> None:
    """Uncorrelating a pair/section with no edge is a clean no-op (no error)."""
    ctx = two_section_pair

    # No edges exist — call must return cleanly without an exception.
    await UncorrelateLithoContacts(db_session).execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        contact_a_id=ctx.layer_a_id,
        contact_b_id=ctx.layer_b_id,
        request_section_id=ctx.section1_id,
    )

    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == ctx.model_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == [], "No edges must exist after no-op uncorrelate"


# ---------------------------------------------------------------------------
# UC3 — None section_id raises ValueError immediately
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uncorrelate_none_section_id_raises_value_error(
    db_session: AsyncSession,
    two_section_pair: types.SimpleNamespace,
) -> None:
    """``request_section_id=None`` must raise ``ValueError`` (section-scoped invariant).

    UncorrelateLithoContacts is always a section gesture; a None would produce
    a query that matches all sections for the pair → MultipleResultsFound.
    The guard surfaces this as a clear ValueError so the router maps it to 422.
    """
    ctx = two_section_pair

    with pytest.raises(ValueError, match="requires request_section_id"):
        await UncorrelateLithoContacts(db_session).execute(
            project_id=ctx.project_id,
            model_id=ctx.model_id,
            contact_a_id=ctx.layer_a_id,
            contact_b_id=ctx.layer_b_id,
            request_section_id=None,  # the bug: None reaches scalar_one_or_none
        )
