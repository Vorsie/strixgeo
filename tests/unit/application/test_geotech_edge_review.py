"""Flag-not-drop + accepted-tie transfer — owner ruling 2026-08-07.

"I don't want accepted edges to just disappear without any user explicitly
deleting it." When a hand edit re-derives a class and an ACCEPTED packing
tie's partner no longer matches, the tie is FLAGGED ``class_changed`` (the
violet review badge + Confirm-tie flow) instead of deleted. PENDING
mismatches still drop — a machine claim the machine may withdraw. A restored
match self-heals the ``class_changed`` flag; ``ambiguous_band`` names an
anchor-identity doubt a class match does not resolve, so it never
auto-clears. And when a merge absorbs a row, its accepted ties are
TRANSFERRED to the survivor (flagged for review) rather than FK-cascaded
into silence.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from groundmodel.application.geotech_band_edit_helpers import (
    EdgeActions,
    EdgeRef,
    ExistingTie,
    edge_review_actions,
    plan_edge_transfer,
    tie_key,
)
from groundmodel.application.geotech_tie_reanchor import (
    REVIEW_AMBIGUOUS_BAND,
    REVIEW_BAND_ABSORBED,
    REVIEW_CLASS_CHANGED,
)

SECTION_1 = UUID("11111111-1111-1111-1111-111111111111")
SECTION_2 = UUID("22222222-2222-2222-2222-222222222222")


def _edge(
    a: UUID,
    b: UUID,
    *,
    approved: bool = True,
    reason: str | None = None,
    a_side: str = "top",
    b_side: str = "top",
    section: UUID = SECTION_1,
) -> EdgeRef:
    return EdgeRef(
        edge_id=uuid4(),
        section_id=section,
        layer_a_id=a,
        layer_b_id=b,
        layer_a_side=a_side,
        layer_b_side=b_side,
        user_approved=approved,
        review_reason=reason,
    )


def _existing(
    a: UUID,
    b: UUID,
    *,
    approved: bool,
    a_side: str = "top",
    b_side: str = "top",
    section: UUID = SECTION_1,
):
    """One tie the survivor already carries, keyed the way the planner keys it."""
    edge = _edge(a, b, approved=approved, a_side=a_side, b_side=b_side, section=section)
    return {tie_key(section, a, a_side, b, b_side): ExistingTie(edge.edge_id, approved)}


# ---------------------------------------------------------------------------
# EA — edge_review_actions (supersedes invalidated_edge_ids' drop-everything)
# ---------------------------------------------------------------------------


def test_ea1_accepted_mismatch_is_flagged_not_deleted() -> None:
    """EA1 — accepted work survives a machine decision; it gains the badge."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, approved=True)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 8},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 6},
    )
    assert actions.to_flag == (edge.edge_id,)
    assert actions.to_delete == ()


def test_ea2_pending_mismatch_still_drops() -> None:
    """EA2 — a pending tie is the machine's own claim; it may withdraw it."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, approved=False)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 8},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 6},
    )
    assert actions.to_delete == (edge.edge_id,)
    assert actions.to_flag == ()


def test_ea3_matching_tie_is_untouched() -> None:
    """EA3 — a connection that still matches survives, exactly as before."""
    edited, partner = uuid4(), uuid4()
    actions = edge_review_actions(
        edges=[_edge(edited, partner)],
        new_class_by_layer_id={edited: 6},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 6},
    )
    assert actions == EdgeActions((), (), ())


def test_ea4_restored_match_self_heals_the_class_changed_flag() -> None:
    """EA4 — drag away then drag back is a true no-op: the flag clears."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, reason=REVIEW_CLASS_CHANGED)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 6},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 8},
    )
    assert actions.to_clear == (edge.edge_id,)


def test_ea5_ambiguous_band_never_auto_clears() -> None:
    """EA5 — a class match does not resolve an anchor-identity doubt."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, reason=REVIEW_AMBIGUOUS_BAND)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 6},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 8},
    )
    assert actions.to_clear == ()


def test_ea6_skeleton_class_flags_an_accepted_tie() -> None:
    """EA6 — a null class never matches (the skeleton-band rule), so flag."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, approved=True)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: None},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 6},
    )
    assert actions.to_flag == (edge.edge_id,)


def test_ea7_a_move_edits_both_endpoints_and_both_new_classes_count() -> None:
    """EA7 — an edge between the move's two rows judges both NEW classes."""
    upper, lower = uuid4(), uuid4()
    actions = edge_review_actions(
        edges=[_edge(upper, lower)],
        new_class_by_layer_id={upper: 7, lower: 7},
        class_by_layer_id={},
        old_class_by_layer_id={upper: 7, lower: 7},
    )
    assert actions == EdgeActions((), (), ())


