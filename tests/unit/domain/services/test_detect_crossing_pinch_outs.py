"""Unit tests for crossing-based pinch-out detection (auto-lens increment 2).

A correlation crossing — the shallower contact on one column mapping to the
DEEPER contact on the next — is geologically impossible for flat continuous
beds, so it signals a layer that pinches out. ``detect_crossing_pinch_outs``
turns each crossing into a ``CrossingPinchOut`` framing the pinching layer.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.detect_body_extents import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
)
from groundmodel.domain.services.detect_crossing_pinch_outs import (
    CrossingPinchOut,
    detect_crossing_pinch_outs,
)


def _uid(n: int) -> UUID:
    """Deterministic UUID from a small int seed."""
    return UUID(int=n, version=4)


def _stack(inv: int, depths: dict[int, float]) -> ContactStack:
    """Build a ContactStack for investigation ``inv`` from {contact_seed: depth}."""
    entries = tuple(
        ContactStackEntry(contact_id=_uid(cid), formation_id=_uid(900 + cid), depth_top_m=d)
        for cid, d in depths.items()
    )
    return ContactStack(investigation_id=_uid(inv), entries=entries)


def test_crossing_edges_emit_one_pinch_out() -> None:
    """Two edges that invert depth order between a column pair → one pinch-out.

    Column A (inv 10): contacts c1@2 m, c2@4 m. Column B (inv 11): c3@3 m, c4@5 m.
    Edges (c1→c4) maps A@2 → B@5 and (c2→c3) maps A@4 → B@3. Sorted by A-depth
    the B-depths are 5 then 3 — an inversion — so the A-layer between c1 and c2
    pinches out toward B.
    """
    stacks = [
        _stack(10, {1: 2.0, 2: 4.0}),
        _stack(11, {3: 3.0, 4: 5.0}),
    ]
    edges = [
        ContactEdge(contact_a_id=_uid(1), contact_b_id=_uid(4)),  # A@2 → B@5
        ContactEdge(contact_a_id=_uid(2), contact_b_id=_uid(3)),  # A@4 → B@3
    ]
    result = detect_crossing_pinch_outs(edges, stacks)
    assert len(result) == 1
    po = result[0]
    assert po.source_investigation_id == _uid(10)
    assert po.above_contact_id == _uid(1)
    assert po.below_contact_id == _uid(2)
    assert po.neighbour_investigation_id == _uid(11)
    # The two edges that cross are reported (as unordered contact pairs) so the
    # caller can DROP them from persistence — a crossing edge is not a flat
    # correlation. Edge_above = {c1, c4}, edge_below = {c2, c3}.
    assert set(po.crossing_edges) == {
        frozenset({_uid(1), _uid(4)}),
        frozenset({_uid(2), _uid(3)}),
    }


def test_monotonic_edges_emit_nothing() -> None:
    """Depth-order-preserving edges are a flat correlation — no pinch-out.

    Same columns, but edges (c1→c3) A@2→B@3 and (c2→c4) A@4→B@5 keep the order
    (B-depths 3 then 5, increasing), so there is no crossing.
    """
    stacks = [
        _stack(10, {1: 2.0, 2: 4.0}),
        _stack(11, {3: 3.0, 4: 5.0}),
    ]
    edges = [
        ContactEdge(contact_a_id=_uid(1), contact_b_id=_uid(3)),
        ContactEdge(contact_a_id=_uid(2), contact_b_id=_uid(4)),
    ]
    assert detect_crossing_pinch_outs(edges, stacks) == []


def test_single_edge_cannot_cross() -> None:
    """One edge per column pair can never invert — no pinch-out."""
    stacks = [_stack(10, {1: 2.0}), _stack(11, {3: 5.0})]
    edges = [ContactEdge(contact_a_id=_uid(1), contact_b_id=_uid(3))]
    assert detect_crossing_pinch_outs(edges, stacks) == []


def test_unknown_contact_ids_are_skipped() -> None:
    """Edges referencing contacts absent from the stacks are ignored, not raised."""
    stacks = [_stack(10, {1: 2.0, 2: 4.0})]
    edges = [ContactEdge(contact_a_id=_uid(1), contact_b_id=_uid(999))]
    assert detect_crossing_pinch_outs(edges, stacks) == []


def test_output_is_a_crossing_pinch_out() -> None:
    """The returned items are the documented frozen dataclass."""
    stacks = [
        _stack(10, {1: 2.0, 2: 4.0}),
        _stack(11, {3: 3.0, 4: 5.0}),
    ]
    edges = [
        ContactEdge(contact_a_id=_uid(1), contact_b_id=_uid(4)),
        ContactEdge(contact_a_id=_uid(2), contact_b_id=_uid(3)),
    ]
    (po,) = detect_crossing_pinch_outs(edges, stacks)
    assert isinstance(po, CrossingPinchOut)
