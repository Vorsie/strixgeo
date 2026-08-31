"""Unit tests for the A2 body geo-label majority derivation."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.body_geo_label import (
    geo_formation_at_depth,
    geo_formations_present,
    majority_geo_formation,
)

Q = UUID("00000000-0000-0000-0000-0000000000a1")  # Quartair (shallow)
P = UUID("00000000-0000-0000-0000-0000000000a2")  # Pleistoceen (deep)
INV_A = UUID("00000000-0000-0000-0000-0000000000b1")
INV_B = UUID("00000000-0000-0000-0000-0000000000b2")

# Q tops at 0 m, P tops at 8 m → [0,8) = Q, [8,∞) = P.
CONTACTS = [(0.0, Q), (8.0, P)]


def test_geo_formation_at_depth_picks_deepest_top_at_or_above() -> None:
    """A depth resolves to the formation whose top is the deepest <= it."""
    assert geo_formation_at_depth(CONTACTS, 4.0) == Q
    assert geo_formation_at_depth(CONTACTS, 8.0) == P  # exactly on the boundary → lower
    assert geo_formation_at_depth(CONTACTS, 12.0) == P


def test_geo_formation_at_depth_above_shallowest_is_none() -> None:
    """A depth above the shallowest contact has no owning formation."""
    assert geo_formation_at_depth([(2.0, Q)], 1.0) is None


def test_single_member_takes_its_formation() -> None:
    """A body whose only member sits in Quartair is labelled Quartair."""
    members = [(INV_A, 2.0, 6.0)]  # midpoint 4.0 → Q
    assert majority_geo_formation(members, {INV_A: CONTACTS}) == Q


def test_thickness_majority_wins_across_the_boundary() -> None:
    """The formation owning the greater member thickness wins (>=50% rule).

    A continuous sand spanning the Q/P boundary: a thin slice in Quartair and a
    thick slice in Pleistoceen → the body is labelled Pleistoceen.
    """
    members = [
        (INV_A, 0.0, 3.0),  # mid 1.5 → Q, thickness 3
        (INV_B, 10.0, 16.0),  # mid 13.0 → P, thickness 6
    ]
    assert majority_geo_formation(members, {INV_A: CONTACTS, INV_B: CONTACTS}) == P


def test_tie_breaks_to_smallest_uuid() -> None:
    """Equal thickness in two formations breaks to the smallest UUID."""
    members = [
        (INV_A, 0.0, 4.0),  # mid 2.0 → Q, thickness 4
        (INV_B, 10.0, 14.0),  # mid 12.0 → P, thickness 4
    ]
    # Q (…a1) < P (…a2) → Q wins the tie.
    assert majority_geo_formation(members, {INV_A: CONTACTS, INV_B: CONTACTS}) == Q


def test_no_geological_contacts_returns_none() -> None:
    """With no geological model defined at the members, the label is None."""
    members = [(INV_A, 2.0, 6.0)]
    assert majority_geo_formation(members, {}) is None


# ---------------------------------------------------------------------------
# R2 (owner ruling 2026-08-31): a body crossing two formations LISTS them both,
# not a majority stamp. The list is ordered shallowest-first.
# ---------------------------------------------------------------------------


def test_a_body_crossing_two_formations_lists_them_both_shallowest_first() -> None:
    """A body crossing two formations lists them both, shallowest first.

    A continuous sand straddling the Q/P boundary: a member sitting in Quartair
    (shallow) and a member sitting in Pleistoceen (deep). The ruling is the unit
    row LISTS both, not a single majority stamp — and shallowest first, so
    Quartair leads.
    """
    members = [
        (INV_A, 0.0, 3.0),  # mid 1.5 -> Q, top 0.0
        (INV_B, 10.0, 16.0),  # mid 13.0 -> P, top 10.0
    ]
    assert geo_formations_present(members, {INV_A: CONTACTS, INV_B: CONTACTS}) == [Q, P]


def test_single_formation_body_lists_one_entry() -> None:
    """A body wholly inside one formation lists exactly that formation."""
    members = [(INV_A, 2.0, 6.0)]  # midpoint 4.0 -> Q
    assert geo_formations_present(members, {INV_A: CONTACTS}) == [Q]


def test_member_attributing_to_none_contributes_no_entry() -> None:
    """A member whose midpoint sits above the shallowest contact adds nothing.

    An open shallow band (midpoint above every geological contact) attributes to
    no formation, exactly as the majority derivation skips it, so it must not
    appear in the present-list either.
    """
    contacts = [(2.0, Q)]  # Q tops at 2 m; anything above 2 m has no formation.
    members = [
        (INV_A, 0.0, 1.0),  # mid 0.5 -> None (open shallow band)
        (INV_A, 3.0, 5.0),  # mid 4.0 -> Q
    ]
    assert geo_formations_present(members, {INV_A: contacts}) == [Q]


def test_ties_on_shallowest_break_to_larger_thickness_then_uuid() -> None:
    """Formations sharing a shallowest member break to larger thickness, then UUID.

    Two members top out at the same depth in different investigations (one all
    Quartair, one all Pleistoceen). Their shallowest attributed member ties, so
    the one owning the greater thickness share is listed first.
    """
    contacts_a = [(0.0, Q)]  # every depth in INV_A is Quartair.
    contacts_b = [(0.0, P)]  # every depth in INV_B is Pleistoceen.
    members = [
        (INV_A, 0.0, 2.0),  # Q, top 0.0, thickness 2
        (INV_B, 0.0, 6.0),  # P, top 0.0, thickness 6
    ]
    # Shallowest ties at 0.0 -> larger thickness (P, 6) leads (Q, 2).
    assert geo_formations_present(members, {INV_A: contacts_a, INV_B: contacts_b}) == [P, Q]


def test_full_tie_breaks_to_smallest_uuid_for_determinism() -> None:
    """Equal shallowest AND equal thickness breaks to the smallest UUID."""
    contacts_a = [(0.0, Q)]
    contacts_b = [(0.0, P)]
    members = [
        (INV_A, 0.0, 4.0),  # Q, top 0.0, thickness 4
        (INV_B, 0.0, 4.0),  # P, top 0.0, thickness 4
    ]
    # Q (...a1) < P (...a2) -> Q first.
    assert geo_formations_present(members, {INV_A: contacts_a, INV_B: contacts_b}) == [Q, P]


def test_present_list_is_empty_when_no_member_resolves() -> None:
    """No geological model at the members -> an empty present-list."""
    members = [(INV_A, 2.0, 6.0)]
    assert geo_formations_present(members, {}) == []