def test_ea8_already_flagged_mismatch_is_idempotent() -> None:
    """EA8 — re-editing near a flagged tie does not re-report it."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, reason=REVIEW_CLASS_CHANGED)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 8},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 8},
    )
    assert actions == EdgeActions((), (), ())


# ---------------------------------------------------------------------------
# TR — plan_edge_transfer (absorbed band's accepted ties move to the survivor)
# ---------------------------------------------------------------------------


def test_tr1_accepted_tie_transfers_to_the_survivor_and_is_flagged() -> None:
    """TR1 — the tie survives the absorb, re-anchored + flagged for review.

    The survivor's class still matches the partner here, so the flag says what
    actually happened — a band was absorbed under the tie — rather than the vaguer
    ``ambiguous_band``, which belongs to the re-subdivide's anchor-identity doubt.
    Owner, asked to choose between the two: *"band absorbed seems better?"*
    """
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    edge = _edge(absorbed, partner, approved=True)
    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties={},
    )
    assert len(plan.moves) == 1
    move = plan.moves[0]
    assert move.edge_id == edge.edge_id
    assert {move.new_layer_a_id, move.new_layer_b_id} == {survivor, partner}
    assert move.new_layer_a_id < move.new_layer_b_id  # canonical order restored
    assert move.review_reason == REVIEW_BAND_ABSORBED
    assert plan.drops == ()


def test_tr2_class_mismatch_after_transfer_is_flagged_class_changed() -> None:
    """TR2 — survivor's class no longer matches the partner: the stronger flag."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    edge = _edge(partner, absorbed, approved=True)
    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=8,
        class_by_partner={partner: 6},
        existing_ties={},
    )
    assert plan.moves[0].review_reason == REVIEW_CLASS_CHANGED


def test_tr3_duplicates_self_loops_and_pending_do_not_transfer() -> None:
    """TR3 — a duplicate is the same tie (drop+count); a self-loop is nothing;
    pending edges are the cascade's to take."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    duplicate = _edge(absorbed, partner, approved=True)
    self_loop = _edge(absorbed, survivor, approved=True)
    pending = _edge(absorbed, partner, approved=False)
    plan = plan_edge_transfer(
        edges=[duplicate, self_loop, pending],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties=_existing(survivor, partner, approved=True),
    )
    assert plan.moves == ()
    assert set(plan.drops) == {duplicate.edge_id, self_loop.edge_id}


def test_tr4_a_base_tie_is_not_a_duplicate_of_a_top_tie_between_the_same_bands() -> None:
    """TR4 — two bands can carry TWO distinct ties: one joining their tops and
    one joining their bases (the uniqueness triple includes both sides). An
    accepted base-to-base tie must survive an absorb even when the survivor
    already ties the same partner top-to-top — they are different claims about
    different surfaces, and dropping one destroys accepted work."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    base_tie = _edge(absorbed, partner, approved=True, a_side="base", b_side="base")
    plan = plan_edge_transfer(
        edges=[base_tie],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties=_existing(survivor, partner, approved=True),
    )
    assert plan.drops == ()
    assert [m.edge_id for m in plan.moves] == [base_tie.edge_id]


def test_tr5_an_accepted_tie_displaces_a_pending_duplicate_rather_than_dying_for_it() -> None:
    """TR5 — flag-not-drop, applied to the collision itself: when the survivor's
    same-pair tie is only a PENDING machine proposal, the engineer's ACCEPTED
    tie wins the slot. The pending claim is withdrawn; the accepted one moves."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    accepted = _edge(absorbed, partner, approved=True)
    existing = _existing(survivor, partner, approved=False)
    pending_survivor_edge_id = next(iter(existing.values())).edge_id
    plan = plan_edge_transfer(
        edges=[accepted],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties=existing,
    )
    assert [m.edge_id for m in plan.moves] == [accepted.edge_id]
    assert plan.displaced_edge_ids == (pending_survivor_edge_id,)
    assert accepted.edge_id not in plan.drops


def test_ea9_an_ambiguous_band_flag_is_never_overwritten_into_a_self_healing_one() -> None:
    """EA9 — an ``ambiguous_band`` tie waits for the engineer's own Confirm,
    full stop. Re-flagging it ``class_changed`` on a later mismatch would let
    the NEXT restored match self-heal it away, clearing a review the engineer
    never gave. It keeps the flag it has; the badge stays up."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, approved=True, reason=REVIEW_AMBIGUOUS_BAND)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 7},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 6},
    )
    assert actions.to_flag == ()
    assert actions.to_delete == ()
    assert actions.to_clear == ()


