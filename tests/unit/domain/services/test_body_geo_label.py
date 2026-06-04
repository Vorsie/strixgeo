"""Unit tests for the A2 body geo-label majority derivation."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.body_geo_label import (
    geo_formation_at_depth,
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
