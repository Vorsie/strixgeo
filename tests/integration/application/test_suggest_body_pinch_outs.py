"""Integration tests for SuggestBodyPinchOuts.

Coverage:
1. Body with NO correlations on either side → emits 2 candidates
   (one left, one right) when adjacent investigations exist on both sides.
2. Body with bilateral closure (both sides paired via approved edges) →
   no candidates emitted.
3. Body with user-claimed left extent (pinch_out_halfway) + uncorrelated
   right → only the right-side candidate is emitted.
3b. A claimed/detector-set extent on ONE body suppresses only THAT body's
   same-side candidate — a different same-formation instance (distinct body)
   is reasoned about independently (per-instance keying via
   ``litho_layer.body_id``).
4. Source pair on the leftmost investigation (no neighbour to the left
   in UUID order) → no left-side candidate; right-side candidate emitted
   when uncorrelated.
5. NO persistence side effects — no new BodyOrm rows exist after the call.
10. A named (or extent-claimed) instance does NOT suppress its sibling
   same-formation instance's candidates — the regression this task fixes.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.suggest_body_pinch_outs import SuggestBodyPinchOuts
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
    EXTENT_KIND_OPEN,
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
        project_id="SBPO",
        test_id=f"BH-SBPO-{suffix}",
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
        name="Geo-SBPO",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-SBPO",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )


def _geo_parent(project: ProjectOrm, *, name: str) -> GeologicalFormationOrm:
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


def _approved_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved approved LithoContactCorrelationEdgeOrm."""
    # Canonical ordering: smaller UUID first.
    a_id = min(ca.id, cb.id)
    b_id = max(ca.id, cb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=True,
    )


