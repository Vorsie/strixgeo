"""Unit tests for detect_lenses_from_graph (#133 Phase 2+3 / consumes #135 topology)."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.detect_lenses_from_graph import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_lenses_from_graph,
)


def _uid(n: int) -> UUID:
    return UUID(int=n)


def test_happy_path_single_lens() -> None:
    """Column A has contacts c1 (sand top) at 2 m, c2 (clay top) at 5 m,
    c3 (deepest) at 8 m → silt body between c1 and c2 is the lens.
    Column B has contact c10 at 3 m.  Both c1↔c10 and c2↔c10 are approved.
    Lens detector should emit ONE candidate: silt body on A between c1 and c2."""
    stacks = [
        ContactStack(
            investigation_id=_uid(100),
            entries=(
                ContactStackEntry(_uid(1), _uid(1000), 2.0),  # sand top
                ContactStackEntry(_uid(2), _uid(1001), 5.0),  # silt body (lens)
                ContactStackEntry(_uid(3), _uid(1002), 8.0),  # clay
            ),
        ),
        ContactStack(
            investigation_id=_uid(200),
            entries=(
                ContactStackEntry(_uid(10), _uid(1003), 3.0),  # sand-clay boundary on B
            ),
        ),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 1
    lens = result[0]
    assert lens.contact_above_id == _uid(1)
    assert lens.contact_below_id == _uid(2)
    assert lens.target_contact_id == _uid(10)
    assert lens.target_investigation_id == _uid(200)
    assert lens.source_investigation_id == _uid(100)
    assert lens.formation_id == _uid(1001)  # the silt body


def test_one_to_one_edges_no_lens() -> None:
    """Only 1-to-1 edges in the graph → empty result."""
    stacks = [
        ContactStack(_uid(100), (ContactStackEntry(_uid(1), _uid(1000), 2.0),)),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(1003), 3.0),)),
    ]
    edges = [ContactEdge(_uid(1), _uid(10))]
    assert detect_lenses_from_graph(edges, stacks) == []


def test_empty_graph() -> None:
    """No edges → empty result."""
    assert detect_lenses_from_graph([], []) == []


def test_stacked_lenses() -> None:
    """Three source contacts on A all edged to one target on B → 2 lens
    candidates (between contacts 1-2 and 2-3)."""
    stacks = [
        ContactStack(
            _uid(100),
            (
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),
                ContactStackEntry(_uid(3), _uid(1002), 8.0),
                ContactStackEntry(_uid(4), _uid(1003), 11.0),
            ),
        ),
        ContactStack(
            _uid(200),
            (ContactStackEntry(_uid(10), _uid(1004), 3.0),),
        ),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(3), _uid(10)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 2
    # Verify the two stacked pairs are present.
    pairs = {(c.contact_above_id, c.contact_below_id) for c in result}
    assert (_uid(1), _uid(2)) in pairs
    assert (_uid(2), _uid(3)) in pairs


def test_two_independent_lens_topologies() -> None:
    """Two unrelated lens topologies in the same model → 2 candidates."""
    stacks = [
        ContactStack(
            _uid(100),
            (
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),
            ),
        ),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(1002), 3.0),)),
        ContactStack(
            _uid(300),
            (
                ContactStackEntry(_uid(20), _uid(1003), 4.0),
                ContactStackEntry(_uid(21), _uid(1004), 7.0),
            ),
        ),
        ContactStack(_uid(400), (ContactStackEntry(_uid(30), _uid(1005), 5.0),)),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(20), _uid(30)),
        ContactEdge(_uid(21), _uid(30)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 2
