"""Integration tests for DetectLithoLenses + the wired Correlate/Uncorrelate path.

Four cases:
1. Manual #135 gesture (two correlated contacts from A → same target B)
   materialises a LithoLensOrm row after CorrelateLithoContacts.
2. Removing one defining edge via UncorrelateLithoContacts deletes the lens row.
3. Unapproved edges do NOT seed lenses when DetectLithoLenses runs directly.
4. Unresolved instance_ordinal → skipped (lenses_skipped_unresolved_ordinal++)
   and no LithoLensOrm row is created.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
from groundmodel.application.detect_litho_lenses import DetectLithoLenses
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
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Private fixture helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="DLENS",
        test_id=f"BH-DLENS-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _geo_model(project: ProjectOrm) -> GeologicalModelOrm:
    """Return an unsaved geological GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-DLENS",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-DLENS",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
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


def _contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
) -> FormationContactOrm:
    """Return an unsaved FormationContactOrm."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source="borehole_observation",
        confidence="medium",
    )


def _raw_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
    *,
    user_approved: bool = True,
    source: str = "manual",
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved LithoContactCorrelationEdgeOrm (canonical ordering)."""
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


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for lens-detection tests."""
    proj = ProjectOrm(id=uuid7(), name="lens detection test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: #135 gesture → LithoLensOrm row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_135_gesture_materialises_lens_metadata(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Two CorrelateLithoContacts calls forming the #135 topology result in one LithoLensOrm row.

    Topology (Strix contact convention: contact.formation_id = the formation whose TOP
    starts at that contact's depth):
      bh_a has three contacts:
        c_lens_top  (depth=2, formation_id=f_top_cap)  — top of the cap above the lens
        c_lens_body (depth=4, formation_id=f_lens)     — top of the KLEI lens body
        c_lens_base (depth=6, formation_id=f_base_cap) — top of the cap below the lens
      bh_b has one contact:
        c_single_b  (depth=3, formation_id=f_b)        — single boundary on the thin column
      Edge 1: c_lens_body ↔ c_single_b  (top boundary of lens converges to B)
      Edge 2: c_lens_base ↔ c_single_b  (base boundary of lens converges to the same point)
    The body between c_lens_body and c_lens_base on bh_a carries formation_id=f_lens
    (the shallower of the two source contacts — domain algorithm: fid_above).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-test1")
    # Three litho formations on bh_a: top-cap, LENS body, base-cap.
    f_top_cap = _formation(project, parent, name="ZAND top cap", soil_code="ZAND")
    f_lens = _formation(project, parent, name="KLEI lens", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap", soil_code="ZAND")
    # Single formation on bh_b.
    f_b = _formation(project, parent, name="ZAND b", soil_code="ZAND")

    bh_a = _borehole(project.id, suffix="A01", x=150000.0)
    bh_b = _borehole(project.id, suffix="B01", x=150300.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_lens, f_base_cap, f_b, bh_a, bh_b])
    await db_session.flush()

    # Contacts on bh_a — three formation tops, depth-sorted.
    c_lens_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_lens_body = _contact(litho, f_lens, bh_a, depth=4.0)
    c_lens_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    # Single contact on bh_b.
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)

    db_session.add_all([c_lens_top, c_lens_body, c_lens_base, c_single_b])
    await db_session.commit()

    # --- Gesture 1: correlate the TOP boundary of the lens ---
    # c_lens_body (depth=4, f_lens) is the top of the lens body.
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_lens_body.id,
        contact_b_id=c_single_b.id,
    )

    # --- Gesture 2: correlate BASE boundary (#135 topology completes here) ---
    # c_lens_base (depth=6, f_base_cap) is the base of the lens body.
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_lens_base.id,
        contact_b_id=c_single_b.id,
    )

    # After both gestures, exactly one LithoLensOrm row must exist.
    lens_rows = (
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )

    assert len(lens_rows) == 1, f"Expected exactly one LithoLensOrm row; got {len(lens_rows)}"
    lens = lens_rows[0]
    assert lens.formation_id == f_lens.id, (
        f"Lens body must be f_lens ({f_lens.id}); got {lens.formation_id}"
    )
    assert lens.app_project_id == project.id
    assert lens.model_id == litho.id


# ---------------------------------------------------------------------------
# Test 2: uncorrelate breaks topology → lens row removed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uncorrelate_removes_lens_when_topology_breaks(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Removing one of the two defining edges deletes the LithoLensOrm row."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-test2")
    f_top_cap = _formation(project, parent, name="ZAND top cap 2", soil_code="ZAND")
    f_lens = _formation(project, parent, name="KLEI lens 2", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap 2", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b2", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A02", x=151000.0)
    bh_b = _borehole(project.id, suffix="B02", x=151300.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_lens, f_base_cap, f_b, bh_a, bh_b])
    await db_session.flush()

    c_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_body = _contact(litho, f_lens, bh_a, depth=4.0)
    c_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single = _contact(litho, f_b, bh_b, depth=3.0)

    db_session.add_all([c_top, c_body, c_base, c_single])
    await db_session.commit()

    # Build the lens via two Correlate calls.
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_top.id,
        contact_b_id=c_single.id,
    )
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_base.id,
        contact_b_id=c_single.id,
    )

    # Confirm the lens row exists before the removal.
    pre_count = len(
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert pre_count == 1, f"Expected 1 lens before removal; got {pre_count}"

    # Remove one defining edge — topology breaks.
    await UncorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_base.id,
        contact_b_id=c_single.id,
    )

    post_rows = (
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(post_rows) == 0, (
        f"Expected no LithoLensOrm rows after topology broke; got {len(post_rows)}"
    )


# ---------------------------------------------------------------------------
# Test 3: unapproved edges do NOT seed lenses
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unapproved_edges_do_not_seed_lenses(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Two unapproved edges forming #135 topology produce no LithoLensOrm rows."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-test3")
    f_top_cap = _formation(project, parent, name="ZAND top cap 3", soil_code="ZAND")
    f_lens = _formation(project, parent, name="KLEI lens 3", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap 3", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b3", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A03", x=152000.0)
    bh_b = _borehole(project.id, suffix="B03", x=152300.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_lens, f_base_cap, f_b, bh_a, bh_b])
    await db_session.flush()

    c_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_body = _contact(litho, f_lens, bh_a, depth=4.0)
    c_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single = _contact(litho, f_b, bh_b, depth=3.0)

    db_session.add_all([c_top, c_body, c_base, c_single])
    await db_session.flush()

    # Insert raw unapproved edges directly — bypass the use case.
    e1 = _raw_edge(litho, c_top, c_single, user_approved=False, source="auto")
    e2 = _raw_edge(litho, c_base, c_single, user_approved=False, source="auto")
    db_session.add_all([e1, e2])
    await db_session.commit()

    # Run the resolver first (so ordinals are set), then the lens detector.
    await ResolveLithoInstances(db_session).execute(model_id=litho.id)
    result = await DetectLithoLenses(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    # DetectLithoLenses flushes but doesn't commit; commit manually.
    await db_session.commit()

    assert result.lenses_created == 0, (
        f"Unapproved edges must not create lens rows; got lenses_created={result.lenses_created}"
    )

    lens_rows = (
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(lens_rows) == 0, (
        f"Expected 0 LithoLensOrm rows from unapproved edges; got {len(lens_rows)}"
    )


# ---------------------------------------------------------------------------
# Test 4: unresolved ordinal → skipped, no lens row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unresolved_ordinal_logged_and_skipped(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When instance_ordinal is null on the lens body's formation, detector skips it.

    Approach: insert approved edges forming the #135 topology, then NULL
    out the instance_ordinal on the lens body's formation (simulating a
    formation that the resolver hasn't processed yet), then call
    DetectLithoLenses directly.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-test4")
    f_top_cap = _formation(project, parent, name="ZAND top cap 4", soil_code="ZAND")
    f_lens = _formation(project, parent, name="KLEI lens 4", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap 4", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b4", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A04", x=153000.0)
    bh_b = _borehole(project.id, suffix="B04", x=153300.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_lens, f_base_cap, f_b, bh_a, bh_b])
    await db_session.flush()

    c_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_body = _contact(litho, f_lens, bh_a, depth=4.0)
    c_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single = _contact(litho, f_b, bh_b, depth=3.0)

    db_session.add_all([c_top, c_body, c_base, c_single])
    await db_session.flush()

    # Insert approved edges forming the #135 topology.
    e1 = _raw_edge(litho, c_top, c_single, user_approved=True)
    e2 = _raw_edge(litho, c_base, c_single, user_approved=True)
    db_session.add_all([e1, e2])
    await db_session.flush()

    # Force instance_ordinal to NULL on the lens body formation so the
    # detector cannot resolve the body ordinal.
    await db_session.execute(
        update(GeologicalFormationOrm)
        .where(GeologicalFormationOrm.id == f_lens.id)
        .values(instance_ordinal=None)
    )
    await db_session.commit()

    # Run the detector without the resolver (ordinal stays NULL).
    result = await DetectLithoLenses(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.lenses_skipped_unresolved_ordinal >= 1, (
        "Detector must report at least one skip when instance_ordinal is null; "
        f"got {result.lenses_skipped_unresolved_ordinal}"
    )
    assert result.lenses_created == 0, (
        f"Skipped candidates must not create lens rows; got lenses_created={result.lenses_created}"
    )

    lens_rows = (
        (await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(lens_rows) == 0, (
        f"Expected 0 LithoLensOrm rows when ordinal unresolved; got {len(lens_rows)}"
    )