async def _stamp_layer_body(
    db_session: AsyncSession,
    *,
    layer_contact: FormationContactOrm,
    body: BodyOrm,
) -> None:
    """Stamp ``litho_layer.body_id`` for the layer framed by ``layer_contact``.

    Post-A4 the litho layer's id equals its top formation_contact id (the
    FC↔LL mirror preserves the UUID), so the framed layer's id IS
    ``layer_contact.id``.  The suggester resolves a candidate's body from
    that layer's ``body_id`` (per-instance keying), so a test that wants a
    pre-existing body to bind to a candidate must stamp the backlink the
    same way ``ResolveLithoInstances`` would.

    Parameters
    ----------
    db_session : AsyncSession
        Active session (the caller commits).
    layer_contact : FormationContactOrm
        The top contact of the framed unit (id == litho_layer.id).
    body : BodyOrm
        The body row to bind the layer to.
    """
    await db_session.execute(
        update(LithoLayerOrm).where(LithoLayerOrm.id == layer_contact.id).values(body_id=body.id)
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for SuggestBodyPinchOuts tests."""
    proj = ProjectOrm(id=uuid7(), name="suggest body pinch-outs test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: body with NO correlations → 2 candidates (left + right)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_correlations_emits_left_and_right_candidates(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A source pair with zero approved edges on both sides, flanked by an
    investigation to the left and one to the right (in UUID order), must
    produce exactly two PinchOutCandidates — one for each side.

    Topology (UUID order: bh_left < bh_source < bh_right):
      bh_source: c_top (depth=2, f_body) + c_base (depth=6, f_below)
      bh_left:   one contact only (no edges to bh_source)
      bh_right:  one contact only (no edges to bh_source)
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t1")
    f_body = _formation(project, parent, name="KLEI-SBPO-t1-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t1-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t1-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    # Three boreholes: left, source, right — no constraint on UUID order
    # (uuid7() is time-ordered; creating them in sequence is fine here).
    bh_left = _borehole(project.id, suffix="T1-L", x=160000.0)
    bh_source = _borehole(project.id, suffix="T1-S", x=160500.0)
    bh_right = _borehole(project.id, suffix="T1-R", x=161000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    # Source pair: depth-adjacent contacts on bh_source.
    c_top = _contact(litho, f_body, bh_source, depth=2.0)
    c_base = _contact(litho, f_below, bh_source, depth=6.0)
    # Flanking investigations each carry one contact so they participate
    # in the model.
    c_left = _contact(litho, f_other, bh_left, depth=3.0)
    c_right = _contact(litho, f_other, bh_right, depth=3.0)
    db_session.add_all([c_top, c_base, c_left, c_right])
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # Exactly two candidates — one per uncorrelated side.
    source_candidates = [c for c in candidates if c.source_investigation_id == bh_source.id]
    assert len(source_candidates) == 2, (
        f"Expected 2 candidates for bh_source, got {len(source_candidates)}: {source_candidates}"
    )

    sides = {c.side for c in source_candidates}
    assert sides == {"left", "right"}

    left_cand = next(c for c in source_candidates if c.side == "left")
    right_cand = next(c for c in source_candidates if c.side == "right")

    # Source pair fields are populated correctly.
    assert left_cand.above_contact_id == c_top.id
    assert left_cand.below_contact_id == c_base.id
    assert right_cand.above_contact_id == c_top.id
    assert right_cand.below_contact_id == c_base.id

    # No body row pre-existed — body_id must be None.
    assert left_cand.body_id is None
    assert right_cand.body_id is None

    # Neighbours must be the flanking investigations.
    # Left candidate → nearest lower-UUID investigation.
    assert left_cand.suggested_neighbour_investigation_id in {bh_left.id, bh_right.id}
    assert right_cand.suggested_neighbour_investigation_id in {bh_left.id, bh_right.id}
    # The left neighbour must be a different investigation than the right neighbour.
    assert (
        left_cand.suggested_neighbour_investigation_id
        != right_cand.suggested_neighbour_investigation_id
    )


# ---------------------------------------------------------------------------
# Test 2: bilateral closure (both sides paired) → no candidates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bilateral_closure_emits_no_candidates(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When a source pair already has approved edges linking both above and
    below contacts to a neighbour on each side, SuggestBodyPinchOuts must
    emit zero candidates for that source pair.

    Topology:
      bh_source: c_top (f_body) + c_base (f_below)
      bh_left:   c_left_top (f_body) + c_left_base (f_below)
      bh_right:  c_right_top (f_body) + c_right_base (f_below)
      Edges: c_top↔c_left_top, c_base↔c_left_base  (left closure)
             c_top↔c_right_top, c_base↔c_right_base (right closure)
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t2")
    f_body = _formation(project, parent, name="KLEI-SBPO-t2-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t2-below", ordinal=1)
    db_session.add_all([geo, litho, parent, f_body, f_below])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T2-L", x=162000.0)
    bh_source = _borehole(project.id, suffix="T2-S", x=162500.0)
    bh_right = _borehole(project.id, suffix="T2-R", x=163000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    c_top = _contact(litho, f_body, bh_source, depth=2.0)
    c_base = _contact(litho, f_below, bh_source, depth=6.0)
    c_left_top = _contact(litho, f_body, bh_left, depth=2.5)
    c_left_base = _contact(litho, f_below, bh_left, depth=5.5)
    c_right_top = _contact(litho, f_body, bh_right, depth=1.8)
    c_right_base = _contact(litho, f_below, bh_right, depth=6.2)
    db_session.add_all([c_top, c_base, c_left_top, c_left_base, c_right_top, c_right_base])
    await db_session.flush()

    # Bilateral closure: both contacts correlated to left AND to right.
    e1 = _approved_edge(litho, c_top, c_left_top)
    e2 = _approved_edge(litho, c_base, c_left_base)
    e3 = _approved_edge(litho, c_top, c_right_top)
    e4 = _approved_edge(litho, c_base, c_right_base)
    db_session.add_all([e1, e2, e3, e4])
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # bh_source's pair is fully paired — no candidates from it.
    source_candidates = [c for c in candidates if c.source_investigation_id == bh_source.id]
    assert source_candidates == [], (
        f"Expected 0 candidates for bilaterally-closed bh_source, got {source_candidates}"
    )


# ---------------------------------------------------------------------------
# Test 3: user-claimed left extent + uncorrelated right → right-side only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_claimed_left_uncorrelated_right_emits_right_only(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When an existing body row already carries a user-claimed left extent
    (pinch_out_halfway) and the right side has no approved correlations,
    only the right-side candidate is emitted — the left side is skipped
    because it is already settled by the user claim.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t3")
    f_body = _formation(project, parent, name="KLEI-SBPO-t3-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t3-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t3-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T3-L", x=164000.0)
    bh_source = _borehole(project.id, suffix="T3-S", x=164500.0)
    bh_right = _borehole(project.id, suffix="T3-R", x=165000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    c_top = _contact(litho, f_body, bh_source, depth=3.0)
    c_base = _contact(litho, f_below, bh_source, depth=7.0)
    # Flanking investigations need at least one contact to participate.
    c_left = _contact(litho, f_other, bh_left, depth=4.0)
    c_right = _contact(litho, f_other, bh_right, depth=4.0)
    db_session.add_all([c_top, c_base, c_left, c_right])
    await db_session.flush()

    # Pre-create a body row with left extent already user-claimed.
    # source_investigation_id = bh_source, formation_id = f_body.
    existing_body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=f_body.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        extent_left_neighbour_inv_id=bh_left.id,
    )
    db_session.add(existing_body)
    await db_session.flush()
    # Bind the framed layer (top contact c_top → litho_layer with the same id)
    # to the body, the way ResolveLithoInstances would — the suggester resolves
    # the candidate's body per-layer, not per-formation.
    await _stamp_layer_body(db_session, layer_contact=c_top, body=existing_body)
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    source_candidates = [c for c in candidates if c.source_investigation_id == bh_source.id]
    # Only the right-side candidate should be emitted.
    assert len(source_candidates) == 1, (
        f"Expected 1 candidate (right only), got {len(source_candidates)}: {source_candidates}"
    )
    cand = source_candidates[0]
    assert cand.side == "right", f"Expected side='right', got {cand.side!r}"
    # body_id must link to the pre-existing body row.
    assert cand.body_id == existing_body.id
    # Suggested neighbour must be the right-side investigation.
    assert cand.suggested_neighbour_investigation_id == bh_right.id


# ---------------------------------------------------------------------------
# Test 3b: a detector-set to_target extent on ONE body suppresses only THAT
#          body's same-side candidate — a different same-formation instance
#          (distinct body) is reasoned about independently (per-instance keying).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_claimed_body_suppresses_only_its_own_instance_candidate(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Per-instance suppression by a USER-CLAIMED extent.

    Two UNCORRELATED investigations (bh_a, bh_b) each frame formation
    ``f_body`` over ``f_below`` — same formation pair, but two DISTINCT
    instances (the resolver gives each its own ``body`` row with a distinct
    ``body_ordinal``).  bh_a's body LEFT side carries a USER-CLAIMED ``open``
    extent.

    Per-instance keying means: bh_a's left candidate is suppressed (its own
    body's left is a committed user claim), but bh_b's left candidate is STILL
    emitted — bh_b is a different instance with its own un-claimed body.  The
    old ``(formation, instance_ordinal)`` key collapsed both onto one body and
    would have over-suppressed bh_b.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t3b")
    f_body = _formation(project, parent, name="KLEI-SBPO-t3b-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t3b-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t3b-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    # Along/UUID order: bh_left < bh_a < bh_b (uuid7 is time-ordered).  Both
    # bh_a and bh_b have a left neighbour, so each could emit a left candidate.
    bh_left = _borehole(project.id, suffix="T3B-L", x=170000.0)
    bh_a = _borehole(project.id, suffix="T3B-A", x=170500.0)
    bh_b = _borehole(project.id, suffix="T3B-B", x=171000.0)
    db_session.add_all([bh_left, bh_a, bh_b])
    await db_session.flush()

    # bh_left only participates (single contact → frames nothing itself).
    c_left = _contact(litho, f_other, bh_left, depth=4.0)
    # Both bh_a and bh_b frame f_body over f_below — same formation pair, but
    # UNCORRELATED, so the resolver makes two distinct instances/bodies.
    c_a_top = _contact(litho, f_body, bh_a, depth=3.0)
    c_a_base = _contact(litho, f_below, bh_a, depth=7.0)
    c_b_top = _contact(litho, f_body, bh_b, depth=3.0)
    c_b_base = _contact(litho, f_below, bh_b, depth=7.0)
    db_session.add_all([c_left, c_a_top, c_a_base, c_b_top, c_b_base])
    await db_session.commit()

    # Resolve instances → one body per connected component (each uncorrelated
    # layer is its own component → distinct bodies, distinct body_id stamps).
    await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    # Find bh_a's body via its framed layer's stamped body_id.
    a_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_a_top.id)
        )
    ).scalar_one()
    b_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_b_top.id)
        )
    ).scalar_one()
    assert a_body_id is not None and b_body_id is not None
    assert a_body_id != b_body_id, "bh_a and bh_b must resolve to DISTINCT bodies"

    # bh_a's body LEFT side carries a USER-CLAIMED open extent (a committed
    # decision — unlike a detector to_target, this DOES suppress the side).
    await db_session.execute(
        update(BodyOrm).where(BodyOrm.id == a_body_id).values(extent_left_kind=EXTENT_KIND_OPEN)
    )
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # bh_a's left is user-claimed → suppressed.
    bh_a_left = [c for c in candidates if c.source_investigation_id == bh_a.id and c.side == "left"]
    assert bh_a_left == [], (
        f"Expected NO left candidate for bh_a (its own body's left is "
        f"user-claimed), got {bh_a_left}"
    )

    # bh_b is a DIFFERENT instance with an un-claimed body → its left candidate
    # is still emitted.  The old formation-key would have wrongly suppressed it.
    bh_b_left = [c for c in candidates if c.source_investigation_id == bh_b.id and c.side == "left"]
    assert len(bh_b_left) == 1, (
        f"Expected bh_b's left candidate to STILL be emitted (distinct "
        f"instance, un-claimed body), got {bh_b_left}"
    )
    assert bh_b_left[0].body_id == b_body_id


@pytest.mark.asyncio
async def test_detector_to_target_does_not_suppress_suggestion(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A detector ``to_target`` extent is a guess, not a committed claim, so it
    must NOT suppress the suggestion on that side — the user has to be able to
    override it with an open / pinch-out (dogfeed 2026-06-03: a detected sand
    lens blocked its own open-end suggestions).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-tt")
    f_body = _formation(project, parent, name="ZAND-SBPO-tt-body", ordinal=0)
    f_below = _formation(project, parent, name="KLEI-SBPO-tt-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-tt-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    # bh_left < bh_a in UUID order → bh_a has a left neighbour to pinch toward.
    bh_left = _borehole(project.id, suffix="TT-L", x=180000.0)
    bh_a = _borehole(project.id, suffix="TT-A", x=180500.0)
    db_session.add_all([bh_left, bh_a])
    await db_session.flush()

    c_left = _contact(litho, f_other, bh_left, depth=4.0)
    c_a_top = _contact(litho, f_body, bh_a, depth=3.0)
    c_a_base = _contact(litho, f_below, bh_a, depth=7.0)
    db_session.add_all([c_left, c_a_top, c_a_base])
    await db_session.commit()

    await ResolveLithoInstances(db_session).execute(model_id=litho.id)
    a_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_a_top.id)
        )
    ).scalar_one()

    # Detector sets a to_target on bh_a's left (a guess).
    await db_session.execute(
        update(BodyOrm)
        .where(BodyOrm.id == a_body_id)
        .values(extent_left_kind=EXTENT_KIND_TO_TARGET, extent_left_target_contact_id=c_left.id)
    )
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id, model_id=litho.id
    )

    # The to_target side is STILL offered — the user can override the guess.
    bh_a_left = [c for c in candidates if c.source_investigation_id == bh_a.id and c.side == "left"]
    assert len(bh_a_left) >= 1, (
        f"a detector to_target must NOT suppress its own suggestion, got {bh_a_left}"
    )


# ---------------------------------------------------------------------------
# Test 4: leftmost investigation → no left candidate, right candidate emitted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_leftmost_investigation_no_left_candidate(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """The leftmost investigation in UUID order has no lower-UUID neighbour,
    so no left-side candidate can be emitted even when the source pair has
    zero left correlations. The right-side candidate is still emitted when
    uncorrelated.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t4")
    f_body = _formation(project, parent, name="KLEI-SBPO-t4-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t4-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t4-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    # Create bh_right first so it gets a lower uuid7() timestamp → lower UUID.
    # Then create bh_source so it definitely has a higher UUID.
    # uuid7() is time-ordered; a slight delay isn't needed — they're distinct
    # and the test only cares that bh_source is the leftmost (smallest UUID)
    # among the two participants, so we capture both ids after creation.
    bh_source = _borehole(project.id, suffix="T4-S", x=166000.0)
    bh_right = _borehole(project.id, suffix="T4-R", x=166500.0)
    db_session.add_all([bh_source, bh_right])
    await db_session.flush()

    # Ensure bh_source is the "leftmost" investigation (smallest UUID).
    # If uuid7() happened to create them out of order, swap conceptually;
    # the test logic will still work because we check relative to bh_source.
    # We rely on the fact that the test only uses two investigations and
    # asserts that the leftmost has no left candidate — regardless of which
    # one is actually smallest, only one of them can have no left neighbour.
    all_inv_ids = sorted([bh_source.id, bh_right.id])
    leftmost_id = all_inv_ids[0]
    rightmost_id = all_inv_ids[1]

    # Resolve which BoreholeOrm is the leftmost participant.
    leftmost_bh = bh_source if bh_source.id == leftmost_id else bh_right
    rightmost_bh = bh_right if bh_right.id == rightmost_id else bh_source

    # Source pair on the leftmost investigation.
    c_top = _contact(litho, f_body, leftmost_bh, depth=2.0)
    c_base = _contact(litho, f_below, leftmost_bh, depth=5.0)
    # Rightmost investigation participates via one contact.
    c_right = _contact(litho, f_other, rightmost_bh, depth=3.0)
    db_session.add_all([c_top, c_base, c_right])
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    leftmost_candidates = [c for c in candidates if c.source_investigation_id == leftmost_id]

    # No left candidate (no lower-UUID neighbour exists).
    left_candidates = [c for c in leftmost_candidates if c.side == "left"]
    assert left_candidates == [], (
        f"Expected no left-side candidate for leftmost investigation, got {left_candidates}"
    )

    # Right candidate IS emitted (uncorrelated right side, right neighbour exists).
    right_candidates = [c for c in leftmost_candidates if c.side == "right"]
    assert len(right_candidates) == 1, (
        f"Expected 1 right-side candidate for leftmost investigation, got {len(right_candidates)}"
    )
    assert right_candidates[0].suggested_neighbour_investigation_id == rightmost_id


# ---------------------------------------------------------------------------
# Test 5: no persistence side effects
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_persistence_side_effects(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """SuggestBodyPinchOuts must not create, update, or delete any BodyOrm rows.
    The body table must contain exactly the same rows before and after the call.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t5")
    f_body = _formation(project, parent, name="KLEI-SBPO-t5-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t5-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t5-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    bh_source = _borehole(project.id, suffix="T5-S", x=167000.0)
    bh_neighbour = _borehole(project.id, suffix="T5-N", x=167500.0)
    db_session.add_all([bh_source, bh_neighbour])
    await db_session.flush()

    c_top = _contact(litho, f_body, bh_source, depth=1.0)
    c_base = _contact(litho, f_below, bh_source, depth=4.0)
    c_n = _contact(litho, f_other, bh_neighbour, depth=2.0)
    db_session.add_all([c_top, c_base, c_n])
    await db_session.commit()

    # Count body rows in the model before the call.
    count_before = (
        await db_session.execute(
            select(func.count()).select_from(BodyOrm).where(BodyOrm.model_id == litho.id)
        )
    ).scalar_one()

    # Run the suggest pass — must produce at least one candidate but no DB writes.
    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # Candidates were produced (sanity-check that the pass ran).
    assert len(candidates) > 0, "Expected at least one candidate — test setup may be wrong"

    # Count body rows after the call — must be unchanged.
    count_after = (
        await db_session.execute(
            select(func.count()).select_from(BodyOrm).where(BodyOrm.model_id == litho.id)
        )
    ).scalar_one()

    assert count_after == count_before, (
        f"SuggestBodyPinchOuts wrote {count_after - count_before} unexpected BodyOrm row(s)"
    )


# ---------------------------------------------------------------------------
# Section-along-order adjacency (dogfeed 2026-06-01)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_section_along_order_picks_adjacent_column_not_uuid_neighbour(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """With a section, the suggested neighbour is the along-section-adjacent
    column — not the UUID-adjacent one.

    The pinch-out suggest used to pick the neighbour by UUID ordering, which is
    unrelated to where columns sit on the section, so it visibly "skipped" the
    intervening column. Setup forces the two orders to disagree:

        UUID order:  source < far < mid
        Section (x): source < mid  < far

    so the source's right neighbour is ``mid`` on the section but ``far`` by UUID.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-sec")
    f_body = _formation(project, parent, name="KLEI-SBPO-sec-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-sec-below", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-sec-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_body, f_below, f_other])
    await db_session.flush()

    bh_source = _borehole(project.id, suffix="SEC-S", x=150000.0)
    bh_far = _borehole(project.id, suffix="SEC-F", x=150100.0)
    bh_mid = _borehole(project.id, suffix="SEC-M", x=150050.0)
    # Force UUID order source < far < mid (≠ along/x order source < mid < far).
    bh_source.id = UUID(int=0x10)
    bh_far.id = UUID(int=0x20)
    bh_mid.id = UUID(int=0x30)
    db_session.add_all([bh_source, bh_far, bh_mid])
    await db_session.flush()

    c_top = _contact(litho, f_body, bh_source, depth=2.0)
    c_base = _contact(litho, f_below, bh_source, depth=6.0)
    c_far = _contact(litho, f_other, bh_far, depth=3.0)
    c_mid = _contact(litho, f_other, bh_mid, depth=3.0)
    db_session.add_all([c_top, c_base, c_far, c_mid])

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="SEC",
        description=None,
        start_x=149900.0,
        start_y=200000.0,
        end_x=150200.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )
    db_session.add(section)
    await db_session.commit()

    # With the section → along-adjacent neighbour (mid).
    sec_candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id, model_id=litho.id, section_id=section.id
    )
    right = next(
        c for c in sec_candidates if c.source_investigation_id == bh_source.id and c.side == "right"
    )
    assert right.kind == "pinch_out_halfway"
    assert right.suggested_neighbour_investigation_id == bh_mid.id

    # bh_source is the section's LEFT edge — no data beyond it, so its left
    # side gets an OPEN candidate (kind='open', no neighbour).
    left_open = next(
        c for c in sec_candidates if c.source_investigation_id == bh_source.id and c.side == "left"
    )
    assert left_open.kind == "open"
    assert left_open.suggested_neighbour_investigation_id is None

    # Without the section → the UUID-adjacent neighbour (far) — the old behaviour.
    nosec_candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id, model_id=litho.id
    )
    right_nosec = next(
        c
        for c in nosec_candidates
        if c.source_investigation_id == bh_source.id and c.side == "right"
    )
    assert right_nosec.suggested_neighbour_investigation_id == bh_far.id


