"""Integration tests for DetectBodies.

Seven cases:
1. Bilateral closure (#135 topology, four correlated contacts from A → two
   distinct targets B and C) materialises a BodyOrm row with both extents
   populated (kind='to_target') after the explicit Detect verb runs.
2. After detection has materialised a body row, removing one defining edge
   then re-running DetectBodies removes the stale body row.
3. Unapproved edges do NOT seed bodies when DetectBodies runs directly.
4. Unresolved instance_ordinal → skipped (bodies_skipped_unresolved_ordinal++)
   and no BodyOrm row is created.
5. Named body row survives a stale-topology reconcile (preserve-named guard).
6. Provenance rule — a body with extent_left_kind='pinch_out_halfway'
   survives a Detect pass that would otherwise write 'to_target' on the left;
   the user-claimed kind is preserved, the right extent is still updated.
7. E1 regression — executing DetectBodies for a 5-body model issues exactly
   one SELECT against the body table (the bulk pre-fetch), regardless of
   how many candidates the detector emits.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
from groundmodel.application.detect_bodies import DetectBodies
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
)

# ---------------------------------------------------------------------------
# Private fixture helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="DBODIES",
        test_id=f"BH-DBODIES-{suffix}",
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
        name="Geo-DBODIES",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-DBODIES",
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
    """A bare active project for body-detection tests."""
    proj = ProjectOrm(id=uuid7(), name="body detection test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: bilateral #135 gesture → BodyOrm row with to_target extents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bilateral_gesture_materialises_body_with_extents(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Four CorrelateLithoContacts calls forming a bilateral #135 topology
    result in one BodyOrm row with both extents after DetectBodies runs.

    Topology:
      bh_a has three contacts:
        c_lens_top  (depth=2, formation_id=f_top_cap)  — top of cap above body
        c_lens_body (depth=4, formation_id=f_body)     — top of the KLEI body
        c_lens_base (depth=6, formation_id=f_base_cap) — top of cap below body
      bh_b has one contact:
        c_single_b  (depth=3, formation_id=f_b) — left lateral closure target
      bh_c has one contact:
        c_single_c  (depth=3, formation_id=f_b) — right lateral closure target
      Edges 1-2: c_lens_body / c_lens_base ↔ c_single_b  (closes to B)
      Edges 3-4: c_lens_body / c_lens_base ↔ c_single_c  (closes to C)
    Bilateral closure (≥2 distinct target investigations) is required.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t1")
    f_top_cap = _formation(project, parent, name="ZAND top cap t1", soil_code="ZAND")
    f_body = _formation(project, parent, name="KLEI body t1", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap t1", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b t1", soil_code="ZAND")

    bh_a = _borehole(project.id, suffix="A01", x=150000.0)
    bh_b = _borehole(project.id, suffix="B01", x=150300.0)
    bh_c = _borehole(project.id, suffix="C01", x=149700.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_body, f_base_cap, f_b, bh_a, bh_b, bh_c])
    await db_session.flush()

    c_lens_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_lens_body = _contact(litho, f_body, bh_a, depth=4.0)
    c_lens_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)
    c_single_c = _contact(litho, f_b, bh_c, depth=3.0)

    db_session.add_all([c_lens_top, c_lens_body, c_lens_base, c_single_b, c_single_c])
    await db_session.commit()

    # Four correlate gestures — bilateral #135 closure.
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_lens_body.id,
        contact_b_id=c_single_b.id,
    )
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_lens_base.id,
        contact_b_id=c_single_b.id,
    )
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_lens_body.id,
        contact_b_id=c_single_c.id,
    )
    await CorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_lens_base.id,
        contact_b_id=c_single_c.id,
    )

    # DetectBodies must not auto-fire from CorrelateLithoContacts.
    pre_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(pre_rows) == 0, (
        f"Body detection must not auto-fire from CorrelateLithoContacts; got {len(pre_rows)}"
    )

    # Explicit Detect verb.
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.bodies_created == 1, f"Expected 1 body created; got {result.bodies_created}"
    assert result.bodies_removed == 0

    body_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(body_rows) == 1, f"Expected exactly one BodyOrm row; got {len(body_rows)}"
    body = body_rows[0]
    assert body.formation_id == f_body.id, (
        f"Body must be f_body ({f_body.id}); got {body.formation_id}"
    )
    assert body.app_project_id == project.id
    assert body.model_id == litho.id
    # Both extent sides must be populated with 'to_target'.
    assert body.extent_left_kind == EXTENT_KIND_TO_TARGET, (
        f"extent_left_kind must be 'to_target'; got {body.extent_left_kind!r}"
    )
    assert body.extent_right_kind == EXTENT_KIND_TO_TARGET, (
        f"extent_right_kind must be 'to_target'; got {body.extent_right_kind!r}"
    )
    # Both target contacts and neighbour investigations must be populated.
    assert body.extent_left_target_contact_id is not None
    assert body.extent_right_target_contact_id is not None
    assert body.extent_left_neighbour_inv_id is not None
    assert body.extent_right_neighbour_inv_id is not None
    # The two lateral neighbours must be distinct (bilateral by definition).
    assert body.extent_left_neighbour_inv_id != body.extent_right_neighbour_inv_id, (
        "Left and right neighbour investigations must differ for a bilateral body"
    )


# ---------------------------------------------------------------------------
# Test 2: uncorrelate breaks topology → body row removed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uncorrelate_removes_body_when_topology_breaks(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Bilateral closure → body; removing one side's edges drops the second
    target investigation, so the next explicit Detect pass removes the stale
    BodyOrm row.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t2")
    f_top_cap = _formation(project, parent, name="ZAND top cap t2", soil_code="ZAND")
    f_body = _formation(project, parent, name="KLEI body t2", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap t2", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b t2", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A02", x=151000.0)
    bh_b = _borehole(project.id, suffix="B02", x=151300.0)
    bh_c = _borehole(project.id, suffix="C02", x=150700.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_body, f_base_cap, f_b, bh_a, bh_b, bh_c])
    await db_session.flush()

    c_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_body = _contact(litho, f_body, bh_a, depth=4.0)
    c_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)
    c_single_c = _contact(litho, f_b, bh_c, depth=3.0)

    db_session.add_all([c_top, c_body, c_base, c_single_b, c_single_c])
    await db_session.commit()

    # Build bilateral closure + run detect.
    for ca, cb in [
        (c_body, c_single_b),
        (c_base, c_single_b),
        (c_body, c_single_c),
        (c_base, c_single_c),
    ]:
        await CorrelateLithoContacts(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            contact_a_id=ca.id,
            contact_b_id=cb.id,
        )
    await DetectBodies(db_session).execute(project_id=project.id, model_id=litho.id)
    await db_session.commit()

    pre_count = len(
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert pre_count == 1, f"Expected 1 body before removal; got {pre_count}"

    # Remove BOTH edges to bh_c — now only unilateral closure to bh_b remains.
    await UncorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_body.id,
        contact_b_id=c_single_c.id,
    )
    await UncorrelateLithoContacts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        contact_a_id=c_base.id,
        contact_b_id=c_single_c.id,
    )

    # Stale body row must survive until the next explicit Detect pass.
    interim_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(interim_rows) == 1, (
        f"UncorrelateLithoContacts must NOT auto-reconcile body rows; got {len(interim_rows)}"
    )

    # Explicit Detect pass — stale row removed.
    await DetectBodies(db_session).execute(project_id=project.id, model_id=litho.id)
    await db_session.commit()

    post_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(post_rows) == 0, f"Expected no BodyOrm rows after Detect rerun; got {len(post_rows)}"


# ---------------------------------------------------------------------------
# Test 3: unapproved edges do NOT seed bodies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unapproved_edges_do_not_seed_bodies(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Unapproved edges forming a bilateral topology produce no BodyOrm rows."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t3")
    f_top_cap = _formation(project, parent, name="ZAND top cap t3", soil_code="ZAND")
    f_body = _formation(project, parent, name="KLEI body t3", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap t3", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b t3", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A03", x=152000.0)
    bh_b = _borehole(project.id, suffix="B03", x=152300.0)
    bh_c = _borehole(project.id, suffix="C03", x=151700.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_body, f_base_cap, f_b, bh_a, bh_b, bh_c])
    await db_session.flush()

    c_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_body_c = _contact(litho, f_body, bh_a, depth=4.0)
    c_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)
    c_single_c = _contact(litho, f_b, bh_c, depth=3.0)

    db_session.add_all([c_top, c_body_c, c_base, c_single_b, c_single_c])
    await db_session.flush()

    # Insert unapproved edges directly — bypass the use case.
    for ca, cb in [
        (c_body_c, c_single_b),
        (c_base, c_single_b),
        (c_body_c, c_single_c),
        (c_base, c_single_c),
    ]:
        db_session.add(_raw_edge(litho, ca, cb, user_approved=False, source="auto"))
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=litho.id)
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.bodies_created == 0, (
        f"Unapproved edges must not create body rows; got bodies_created={result.bodies_created}"
    )
    body_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(body_rows) == 0, (
        f"Expected 0 BodyOrm rows from unapproved edges; got {len(body_rows)}"
    )


# ---------------------------------------------------------------------------
# Test 4: unresolved ordinal → skipped, no body row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unresolved_ordinal_logged_and_skipped(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When instance_ordinal is null on the body's formation, detector skips it."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t4")
    f_top_cap = _formation(project, parent, name="ZAND top cap t4", soil_code="ZAND")
    f_body = _formation(project, parent, name="KLEI body t4", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap t4", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b t4", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A04", x=153000.0)
    bh_b = _borehole(project.id, suffix="B04", x=153300.0)
    bh_c = _borehole(project.id, suffix="C04", x=152700.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_body, f_base_cap, f_b, bh_a, bh_b, bh_c])
    await db_session.flush()

    c_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_body_c = _contact(litho, f_body, bh_a, depth=4.0)
    c_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)
    c_single_c = _contact(litho, f_b, bh_c, depth=3.0)

    db_session.add_all([c_top, c_body_c, c_base, c_single_b, c_single_c])
    await db_session.flush()

    # Four approved edges forming a bilateral topology.
    for ca, cb in [
        (c_body_c, c_single_b),
        (c_base, c_single_b),
        (c_body_c, c_single_c),
        (c_base, c_single_c),
    ]:
        db_session.add(_raw_edge(litho, ca, cb, user_approved=True))
    await db_session.flush()

    # Force instance_ordinal to NULL on the body formation.
    await db_session.execute(
        update(GeologicalFormationOrm)
        .where(GeologicalFormationOrm.id == f_body.id)
        .values(instance_ordinal=None)
    )
    await db_session.commit()

    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.bodies_skipped_unresolved_ordinal >= 1, (
        "Detector must report at least one skip when instance_ordinal is null; "
        f"got {result.bodies_skipped_unresolved_ordinal}"
    )
    assert result.bodies_created == 0, (
        f"Skipped candidates must not create body rows; got bodies_created={result.bodies_created}"
    )
    body_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(body_rows) == 0, (
        f"Expected 0 BodyOrm rows when ordinal unresolved; got {len(body_rows)}"
    )


# ---------------------------------------------------------------------------
# Test 5: named body survives a stale-topology reconcile (preserve-named guard)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_named_body_survives_stale_topology_reconcile(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A BodyOrm row with name IS NOT NULL survives the reconcile sweep even
    when its topology no longer matches the bilateral-closure rule.
    Named bodies can only be removed via the explicit DELETE endpoint.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t5")
    f_body = _formation(project, parent, name="Named body t5", soil_code="KLEI")
    bh = _borehole(project.id, suffix="T5", x=160000.0)

    db_session.add_all([geo, litho, parent, f_body, bh])
    await db_session.flush()
    await db_session.execute(
        update(GeologicalFormationOrm)
        .where(GeologicalFormationOrm.id == f_body.id)
        .values(instance_ordinal=0)
    )

    # Insert a named body row directly — simulates a user-named row
    # whose topology no longer qualifies under the bilateral rule.
    named_body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=f_body.id,
        body_ordinal=0,
        source_investigation_id=bh.id,
        name="Channel sand body",
    )
    db_session.add(named_body)
    await db_session.commit()

    # Run detector against an empty edge graph — no candidate fires, so
    # the named row falls into the "stale" branch of the reconcile sweep.
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.bodies_removed == 0, (
        f"Named body must survive a stale-topology reconcile; "
        f"got bodies_removed={result.bodies_removed}"
    )
    survivors = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(survivors) == 1, f"Named body row must persist; got {len(survivors)} rows"
    assert survivors[0].name == "Channel sand body"


# ---------------------------------------------------------------------------
# Test 6: provenance rule — user-claimed extent is never overwritten
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provenance_rule_user_claimed_extent_is_preserved(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Detector NEVER overwrites a user-claimed extent kind.

    Setup: build a bilateral topology (bh_a body enclosed by bh_b and bh_c).
    Run DetectBodies once to materialise the BodyOrm row with both extents
    as 'to_target'.  Then manually set extent_left_kind='pinch_out_halfway'
    on the row (simulating a user claiming that side).  Run DetectBodies
    again — the left extent must remain 'pinch_out_halfway', while the
    right extent stays 'to_target'.

    The body must also NOT be deleted by the reconcile sweep because it
    has at least one user-claimed extent (preserve-claimed guard).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t6")
    f_top_cap = _formation(project, parent, name="ZAND top cap t6", soil_code="ZAND")
    f_body = _formation(project, parent, name="KLEI body t6", soil_code="KLEI")
    f_base_cap = _formation(project, parent, name="ZAND base cap t6", soil_code="ZAND")
    f_b = _formation(project, parent, name="ZAND b t6", soil_code="ZAND")
    bh_a = _borehole(project.id, suffix="A06", x=155000.0)
    bh_b = _borehole(project.id, suffix="B06", x=155300.0)
    bh_c = _borehole(project.id, suffix="C06", x=154700.0)

    db_session.add_all([geo, litho, parent, f_top_cap, f_body, f_base_cap, f_b, bh_a, bh_b, bh_c])
    await db_session.flush()

    c_lens_top = _contact(litho, f_top_cap, bh_a, depth=2.0)
    c_lens_body = _contact(litho, f_body, bh_a, depth=4.0)
    c_lens_base = _contact(litho, f_base_cap, bh_a, depth=6.0)
    c_single_b = _contact(litho, f_b, bh_b, depth=3.0)
    c_single_c = _contact(litho, f_b, bh_c, depth=3.0)

    db_session.add_all([c_lens_top, c_lens_body, c_lens_base, c_single_b, c_single_c])
    await db_session.commit()

    # Four approved edges — bilateral closure.
    for ca, cb in [
        (c_lens_body, c_single_b),
        (c_lens_base, c_single_b),
        (c_lens_body, c_single_c),
        (c_lens_base, c_single_c),
    ]:
        await CorrelateLithoContacts(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            contact_a_id=ca.id,
            contact_b_id=cb.id,
        )

    # First detect pass — both extents land as 'to_target'.
    await DetectBodies(db_session).execute(project_id=project.id, model_id=litho.id)
    await db_session.commit()

    body_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(body_rows) == 1
    body = body_rows[0]
    assert body.extent_left_kind == EXTENT_KIND_TO_TARGET
    assert body.extent_right_kind == EXTENT_KIND_TO_TARGET

    # Simulate user claiming the LEFT side as 'pinch_out_halfway'.
    await db_session.execute(
        update(BodyOrm)
        .where(BodyOrm.id == body.id)
        .values(extent_left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY)
    )
    await db_session.commit()

    # Second detect pass — provenance rule must protect the left side.
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    # The body must NOT be removed (preserve-claimed guard).
    assert result.bodies_removed == 0, (
        "Body with user-claimed extent must not be removed by reconcile; "
        f"got bodies_removed={result.bodies_removed}"
    )

    updated_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    assert len(updated_rows) == 1, (
        f"Body with user-claimed extent must persist; got {len(updated_rows)} rows"
    )
    updated = updated_rows[0]

    # Left side: provenance rule — must remain 'pinch_out_halfway'.
    assert updated.extent_left_kind == EXTENT_KIND_PINCH_OUT_HALFWAY, (
        f"Detector must NOT overwrite user-claimed left extent; "
        f"got {updated.extent_left_kind!r} (expected 'pinch_out_halfway')"
    )
    # Right side: not user-claimed — detector may update it.
    assert updated.extent_right_kind == EXTENT_KIND_TO_TARGET, (
        f"Detector must update unclaimed right extent to 'to_target'; "
        f"got {updated.extent_right_kind!r}"
    )


# ---------------------------------------------------------------------------
# Test 7: E1 regression — exactly one body-table SELECT per DetectBodies call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_detect_bodies_issues_one_body_table_select(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """DetectBodies issues exactly one SELECT against the body table per call.

    Regression guard for the E1 audit fix: the upsert loop and the reconcile
    step both used to issue per-iteration SELECTs against ``body``.  After the
    bulk pre-fetch fix the total body-table SELECT count must be 1 regardless
    of how many candidates the detector emits.

    Setup:  5 independent body formations (each enclosed in its own bilateral
    closure) sharing one source borehole (bh_a) and two target boreholes (bh_b,
    bh_c).  Each body i uses a distinct ``f_body_i`` formation so DetectBodies
    sees 5 distinct candidates.

    Measurement:  ``before_cursor_execute`` listener on the synchronous engine
    (accessed via ``session.sync_session.get_bind()``) counts every SQL
    statement whose normalised text contains ``FROM body`` or
    ``SELECT … body``.  The expected count is 1.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-t7")

    # 5 body formations, each with a cap formation above and below.
    # Using a simple two-contact enclosure per body (cap/body contact pair).
    n_bodies = 5
    f_caps: list[GeologicalFormationOrm] = []
    f_bodies: list[GeologicalFormationOrm] = []
    for i in range(n_bodies):
        f_caps.append(_formation(project, parent, name=f"ZAND cap t7_{i}", soil_code="ZAND"))
        f_bodies.append(_formation(project, parent, name=f"KLEI body t7_{i}", soil_code="KLEI"))

    # Three boreholes: A is the source, B and C are the bilateral targets.
    bh_a = _borehole(project.id, suffix="A07", x=155000.0)
    bh_b = _borehole(project.id, suffix="B07", x=155300.0)
    bh_c = _borehole(project.id, suffix="C07", x=154700.0)

    db_session.add_all([geo, litho, parent, bh_a, bh_b, bh_c, *f_caps, *f_bodies])
    await db_session.flush()

    # Per-body contacts on bh_a: alternating cap / body depths so each body
    # is properly enclosed (cap contact above, body contact just below).
    # bh_b and bh_c each get one contact per body at the midpoint depth.
    contacts_a: list[FormationContactOrm] = []
    contacts_b: list[FormationContactOrm] = []
    contacts_c: list[FormationContactOrm] = []
    for i in range(n_bodies):
        base_depth = float(i * 4)
        # Cap contact (top of the enclosing sand) — part of the bilateral stack.
        c_cap = _contact(litho, f_caps[i], bh_a, depth=base_depth)
        # Body contact (top of the enclosed clay) — this is the body formation.
        c_body = _contact(litho, f_bodies[i], bh_a, depth=base_depth + 1.0)
        contacts_a.append(c_cap)
        contacts_a.append(c_body)
        contacts_b.append(_contact(litho, f_bodies[i], bh_b, depth=base_depth + 0.5))
        contacts_c.append(_contact(litho, f_bodies[i], bh_c, depth=base_depth + 0.5))

    db_session.add_all([*contacts_a, *contacts_b, *contacts_c])
    await db_session.flush()

    # Wire bilateral edges for each body: cap + body contacts on bh_a
    # correlate to bh_b and bh_c respectively.  Each body needs 4 edges.
    for i in range(n_bodies):
        c_cap = contacts_a[i * 2]
        c_body = contacts_a[i * 2 + 1]
        c_b = contacts_b[i]
        c_c = contacts_c[i]
        for ca, cb in [(c_cap, c_b), (c_body, c_b), (c_cap, c_c), (c_body, c_c)]:
            db_session.add(_raw_edge(litho, ca, cb, user_approved=True, source="manual"))

    await db_session.commit()

    # Resolve instance ordinals so the detector can use them.
    await ResolveLithoInstances(db_session).execute(model_id=litho.id)
    await db_session.commit()

    # ------------------------------------------------------------------ #
    # Instrument the synchronous engine to count body-table SELECTs.     #
    # ------------------------------------------------------------------ #
    sync_engine = db_session.sync_session.get_bind()
    body_selects: list[str] = []

    def _count_body_selects(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,  # noqa: FBT001
    ) -> None:
        """Append statement to body_selects when it targets the body table."""
        # Normalise whitespace to make the check robust across formatting.
        normalised = " ".join(statement.split()).upper()
        if "FROM BODY" in normalised or "SELECT" in normalised and " BODY " in normalised:
            body_selects.append(statement)

    event.listen(sync_engine, "before_cursor_execute", _count_body_selects)
    try:
        result = await DetectBodies(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
        )
        await db_session.commit()
    finally:
        event.remove(sync_engine, "before_cursor_execute", _count_body_selects)

    assert result.bodies_created == n_bodies, (
        f"Expected {n_bodies} bodies created; got {result.bodies_created}"
    )
    assert len(body_selects) == 1, (
        f"E1 regression: DetectBodies must issue exactly 1 body-table SELECT "
        f"(the bulk pre-fetch); got {len(body_selects)}.\n"
        f"Statements observed:\n" + "\n---\n".join(body_selects)
    )
