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
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
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

    # CorrelateLithoContacts runs the resolver (which creates per-instance
    # bodies), but the DETECTOR must not auto-fire — so no body carries a
    # 'to_target' extent until the explicit Detect verb runs.
    pre_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    for pre in pre_rows:
        assert pre.extent_left_kind != EXTENT_KIND_TO_TARGET, (
            "Body detection must not auto-fire from CorrelateLithoContacts (left extent)"
        )
        assert pre.extent_right_kind != EXTENT_KIND_TO_TARGET, (
            "Body detection must not auto-fire from CorrelateLithoContacts (right extent)"
        )

    # The resolver is the single authority that CREATES bodies (one per
    # connected component) and stamps litho_layer.body_id.  DetectBodies is
    # a pure extent manager over those resolver-owned bodies, so the resolver
    # must run first.
    await ResolveLithoInstances(db_session).execute(model_id=litho.id, commit=False)

    # Explicit Detect verb — writes to_target extents onto the resolver body.
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    # Both sides of the bilateral closure newly gained a to_target extent.
    assert result.bodies_created == 2, (
        f"Expected 2 sides to gain a to_target extent; got {result.bodies_created}"
    )
    assert result.bodies_removed == 0

    # The detector-set extents must land on the resolver-owned body that the
    # framed body layer (c_lens_body) was stamped with.  The body's
    # representative formation is the shallowest component member, NOT
    # necessarily f_body — so resolve via the framed layer's body_id stamp.
    framed_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_lens_body.id)
        )
    ).scalar_one()
    assert framed_body_id is not None, "Framed body layer must carry a resolver-stamped body_id"
    body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == framed_body_id))
    ).scalar_one()
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
# Test 1b: section-scoped detection closes each side to the NEAREST target
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_detect_closes_to_nearest_target_on_active_section(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """DetectBodies with an active section closes each side to the NEAREST target.

    The source unit at ``bh_src`` closes onto a single contact on THREE columns:
    two to the left (``bh_far_left``, ``bh_near_left``) and one to the right
    (``bh_right``).  Along the horizontal section line the order is
    far_left < near_left < src < right.  The left extent must land on
    ``bh_near_left`` (nearest), NOT ``bh_far_left`` — the dogfeed "every body
    draws to the most left test" bug (2026-06-03).

    ``bh_far_left`` is created FIRST so its uuid7 is the LOWEST: the old
    lowest-UUID-in-bucket selection would pick it (wrong); nearest-by-along
    picks ``bh_near_left`` (right).  Passing ``prefer_section_id`` is what
    feeds the detector the section's along-order — the whole point of the fix.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-near")
    f_top = _formation(project, parent, name="ZAND top near", soil_code="ZAND")
    f_body = _formation(project, parent, name="KLEI body near", soil_code="KLEI")
    f_base = _formation(project, parent, name="ZAND base near", soil_code="ZAND")
    f_t = _formation(project, parent, name="ZAND tgt near", soil_code="ZAND")

    # far_left created BEFORE near_left → lower uuid7 (the discriminator).
    bh_far_left = _borehole(project.id, suffix="FL", x=149000.0)
    bh_near_left = _borehole(project.id, suffix="NL", x=149900.0)
    bh_src = _borehole(project.id, suffix="SR", x=150000.0)
    bh_right = _borehole(project.id, suffix="RT", x=150100.0)

    # Horizontal section line; along = x - 148000 → FL(1000) < NL(1900) < src(2000) < RT(2100).
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="near-section",
        start_x=148000.0,
        start_y=200000.0,
        end_x=151000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=100.0,
    )

    db_session.add_all(
        [
            geo,
            litho,
            parent,
            f_top,
            f_body,
            f_base,
            f_t,
            bh_far_left,
            bh_near_left,
            bh_src,
            bh_right,
            section,
        ]
    )
    await db_session.flush()

    c_top = _contact(litho, f_top, bh_src, depth=2.0)
    c_body = _contact(litho, f_body, bh_src, depth=4.0)
    c_base = _contact(litho, f_base, bh_src, depth=6.0)
    c_fl = _contact(litho, f_t, bh_far_left, depth=3.0)
    c_nl = _contact(litho, f_t, bh_near_left, depth=3.0)
    c_rt = _contact(litho, f_t, bh_right, depth=3.0)
    db_session.add_all([c_top, c_body, c_base, c_fl, c_nl, c_rt])
    await db_session.commit()

    # The source unit (c_body..c_base) closes onto a single contact on each column.
    for target in (c_fl, c_nl, c_rt):
        await CorrelateLithoContacts(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            contact_a_id=c_body.id,
            contact_b_id=target.id,
        )
        await CorrelateLithoContacts(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            contact_a_id=c_base.id,
            contact_b_id=target.id,
        )

    await ResolveLithoInstances(db_session).execute(model_id=litho.id, commit=False)
    await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        prefer_section_id=section.id,
    )
    await db_session.commit()

    framed_body_id = (
        await db_session.execute(select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_body.id))
    ).scalar_one()
    assert framed_body_id is not None
    body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == framed_body_id))
    ).scalar_one()
    assert body.extent_left_kind == EXTENT_KIND_TO_TARGET
    assert body.extent_left_neighbour_inv_id == bh_near_left.id, (
        "left extent must close to the NEAREST left column, not the outermost"
    )
    assert body.extent_left_target_contact_id == c_nl.id
    assert body.extent_right_neighbour_inv_id == bh_right.id
    # Anchor fix (dogfeed 2026-06-03): the body's source is set to the column
    # the detector FRAMED the pinch on (bh_src), not the resolver's shallowest
    # member — so the wedge renders where it pinches instead of spanning to a
    # far-off column.
    assert body.source_investigation_id == bh_src.id, (
        "body must be anchored at the framed pinch column, not the shallowest member"
    )


# ---------------------------------------------------------------------------
# Test 2: uncorrelate breaks topology → stale to_target extents cleared
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_uncorrelate_removes_body_when_topology_breaks(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Bilateral closure → body with to_target extents; removing one side's
    edges drops the second target investigation, so the next explicit Detect
    pass CLEARS the stale to_target extents.  The resolver owns the body row
    lifecycle, so the body itself is not deleted by Detect — only its
    detector-set extents are retracted.
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

    # The framed body layer (c_body) has a resolver-owned body carrying both
    # to_target extents after the bilateral detect.  Resolve via its body_id
    # stamp (the body's representative formation may not be f_body).
    framed_body_id = (
        await db_session.execute(select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_body.id))
    ).scalar_one()
    assert framed_body_id is not None, "Framed body layer must carry a resolver-stamped body_id"
    pre_body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == framed_body_id))
    ).scalar_one()
    assert pre_body.extent_left_kind == EXTENT_KIND_TO_TARGET
    assert pre_body.extent_right_kind == EXTENT_KIND_TO_TARGET

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

    # The stale to_target extents must survive until the next explicit Detect
    # pass (Uncorrelate does not auto-fire the detector).
    interim_body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == pre_body.id))
    ).scalar_one()
    assert interim_body.extent_left_kind == EXTENT_KIND_TO_TARGET, (
        "UncorrelateLithoContacts must NOT auto-clear detector extents"
    )
    assert interim_body.extent_right_kind == EXTENT_KIND_TO_TARGET

    # Explicit Detect pass — the bilateral closure is gone, so both stale
    # to_target extents are cleared back to None.
    result = await DetectBodies(db_session).execute(project_id=project.id, model_id=litho.id)
    await db_session.commit()

    assert result.bodies_removed >= 1, (
        f"Detect must clear stale to_target extents; got {result.bodies_removed}"
    )
    post_body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == pre_body.id))
    ).scalar_one_or_none()
    assert post_body is not None, "Detect must NOT delete the resolver-owned body row"
    assert post_body.extent_left_kind is None, (
        f"Stale left to_target extent must be cleared; got {post_body.extent_left_kind!r}"
    )
    assert post_body.extent_right_kind is None, (
        f"Stale right to_target extent must be cleared; got {post_body.extent_right_kind!r}"
    )


# ---------------------------------------------------------------------------
# Test 3: unapproved edges do NOT seed to_target extents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unapproved_edges_do_not_seed_bodies(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Unapproved edges forming a bilateral topology produce no detector
    extents.  The resolver still creates one (singleton) body per accepted
    layer, but DetectBodies — which reads ``user_approved=True`` edges only —
    finds no closure, so it sets zero ``to_target`` extents.
    """
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

    # No detector extents set — the detector reads approved edges only.
    assert result.bodies_created == 0, (
        f"Unapproved edges must not seed to_target extents; "
        f"got bodies_created={result.bodies_created}"
    )
    # Whatever bodies exist are resolver-owned singletons; NONE carries a
    # detector-set to_target extent.
    body_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    for body in body_rows:
        assert body.extent_left_kind != EXTENT_KIND_TO_TARGET, (
            f"Body {body.id} must not have a to_target left extent from unapproved edges"
        )
        assert body.extent_right_kind != EXTENT_KIND_TO_TARGET, (
            f"Body {body.id} must not have a to_target right extent from unapproved edges"
        )


# ---------------------------------------------------------------------------
# Test 4: framed layer with no resolved body → closure skipped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unresolved_ordinal_logged_and_skipped(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When the framed layer has no resolver-stamped ``body_id`` (the resolver
    has not run yet), DetectBodies skips that closure and counts it in
    ``bodies_skipped_unresolved_ordinal``.  No to_target extent is written.
    """
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
    await db_session.commit()

    # Deliberately do NOT run ResolveLithoInstances, so no litho_layer carries
    # a body_id stamp.  The detector finds the bilateral closure but cannot
    # resolve its framed layer to a body → the closure is skipped.
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.bodies_skipped_unresolved_ordinal >= 1, (
        "Detector must report at least one skip when the framed layer has no "
        f"resolved body; got {result.bodies_skipped_unresolved_ordinal}"
    )
    assert result.bodies_created == 0, (
        f"Skipped closures must not set extents; got bodies_created={result.bodies_created}"
    )
    # No body carries a detector-set to_target extent (none were resolvable).
    body_rows = (
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == litho.id)))
        .scalars()
        .all()
    )
    for body in body_rows:
        assert body.extent_left_kind != EXTENT_KIND_TO_TARGET
        assert body.extent_right_kind != EXTENT_KIND_TO_TARGET


# ---------------------------------------------------------------------------
# Test 5: DetectBodies never deletes body rows (resolver owns lifecycle)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_named_body_survives_stale_topology_reconcile(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """DetectBodies is a pure extent manager — it never deletes body rows
    (the resolver owns the body lifecycle).  A named body whose topology no
    longer qualifies survives a Detect pass against an empty edge graph; its
    extents (none) are untouched and the row persists.
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

    # Run detector against an empty edge graph — no candidate fires.  Detect
    # does not delete body rows, and the named row has no to_target extent to
    # clear, so nothing changes.
    result = await DetectBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    await db_session.commit()

    assert result.bodies_removed == 0, (
        f"DetectBodies must not clear/remove the named body; "
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

    # First detect pass — both extents land as 'to_target' on the resolver-
    # owned body for the framed body formation.
    await DetectBodies(db_session).execute(project_id=project.id, model_id=litho.id)
    await db_session.commit()

    framed_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_lens_body.id)
        )
    ).scalar_one()
    assert framed_body_id is not None, "Framed body layer must carry a resolver-stamped body_id"
    body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == framed_body_id))
    ).scalar_one()
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

    # The user-claimed extent must NOT be cleared by the reconcile step.
    assert result.bodies_removed == 0, (
        "Body with user-claimed extent must not have its extents cleared; "
        f"got bodies_removed={result.bodies_removed}"
    )

    updated = (await db_session.execute(select(BodyOrm).where(BodyOrm.id == body.id))).scalar_one()

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

    # Each of the n_bodies bilateral bodies gains a to_target extent on BOTH
    # sides, so the "extents set" count is 2 per body.
    assert result.bodies_created == 2 * n_bodies, (
        f"Expected {2 * n_bodies} sides to gain a to_target extent; got {result.bodies_created}"
    )
    assert len(body_selects) == 1, (
        f"E1 regression: DetectBodies must issue exactly 1 body-table SELECT "
        f"(the bulk pre-fetch); got {len(body_selects)}.\n"
        f"Statements observed:\n" + "\n---\n".join(body_selects)
    )
