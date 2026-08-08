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
    ExistingTie,
    tie_key,
    EdgeActions,
    EdgeRef,
    edge_review_actions,
    plan_edge_transfer,
)
from groundmodel.application.geotech_tie_reanchor import (
    REVIEW_AMBIGUOUS_BAND,
    REVIEW_CLASS_CHANGED,
)


def _edge(
    a: UUID,
    b: UUID,
    *,
    approved: bool = True,
    reason: str | None = None,
    a_side: str = "top",
    b_side: str = "top",
) -> EdgeRef:
    return EdgeRef(
        edge_id=uuid4(),
        layer_a_id=a,
        layer_b_id=b,
        layer_a_side=a_side,
        layer_b_side=b_side,
        user_approved=approved,
        review_reason=reason,
    )


def _existing(a: UUID, b: UUID, *, approved: bool, a_side: str = "top", b_side: str = "top"):
    """One tie the survivor already carries, keyed the way the planner keys it."""
    edge = _edge(a, b, approved=approved, a_side=a_side, b_side=b_side)
    return {tie_key(a, a_side, b, b_side): ExistingTie(edge.edge_id, approved)}


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
    )
    assert actions.to_flag == (edge.edge_id,)


def test_ea7_a_move_edits_both_endpoints_and_both_new_classes_count() -> None:
    """EA7 — an edge between the move's two rows judges both NEW classes."""
    upper, lower = uuid4(), uuid4()
    actions = edge_review_actions(
        edges=[_edge(upper, lower)],
        new_class_by_layer_id={upper: 7, lower: 7},
        class_by_layer_id={},
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
    )
    assert actions == EdgeActions((), (), ())


# ---------------------------------------------------------------------------
# TR — plan_edge_transfer (absorbed band's accepted ties move to the survivor)
# ---------------------------------------------------------------------------


def test_tr1_accepted_tie_transfers_to_the_survivor_and_is_flagged() -> None:
    """TR1 — the tie survives the absorb, re-anchored + flagged for review.

    The survivor's class still matches the partner here, so the flag names the
    anchor change (``ambiguous_band``), not a class change.
    """
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    edge = _edge(absorbed, partner, approved=True)
    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_ties={},
    )
    assert len(plan.moves) == 1
    move = plan.moves[0]
    assert move.edge_id == edge.edge_id
    assert {move.new_layer_a_id, move.new_layer_b_id} == {survivor, partner}
    assert move.new_layer_a_id < move.new_layer_b_id  # canonical order restored
    assert move.review_reason == REVIEW_AMBIGUOUS_BAND
    assert plan.drops == ()


def test_tr2_class_mismatch_after_transfer_is_flagged_class_changed() -> None:
    """TR2 — survivor's class no longer matches the partner: the stronger flag."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    edge = _edge(partner, absorbed, approved=True)
    plan = plan_edge_transfer(
        edges=[edge],
        from_layer_id=absorbed,
        to_layer_id=survivor,
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
    )
    assert actions.to_flag == ()
    assert actions.to_delete == ()
    assert actions.to_clear == ()
