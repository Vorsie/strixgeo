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
) -> EdgeRef:
    return EdgeRef(
        edge_id=uuid4(),
        layer_a_id=a,
        layer_b_id=b,
        user_approved=approved,
        review_reason=reason,
    )


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
        existing_pair_keys=set(),
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
        existing_pair_keys=set(),
    )
    assert plan.moves[0].review_reason == REVIEW_CLASS_CHANGED


def test_tr3_duplicates_self_loops_and_pending_do_not_transfer() -> None:
    """TR3 — a duplicate is the same tie (drop+count); a self-loop is nothing;
    pending edges are the cascade's to take."""
    absorbed, survivor, partner = uuid4(), uuid4(), uuid4()
    duplicate = _edge(absorbed, partner, approved=True)
    self_loop = _edge(absorbed, survivor, approved=True)
    pending = _edge(absorbed, partner, approved=False)
    existing = {(min(survivor, partner), max(survivor, partner))}
    plan = plan_edge_transfer(
        edges=[duplicate, self_loop, pending],
        from_layer_id=absorbed,
        to_layer_id=survivor,
        survivor_class=6,
        class_by_partner={partner: 6},
        existing_pair_keys=existing,
    )
    assert plan.moves == ()
    assert set(plan.drops) == {duplicate.edge_id, self_loop.edge_id}
