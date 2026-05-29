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
    """Column A has contacts c1 (sand top) at 2 m, c2 (silt top) at 5 m,
    c3 (clay top) at 8 m → silt body between c2 and c3 is the lens.
    Column B has contact c10 at 3 m.  Both c2↔c10 and c3↔c10 are approved
    — the silt body on A pinches out to a single sand-clay boundary on B.
    Lens detector should emit ONE candidate: silt body on A between c2 and c3."""
    stacks = [
        ContactStack(
            investigation_id=_uid(100),
            entries=(
                ContactStackEntry(_uid(1), _uid(1000), 2.0),  # sand top
                ContactStackEntry(_uid(2), _uid(1001), 5.0),  # silt body (lens) — top
                ContactStackEntry(_uid(3), _uid(1002), 8.0),  # clay top
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
        ContactEdge(_uid(2), _uid(10)),  # silt-top boundary on A ↔ sand-clay on B
        ContactEdge(_uid(3), _uid(10)),  # silt-base = clay-top on A ↔ same B
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 1
    lens = result[0]
    assert lens.contact_above_id == _uid(2)
    assert lens.contact_below_id == _uid(3)
    assert lens.target_contact_id == _uid(10)
    assert lens.target_investigation_id == _uid(200)
    assert lens.source_investigation_id == _uid(100)
    assert lens.formation_id == _uid(1001)  # silt — the formation whose top is c2


def test_degeneracy_guard_rejects_thick_lens() -> None:
    """max_lens_thickness_m rejects a body thicker than the cap; off/generous keeps it.

    Reuses the happy-path topology — the silt body c2(5 m)→c3(8 m) is 3 m thick
    (dogfeed 2026-05-29: a near-whole-column "lens" from a loose correlation is
    the degeneracy this guards against).
    """
    stacks = [
        ContactStack(
            investigation_id=_uid(100),
            entries=(
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),
                ContactStackEntry(_uid(3), _uid(1002), 8.0),
            ),
        ),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(1003), 3.0),)),
    ]
    edges = [ContactEdge(_uid(2), _uid(10)), ContactEdge(_uid(3), _uid(10))]
    # 3 m body, 2 m cap → rejected.
    assert detect_lenses_from_graph(edges, stacks, max_lens_thickness_m=2.0) == []
    # generous cap → kept.
    assert len(detect_lenses_from_graph(edges, stacks, max_lens_thickness_m=10.0)) == 1
    # guard off (None default) → kept (existing behaviour).
    assert len(detect_lenses_from_graph(edges, stacks)) == 1


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