# ---------------------------------------------------------------------------
# Test 6: enclosed lens (SAND·SILT·SAND) → only the silt is suggested
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_enclosed_lens_suppresses_host_half_candidates(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A source stack of SAND·SILT·SAND·CLAY where both sands share one
    formation must suggest a pinch-out for the silt lens ONLY — never for
    the upper or lower sand half (they are one continuous host wrapping the
    lens).

    Topology on bh_source (depth → formation):
      2.0  c_sand_top  (f_sand)   ┐ upper sand  (host half — suppressed)
      4.0  c_silt      (f_silt)   ┤ SILT lens   (suggested)
      6.0  c_sand_low  (f_sand)   ┤ lower sand  (host half — suppressed)
      10.0 c_clay      (f_clay)   ┘ base
    bh_left / bh_right each carry one (uncorrelated) contact so the silt
    has a neighbour on each side.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t6")
    # Both sand halves reference ONE formation row (same find-or-create key).
    f_sand = _formation(project, parent, name="ZAND-SBPO-t6", soil_code="ZAND", ordinal=0)
    f_silt = _formation(project, parent, name="SILT-SBPO-t6", soil_code="SILT", ordinal=1)
    f_clay = _formation(project, parent, name="KLEI-SBPO-t6", soil_code="KLEI", ordinal=2)
    f_flank = _formation(project, parent, name="VEEN-SBPO-t6", soil_code="VEEN", ordinal=3)
    db_session.add_all([geo, litho, parent, f_sand, f_silt, f_clay, f_flank])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T6-L", x=170000.0)
    bh_source = _borehole(project.id, suffix="T6-S", x=170500.0)
    bh_right = _borehole(project.id, suffix="T6-R", x=171000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    c_sand_top = _contact(litho, f_sand, bh_source, depth=2.0)
    c_silt = _contact(litho, f_silt, bh_source, depth=4.0)
    c_sand_low = _contact(litho, f_sand, bh_source, depth=6.0)
    c_clay = _contact(litho, f_clay, bh_source, depth=10.0)
    c_left = _contact(litho, f_flank, bh_left, depth=3.0)
    c_right = _contact(litho, f_flank, bh_right, depth=3.0)
    db_session.add_all([c_sand_top, c_silt, c_sand_low, c_clay, c_left, c_right])
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    source_candidates = [c for c in candidates if c.source_investigation_id == bh_source.id]

    # Every emitted candidate is for the SILT lens unit (its top contact is
    # c_silt); the two sand halves are suppressed.
    above_ids = {c.above_contact_id for c in source_candidates}
    assert above_ids == {c_silt.id}, (
        f"Expected only the silt unit suggested, got above-contacts: {above_ids}"
    )
    assert c_sand_top.id not in above_ids
    assert c_sand_low.id not in above_ids
    # The silt lens still emits (it is the real pinch-out), and its base is
    # the lower sand's top contact.
    assert len(source_candidates) == 2, (
        f"Expected left + right candidate for the silt lens, got "
        f"{len(source_candidates)}: {source_candidates}"
    )
    assert all(c.below_contact_id == c_sand_low.id for c in source_candidates)


# ---------------------------------------------------------------------------
# Test 7: non-lens stack (all neighbours distinct) → units still emit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_lens_stack_still_emits_candidates(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Regression: a stack whose interior units have DISTINCT formations
    above and below (no same-formation bracket) is not a lens — the
    lens-aware suppression must NOT fire, so every interior unit still
    emits its pinch-out candidate.

    Topology on bh_source (depth → formation, all four distinct):
      2.0  c_clay_top (f_clay)  ┐ clay unit  (emits)
      4.0  c_sand     (f_sand)  ┤ sand unit  (emits)
      6.0  c_silt     (f_silt)  ┤ silt unit  (emits)
      10.0 c_base     (f_base)  ┘ base (deepest — frames no unit)
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t7")
    f_clay = _formation(project, parent, name="KLEI-SBPO-t7", soil_code="KLEI", ordinal=0)
    f_sand = _formation(project, parent, name="ZAND-SBPO-t7", soil_code="ZAND", ordinal=1)
    f_silt = _formation(project, parent, name="SILT-SBPO-t7", soil_code="SILT", ordinal=2)
    f_base = _formation(project, parent, name="VEEN-SBPO-t7", soil_code="VEEN", ordinal=3)
    f_flank = _formation(project, parent, name="GRIND-SBPO-t7", soil_code="GRIND", ordinal=4)
    db_session.add_all([geo, litho, parent, f_clay, f_sand, f_silt, f_base, f_flank])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T7-L", x=180000.0)
    bh_source = _borehole(project.id, suffix="T7-S", x=180500.0)
    bh_right = _borehole(project.id, suffix="T7-R", x=181000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    c_clay_top = _contact(litho, f_clay, bh_source, depth=2.0)
    c_sand = _contact(litho, f_sand, bh_source, depth=4.0)
    c_silt = _contact(litho, f_silt, bh_source, depth=6.0)
    c_base = _contact(litho, f_base, bh_source, depth=10.0)
    c_left = _contact(litho, f_flank, bh_left, depth=3.0)
    c_right = _contact(litho, f_flank, bh_right, depth=3.0)
    db_session.add_all([c_clay_top, c_sand, c_silt, c_base, c_left, c_right])
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    source_candidates = [c for c in candidates if c.source_investigation_id == bh_source.id]
    above_ids = {c.above_contact_id for c in source_candidates}

    # No same-formation bracket → no suppression → all three interior units
    # (clay, sand, silt) still surface as candidates; the deepest base
    # contact frames no unit and is correctly absent.
    assert above_ids == {c_clay_top.id, c_sand.id, c_silt.id}, (
        f"Non-lens units must not be suppressed; got above-contacts: {above_ids}"
    )


# ---------------------------------------------------------------------------
# Test 8: deepest-formation open candidate at the leftmost edge
# (dogfeed 2026-06-02)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deepest_formation_open_candidate_at_leftmost_edge(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """The deepest formation on a section-edge investigation has no base
    contact, so the framed-unit loop never emits for it.  When the
    investigation is at the LEFT edge of the section (no neighbour to the
    left), a ``kind='open'`` candidate with ``below_contact_id=None`` and
    ``below_depth_m`` equal to the borehole's ``total_depth_m`` must be
    emitted for it.

    Topology (along-section order: bh_left < bh_mid < bh_right):
      bh_left:  c_top  (depth=2, f_top)   ← framed unit above deepest
                c_deep (depth=8, f_deep)   ← DEEPEST formation, no base contact
      bh_mid:   c_other (depth=3, f_other) ← interior test, has a right neighbour
      bh_right: c_other2 (depth=3, f_other)

    Expected:
    - bh_left is leftmost → deepest open candidate side='left' is emitted.
    - bh_left also has a right neighbour (bh_mid) → no deepest open right candidate.
    - bh_mid is interior → no deepest open left or right candidate.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t8")
    f_top = _formation(project, parent, name="KLEI-SBPO-t8-top", ordinal=0)
    f_deep = _formation(project, parent, name="ZAND-SBPO-t8-deep", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t8-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_top, f_deep, f_other])
    await db_session.flush()

    # Place boreholes so x order == along order (section runs W→E).
    bh_left = _borehole(project.id, suffix="T8-L", x=190000.0)
    bh_mid = _borehole(project.id, suffix="T8-M", x=190500.0)
    bh_right = _borehole(project.id, suffix="T8-R", x=191000.0)
    # Give bh_left a known total_depth_m so we can assert against it.
    bh_left.total_depth_m = 25.0
    db_session.add_all([bh_left, bh_mid, bh_right])
    await db_session.flush()

    # bh_left stack: two contacts — f_top (framed unit) + f_deep (deepest).
    c_top = _contact(litho, f_top, bh_left, depth=2.0)
    c_deep = _contact(litho, f_deep, bh_left, depth=8.0)
    # bh_mid and bh_right carry one contact each so they are model participants.
    c_mid = _contact(litho, f_other, bh_mid, depth=3.0)
    c_right_c = _contact(litho, f_other, bh_right, depth=3.0)
    db_session.add_all([c_top, c_deep, c_mid, c_right_c])

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="T8-SEC",
        description=None,
        start_x=189900.0,
        start_y=200000.0,
        end_x=191100.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )
    db_session.add(section)
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=section.id,
    )

    # Filter to candidates whose above_contact is the DEEPEST contact on bh_left.
    deepest_cands = [
        c
        for c in candidates
        if c.source_investigation_id == bh_left.id and c.above_contact_id == c_deep.id
    ]

    # Exactly one deepest-open candidate: the left edge side only.
    # bh_left has a right neighbour (bh_mid) so no right-open candidate.
    assert len(deepest_cands) == 1, (
        f"Expected 1 deepest-open candidate for bh_left, got {len(deepest_cands)}: {deepest_cands}"
    )
    cand = deepest_cands[0]
    assert cand.side == "left", f"Expected side='left', got {cand.side!r}"
    assert cand.kind == "open", f"Expected kind='open', got {cand.kind!r}"
    # No base contact — the substrate extends to the bottom of the hole.
    assert cand.below_contact_id is None, (
        f"Expected below_contact_id=None for deepest-open, got {cand.below_contact_id}"
    )
    # Bottom depth must match the borehole's total_depth_m.
    assert cand.below_depth_m == 25.0, f"Expected below_depth_m=25.0, got {cand.below_depth_m}"
    assert cand.above_contact_id == c_deep.id