def test_tr6_a_tie_on_another_section_is_not_a_duplicate() -> None:
    """TR6 — the database keys a tie by SECTION as well as by endpoints, because
    each section draws its own ribbon. An accepted tie drawn on section 2 is
    therefore not the same claim as one on section 1, and absorbing a band must
    not delete it as a "duplicate" — that is the engineer's own work on a
    section he was not even looking at."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    on_section_2 = _edge(absorbed, partner, approved=True, section=SECTION_2)
    plan = plan_edge_transfer(
        edges=[on_section_2],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties=_existing(survivor, partner, approved=True, section=SECTION_1),
    )
    assert plan.drops == ()
    assert [m.edge_id for m in plan.moves] == [on_section_2.edge_id]


def test_tr7_the_duplicate_test_still_bites_within_one_section() -> None:
    """TR7 — the section is part of the key, not a replacement for it: the same
    pair on the SAME section is still one tie."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    same_section = _edge(absorbed, partner, approved=True, section=SECTION_1)
    plan = plan_edge_transfer(
        edges=[same_section],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties=_existing(survivor, partner, approved=True, section=SECTION_1),
    )
    assert plan.moves == ()
    assert plan.drops == (same_section.edge_id,)


def test_tr8_the_sides_travel_with_their_own_endpoints() -> None:
    """TR8 — a tie says WHICH surfaces it joins, and the re-point must not
    scramble that. When the absorbed row sat in the ``layer_b`` slot and the
    survivor lands in ``layer_a``, the two side columns have to swap with the
    ids or the row now claims a different pair of surfaces correlate — a wrong
    geological statement written silently, with no error anywhere.

    Here the absorbed band's BASE is tied to the partner's TOP.
    """
    partner = UUID("00000000-0000-0000-0000-0000000000aa")
    absorbed = UUID("00000000-0000-0000-0000-0000000000ff")
    survivor = UUID("00000000-0000-0000-0000-000000000011")
    # partner < absorbed, so the absorbed row sits in slot b...
    assert partner < absorbed
    # ...and survivor < partner, so after the re-point the survivor takes slot a.
    assert survivor < partner
    edge = _edge(partner, absorbed, approved=True, a_side="top", b_side="base")

    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties={},
    )
    move = plan.moves[0]
    assert move.new_layer_a_id == survivor
    assert move.new_layer_b_id == partner
    # The slots swapped ends, so the sides must swap too: the survivor keeps
    # the absorbed band's BASE, the partner keeps its TOP.
    assert move.swap_sides is True


def test_tr9_sides_stay_put_when_the_slots_do() -> None:
    """TR9 — the mirror of TR8: when the re-point leaves each endpoint in the
    slot it already occupied, swapping the sides would be the corruption."""
    absorbed = UUID("00000000-0000-0000-0000-000000000011")
    survivor = UUID("00000000-0000-0000-0000-000000000022")
    partner = UUID("00000000-0000-0000-0000-0000000000ff")
    # absorbed < partner (slot a), and survivor < partner too — slot a again.
    edge = _edge(absorbed, partner, approved=True, a_side="base", b_side="top")

    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=6,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties={},
    )
    move = plan.moves[0]
    assert move.new_layer_a_id == survivor
    assert move.swap_sides is False


# ---------------------------------------------------------------------------
# Transition rule (owner ruling 2026-08-13: cross-class restatements are
# legitimate accepted ties) — flag only when the edit BROKE a match
# ---------------------------------------------------------------------------


def test_ea10_a_born_cross_class_tie_is_not_flagged_by_an_unrelated_edit() -> None:
    """EA10 — a restatement born cross-class (23-22, the litho tie carried
    down) was never a class match, so an edit that re-derives its endpoint to
    the SAME class did not break anything. Flagging it would bury every
    cross-class restatement in violet badges the first time any band is
    touched."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, approved=True)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 23},
        class_by_layer_id={partner: 22},
        old_class_by_layer_id={edited: 23},  # mismatched before, unchanged now
    )
    assert actions == EdgeActions((), (), ())


def test_ea11_a_mismatch_that_stays_a_mismatch_is_not_re_flagged() -> None:
    """EA11 — the edit changed the class (8 to 9) but the tie was ALREADY
    cross-class against its partner (6): no match was broken, no new flag."""
    edited, partner = uuid4(), uuid4()
    edge = _edge(edited, partner, approved=True)
    actions = edge_review_actions(
        edges=[edge],
        new_class_by_layer_id={edited: 9},
        class_by_layer_id={partner: 6},
        old_class_by_layer_id={edited: 8},
    )
    assert actions.to_flag == ()
    assert actions.to_delete == ()


def test_tr10_a_born_cross_class_tie_transfers_as_band_absorbed() -> None:
    """TR10 — the absorbed band carried a cross-class restatement (8 vs 6).
    The transfer did not break a match — there was none — so the honest label
    is ``band_absorbed``, not ``class_changed`` (which self-heals on a class
    match this tie can never have)."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    edge = _edge(absorbed, partner, approved=True)
    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        absorbed_class=8,  # was already mismatched against the partner's 6
        survivor_class=8,
        class_by_partner={partner: 6},
        existing_ties={},
    )
    assert plan.moves[0].review_reason == REVIEW_BAND_ABSORBED
