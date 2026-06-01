"""Unit tests for detect_body_extents (replaces detect_lenses_from_graph).

The new shape: each detected body has explicit per-side ``BodyExtent``
markers (left + right), assigned by comparing target investigation
along-positions to the source's. Bilateral closure (≥2 distinct target
investigations) is still required to fire a body.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.detect_body_extents import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_body_extents,
)

from groundmodel.domain.services.body_extent import BodyExtent, DetectedBody
from groundmodel.shared.constants.extent_kind import EXTENT_KIND_TO_TARGET


def _uid(n: int) -> UUID:
    return UUID(int=n)


def test_bilateral_closure_produces_one_body_with_two_extents() -> None:
    """Source pair (c2, c3) on inv-A (along=100) with bilateral closure
    to inv-B (along=50, target c_b) + inv-C (along=150, target c_c)
    produces a body with extent_left.target=c_b and extent_right.target=c_c."""
    inv_a, inv_b, inv_c = _uid(100), _uid(200), _uid(300)
    c1, c2, c3, c_b, c_c = _uid(1), _uid(2), _uid(3), _uid(10), _uid(20)
    f_top, f_lens, f_base, f_target = _uid(1000), _uid(1001), _uid(1002), _uid(1003)

    stacks = [
        ContactStack(
            inv_a,
            (
                ContactStackEntry(c1, f_top, 2.0),
                ContactStackEntry(c2, f_lens, 5.0),
                ContactStackEntry(c3, f_base, 8.0),
            ),
        ),
        ContactStack(inv_b, (ContactStackEntry(c_b, f_target, 3.0),)),
        ContactStack(inv_c, (ContactStackEntry(c_c, f_target, 3.5),)),
    ]
    edges = [
        ContactEdge(c2, c_b),
        ContactEdge(c3, c_b),
        ContactEdge(c2, c_c),
        ContactEdge(c3, c_c),
    ]
    # inv positions: along inv_b=50 < inv_a=100 < inv_c=150
    inv_along = {inv_a: 100.0, inv_b: 50.0, inv_c: 150.0}

    bodies = detect_body_extents(edges, stacks, investigation_along_positions=inv_along)

    assert len(bodies) == 1
    body = bodies[0]
    assert body.formation_id == f_lens
    assert body.source_investigation_id == inv_a
    assert body.contact_above_id == c2
    assert body.contact_below_id == c3
    # Left = lower along = inv_b (along=50 < source along=100)
    assert body.extent_left is not None
    assert body.extent_left.kind == EXTENT_KIND_TO_TARGET
    assert body.extent_left.target_contact_id == c_b
    assert body.extent_left.neighbour_investigation_id == inv_b
    # Right = higher along = inv_c (along=150 > source along=100)
    assert body.extent_right is not None
    assert body.extent_right.kind == EXTENT_KIND_TO_TARGET
    assert body.extent_right.target_contact_id == c_c
    assert body.extent_right.neighbour_investigation_id == inv_c


def test_unilateral_closure_produces_nothing() -> None:
    """Only ONE target investigation → bilateral rule rejects → empty result."""
    inv_a, inv_b = _uid(100), _uid(200)
    c1, c2, c3, c_b = _uid(1), _uid(2), _uid(3), _uid(10)
    f_top, f_lens, f_base, f_target = _uid(1000), _uid(1001), _uid(1002), _uid(1003)

    stacks = [
        ContactStack(
            inv_a,
            (
                ContactStackEntry(c1, f_top, 2.0),
                ContactStackEntry(c2, f_lens, 5.0),
                ContactStackEntry(c3, f_base, 8.0),
            ),
        ),
        ContactStack(inv_b, (ContactStackEntry(c_b, f_target, 3.0),)),
    ]
    edges = [ContactEdge(c2, c_b), ContactEdge(c3, c_b)]

    bodies = detect_body_extents(edges, stacks)
    assert bodies == []


def test_empty_graph_returns_empty() -> None:
    """No edges → empty result."""
    assert detect_body_extents([], []) == []


def test_degeneracy_thickness_guard() -> None:
    """max_body_thickness_m rejects bodies thicker than the cap."""
    inv_a, inv_b, inv_c = _uid(100), _uid(200), _uid(300)
    c1, c2, c3, c_b, c_c = _uid(1), _uid(2), _uid(3), _uid(10), _uid(20)
    f_top, f_lens, f_base, f_target = _uid(1000), _uid(1001), _uid(1002), _uid(1003)

    stacks = [
        ContactStack(
            inv_a,
            (
                ContactStackEntry(c1, f_top, 2.0),
                ContactStackEntry(c2, f_lens, 5.0),
                ContactStackEntry(c3, f_base, 50.0),  # thick — 45 m body
            ),
        ),
        ContactStack(inv_b, (ContactStackEntry(c_b, f_target, 3.0),)),
        ContactStack(inv_c, (ContactStackEntry(c_c, f_target, 3.5),)),
    ]
    edges = [
        ContactEdge(c2, c_b),
        ContactEdge(c3, c_b),
        ContactEdge(c2, c_c),
        ContactEdge(c3, c_c),
    ]

    assert detect_body_extents(edges, stacks, max_body_thickness_m=10.0) == []
    bodies = detect_body_extents(edges, stacks, max_body_thickness_m=100.0)
    assert len(bodies) == 1


def test_stacked_bodies() -> None:
    """Three source contacts on inv-A all closing bilaterally to inv-B + inv-C
    produces 2 stacked bodies (between adjacent contact pairs)."""
    inv_a, inv_b, inv_c = _uid(100), _uid(200), _uid(300)
    c1, c2, c3, c_b, c_c = _uid(1), _uid(2), _uid(3), _uid(10), _uid(20)
    f1, f2, f_target = _uid(1000), _uid(1001), _uid(1003)

    stacks = [
        ContactStack(
            inv_a,
            (
                ContactStackEntry(c1, f1, 2.0),
                ContactStackEntry(c2, f2, 5.0),
                ContactStackEntry(c3, f1, 8.0),
            ),
        ),
        ContactStack(inv_b, (ContactStackEntry(c_b, f_target, 3.0),)),
        ContactStack(inv_c, (ContactStackEntry(c_c, f_target, 3.5),)),
    ]
    edges = [
        ContactEdge(c1, c_b),
        ContactEdge(c2, c_b),
        ContactEdge(c3, c_b),
        ContactEdge(c1, c_c),
        ContactEdge(c2, c_c),
        ContactEdge(c3, c_c),
    ]

    bodies = detect_body_extents(edges, stacks)
    assert len(bodies) == 2
    body_pairs = {(b.contact_above_id, b.contact_below_id) for b in bodies}
    assert (c1, c2) in body_pairs
    assert (c2, c3) in body_pairs


def test_left_right_assignment_falls_back_to_uuid_when_along_missing() -> None:
    """When investigation_along_positions is empty/missing, left/right is
    assigned by UUID ordering (deterministic but rough)."""
    inv_a, inv_b, inv_c = _uid(100), _uid(200), _uid(300)
    c1, c2, c3, c_b, c_c = _uid(1), _uid(2), _uid(3), _uid(10), _uid(20)
    f_top, f_lens, f_base, f_target = _uid(1000), _uid(1001), _uid(1002), _uid(1003)

    stacks = [
        ContactStack(
            inv_a,
            (
                ContactStackEntry(c1, f_top, 2.0),
                ContactStackEntry(c2, f_lens, 5.0),
                ContactStackEntry(c3, f_base, 8.0),
            ),
        ),
        ContactStack(inv_b, (ContactStackEntry(c_b, f_target, 3.0),)),
        ContactStack(inv_c, (ContactStackEntry(c_c, f_target, 3.5),)),
    ]
    edges = [
        ContactEdge(c2, c_b),
        ContactEdge(c3, c_b),
        ContactEdge(c2, c_c),
        ContactEdge(c3, c_c),
    ]
    # No investigation_along_positions provided.
    bodies = detect_body_extents(edges, stacks)
    assert len(bodies) == 1
    body = bodies[0]
    # inv_b UUID (int=200) < inv_c UUID (int=300), so inv_b is "left" by UUID fallback
    assert body.extent_left is not None
    assert body.extent_right is not None
    assert body.extent_left.neighbour_investigation_id == inv_b
    assert body.extent_right.neighbour_investigation_id == inv_c