# ---------------------------------------------------------------------------
# Test 9: interior investigation — no deepest-open candidate
# (dogfeed 2026-06-02)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deepest_formation_no_open_candidate_at_interior_test(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """An interior investigation (neighbours on both sides) must NOT receive
    a deepest-formation open candidate — the substrate is bounded by data
    on both sides, so it is not an open edge.

    Topology (along-section order: bh_left < bh_mid < bh_right):
      All three boreholes are model participants.
      bh_mid is interior → no left or right deepest-open candidate.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t9")
    f_top = _formation(project, parent, name="KLEI-SBPO-t9-top", ordinal=0)
    f_deep = _formation(project, parent, name="ZAND-SBPO-t9-deep", ordinal=1)
    f_other = _formation(project, parent, name="SILT-SBPO-t9-other", ordinal=2)
    db_session.add_all([geo, litho, parent, f_top, f_deep, f_other])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T9-L", x=192000.0)
    bh_mid = _borehole(project.id, suffix="T9-M", x=192500.0)
    bh_right = _borehole(project.id, suffix="T9-R", x=193000.0)
    bh_mid.total_depth_m = 30.0
    db_session.add_all([bh_left, bh_mid, bh_right])
    await db_session.flush()

    # bh_mid stack: two contacts — f_top (framed) + f_deep (deepest).
    c_top_mid = _contact(litho, f_top, bh_mid, depth=2.0)
    c_deep_mid = _contact(litho, f_deep, bh_mid, depth=9.0)
    # Flanking boreholes carry one contact each.
    c_left_c = _contact(litho, f_other, bh_left, depth=3.0)
    c_right_c = _contact(litho, f_other, bh_right, depth=3.0)
    db_session.add_all([c_top_mid, c_deep_mid, c_left_c, c_right_c])

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="T9-SEC",
        description=None,
        start_x=191900.0,
        start_y=200000.0,
        end_x=193100.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )
    db_session.add(section)
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=section.id,
    )

    # No deepest-open candidate should exist for bh_mid — it has neighbours
    # on both sides, so its deepest formation is not an edge substrate.
    deepest_open_mid = [
        c
        for c in candidates
        if c.source_investigation_id == bh_mid.id
        and c.above_contact_id == c_deep_mid.id
        and c.below_contact_id is None
    ]
    assert deepest_open_mid == [], (
        f"Interior bh_mid must not receive a deepest-open candidate; got: {deepest_open_mid}"
    )


