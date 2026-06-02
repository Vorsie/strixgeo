"""Integration tests for SuggestBodyPinchOuts.

Coverage:
1. Body with NO correlations on either side → emits 2 candidates
   (one left, one right) when adjacent investigations exist on both sides.
2. Body with bilateral closure (both sides paired via approved edges) →
   no candidates emitted.
3. Body with user-claimed left extent (pinch_out_halfway) + uncorrelated
   right → only the right-side candidate is emitted.
4. Source pair on the leftmost investigation (no neighbour to the left
   in UUID order) → no left-side candidate; right-side candidate emitted
   when uncorrelated.
5. NO persistence side effects — no new BodyOrm rows exist after the call.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

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
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import EXTENT_KIND_PINCH_OUT_HALFWAY

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
    assert len(source_candidates) >= 1
    assert all(c.below_contact_id == c_sand_low.id for c in source_candidates)