# ---------------------------------------------------------------------------
# Test 9b: open ends fire only at the section's first/last in-corridor TEST,
# not the last litho PARTICIPANT (dogfeed 2026-06-03)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_open_only_at_section_terminal_test_not_last_participant(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """An ``open`` end may only occur on the left side of the section's FIRST
    test or the right side of its LAST test.  A test that sits on the section
    but has no litho contacts in this model yet (a bare column the user still
    sees) must NOT be treated as "beyond the edge": the adjacent participant's
    un-correlated unit pinches out TOWARD that bare test, it does not open
    against it.

    Topology (along-section W→E, all at y=200000):
      bh_bare_left  (x=200000): ON the section, ZERO litho contacts.
      bh_source     (x=200500): c_top (f_body, 2) + c_base (f_below, 6) —
                                 the only litho participant, frames one unit.
      bh_bare_right (x=201000): ON the section, ZERO litho contacts.

    bh_source is the only participant, but it is INTERIOR on the section
    (bare tests flank it on both sides).  Both of its sides must therefore be
    ``pinch_out_halfway`` toward the bare neighbours; NEITHER side may be
    ``open`` — there is a section test beyond it in each direction.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t9b")
    f_body = _formation(project, parent, name="KLEI-SBPO-t9b-body", ordinal=0)
    f_below = _formation(project, parent, name="ZAND-SBPO-t9b-below", ordinal=1)
    db_session.add_all([geo, litho, parent, f_body, f_below])
    await db_session.flush()

    bh_bare_left = _borehole(project.id, suffix="T9B-BL", x=200000.0)
    bh_source = _borehole(project.id, suffix="T9B-S", x=200500.0)
    bh_bare_right = _borehole(project.id, suffix="T9B-BR", x=201000.0)
    db_session.add_all([bh_bare_left, bh_source, bh_bare_right])
    await db_session.flush()

    # Only bh_source carries litho contacts — the bare flanks have none, but
    # they are in-corridor tests on the section.
    c_top = _contact(litho, f_body, bh_source, depth=2.0)
    c_base = _contact(litho, f_below, bh_source, depth=6.0)
    db_session.add_all([c_top, c_base])

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="T9B-SEC",
        description=None,
        start_x=199900.0,
        start_y=200000.0,
        end_x=201100.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )
    db_session.add(section)
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=section.id,
    )

    src = [c for c in candidates if c.source_investigation_id == bh_source.id]
    assert {c.side for c in src} == {"left", "right"}, f"Expected one candidate per side, got {src}"
    # The bare flanks are section tests beyond bh_source → both sides pinch,
    # neither opens.
    assert all(c.kind == "pinch_out_halfway" for c in src), (
        f"Interior participant flanked by bare section tests must pinch on both "
        f"sides (no open ends), got kinds {[(c.side, c.kind) for c in src]}"
    )
    left = next(c for c in src if c.side == "left")
    right = next(c for c in src if c.side == "right")
    assert left.suggested_neighbour_investigation_id == bh_bare_left.id
    assert right.suggested_neighbour_investigation_id == bh_bare_right.id


# ---------------------------------------------------------------------------
# Test 10: naming/claiming ONE instance does not suppress its sibling
# (the regression Task 6 fixes — per-instance body identity)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_named_instance_does_not_suppress_the_other(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Two uncorrelated same-formation SAND instances resolve to DISTINCT
    bodies; naming (and claiming an extent on) the SHALLOW instance's body
    must NOT suppress the DEEP instance's pinch-out candidates.

    This is the over-suppression bug: the interim ``(formation,
    instance_ordinal)`` body resolution collapsed two distinct instances of
    one formation onto a single body, so settling one instance hid the
    other's candidates.  Per-layer ``body_id`` keying keeps them independent.

    Topology on bh_source — two SAND units of ONE formation, separated by
    TWO distinct interbeds (CLAY then SILT) so the two sands do NOT directly
    bracket a single minority unit (which would be an enclosed lens and
    suppress the sand host halves).  Both sands are accepted layers the
    resolver assigns to two different instances:
      2.0  c_sand_a  (f_sand)  ← shallow SAND instance (ordinal 0) — named + claimed
      5.0  c_clay    (f_clay)  ← clay interbed (distinct formation)
      8.0  c_silt    (f_silt)  ← silt interbed (distinct formation)
      11.0 c_sand_b  (f_sand)  ← deep SAND instance (ordinal 1) — must still emit
      15.0 c_base    (f_base)  ← base
    bh_left / bh_right each carry one uncorrelated contact so both sand units
    have a neighbour on each side.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-SBPO-t10")
    # Both SAND units reference ONE formation row (same find-or-create key) but
    # are NOT a lens — two distinct interbeds (CLAY, SILT) separate them, so the
    # lens-aware suppression does not fire and both are independent instances.
    f_sand = _formation(project, parent, name="ZAND-SBPO-t10", soil_code="ZAND", ordinal=0)
    f_clay = _formation(project, parent, name="KLEI-SBPO-t10", soil_code="KLEI", ordinal=1)
    f_silt = _formation(project, parent, name="SILT-SBPO-t10", soil_code="SILT", ordinal=2)
    f_base = _formation(project, parent, name="GRIND-SBPO-t10-base", soil_code="GRIND", ordinal=3)
    f_flank = _formation(project, parent, name="VEEN-SBPO-t10", soil_code="VEEN", ordinal=4)
    db_session.add_all([geo, litho, parent, f_sand, f_clay, f_silt, f_base, f_flank])
    await db_session.flush()

    bh_left = _borehole(project.id, suffix="T10-L", x=195000.0)
    bh_source = _borehole(project.id, suffix="T10-S", x=195500.0)
    bh_right = _borehole(project.id, suffix="T10-R", x=196000.0)
    db_session.add_all([bh_left, bh_source, bh_right])
    await db_session.flush()

    c_sand_a = _contact(litho, f_sand, bh_source, depth=2.0)
    c_clay = _contact(litho, f_clay, bh_source, depth=5.0)
    c_silt = _contact(litho, f_silt, bh_source, depth=8.0)
    c_sand_b = _contact(litho, f_sand, bh_source, depth=11.0)
    c_base = _contact(litho, f_base, bh_source, depth=15.0)
    c_left = _contact(litho, f_flank, bh_left, depth=3.0)
    c_right = _contact(litho, f_flank, bh_right, depth=3.0)
    db_session.add_all([c_sand_a, c_clay, c_silt, c_sand_b, c_base, c_left, c_right])
    await db_session.commit()

    # Resolve instances → one body per layer (all uncorrelated). The two SAND
    # layers get distinct bodies (ordinals 0 and 1) stamped on their layers.
    await ResolveLithoInstances(db_session).execute(model_id=litho.id)

    shallow_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_sand_a.id)
        )
    ).scalar_one()
    deep_body_id = (
        await db_session.execute(
            select(LithoLayerOrm.body_id).where(LithoLayerOrm.id == c_sand_b.id)
        )
    ).scalar_one()
    assert shallow_body_id is not None and deep_body_id is not None
    assert shallow_body_id != deep_body_id, (
        "The two same-formation SAND instances must resolve to DISTINCT bodies"
    )

    # Name AND fully claim the SHALLOW instance's body (both sides).
    await db_session.execute(
        update(BodyOrm)
        .where(BodyOrm.id == shallow_body_id)
        .values(
            name="Top sand",
            extent_left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            extent_left_neighbour_inv_id=bh_left.id,
            extent_right_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            extent_right_neighbour_inv_id=bh_right.id,
        )
    )
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # The DEEP sand instance's body still yields at least one candidate —
    # naming/claiming the shallow sibling did not suppress it.
    deep_candidates = [c for c in candidates if c.body_id == deep_body_id]
    assert any(c.body_id == deep_body_id for c in candidates), (
        f"Deep SAND instance (body {deep_body_id}) must still yield a candidate "
        f"after the shallow sibling was named + claimed; candidates={candidates}"
    )

    # And the shallow (fully-claimed) body yields none — its own sides are settled.
    shallow_candidates = [c for c in candidates if c.body_id == shallow_body_id]
    assert shallow_candidates == [], (
        f"Fully-claimed shallow body must emit no candidates, got {shallow_candidates}"
    )

    # Sanity: the deep candidates frame the deep sand unit (above == c_sand_b).
    assert all(c.above_contact_id == c_sand_b.id for c in deep_candidates)
