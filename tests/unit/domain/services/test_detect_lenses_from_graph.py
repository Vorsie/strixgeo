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
    """Bilateral pinch-out → one lens.

    Column A (source) has contacts c1 (sand top) at 2 m, c2 (silt top) at
    5 m, c3 (clay top) at 8 m → silt body between c2 and c3 is the lens.
    Columns B and C are neighbours that each carry a single sand-clay
    boundary; the silt body pinches out to that single boundary on BOTH
    of them.  Lens detector should emit ONE candidate: silt body on A
    between c2 and c3.  Owner directive 2026-05-31 — unilateral closure
    (single target investigation) no longer qualifies; see
    ``test_unilateral_pinch_out_does_not_create_lens``.
    """
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
        ContactStack(
            investigation_id=_uid(300),
            entries=(
                ContactStackEntry(_uid(20), _uid(1003), 3.5),  # sand-clay boundary on C
            ),
        ),
    ]
    edges = [
        ContactEdge(_uid(2), _uid(10)),  # silt-top on A ↔ B's single contact
        ContactEdge(_uid(3), _uid(10)),  # silt-base on A ↔ B's single contact
        ContactEdge(_uid(2), _uid(20)),  # silt-top on A ↔ C's single contact
        ContactEdge(_uid(3), _uid(20)),  # silt-base on A ↔ C's single contact
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 1
    lens = result[0]
    assert lens.contact_above_id == _uid(2)
    assert lens.contact_below_id == _uid(3)
    # Primary target = lowest-UUID investigation (B, _uid(200)) per the
    # algorithm's deterministic tie-break.
    assert lens.target_contact_id == _uid(10)
    assert lens.target_investigation_id == _uid(200)
    assert lens.source_investigation_id == _uid(100)
    assert lens.formation_id == _uid(1001)  # silt — the formation whose top is c2


def test_unilateral_pinch_out_does_not_create_lens() -> None:
    """A single pinch-out target is geometrically a wedge, not a lens.

    Reproduces the dogfeed 2026-05-31 case: user clicks ONE contact on a
    LEFT investigation, then TWO contacts (top + base) on a RIGHT
    investigation — the body on the right pinches out to the single
    left-side contact.  This used to fire a lens; owner directive says
    it should not, because the right side of the body is still
    unresolved (no closure on the opposite neighbour of A).

    A second target investigation is required for the body to be
    declared a lens — see ``test_happy_path_single_lens``.
    """
    stacks = [
        ContactStack(
            investigation_id=_uid(100),
            entries=(
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),  # body top
                ContactStackEntry(_uid(3), _uid(1002), 8.0),  # body base
            ),
        ),
        ContactStack(
            investigation_id=_uid(200),
            entries=(ContactStackEntry(_uid(10), _uid(1003), 3.0),),
        ),
    ]
    edges = [
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(3), _uid(10)),
    ]
    assert detect_lenses_from_graph(edges, stacks) == [], (
        "Single-target closure must NOT fire a lens (owner directive 2026-05-31)"
    )


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
        # Second target investigation needed for bilateral closure
        # (owner directive 2026-05-31) — without it the body never
        # qualifies as a lens regardless of thickness.
        ContactStack(_uid(300), (ContactStackEntry(_uid(20), _uid(1003), 3.5),)),
    ]
    edges = [
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(3), _uid(10)),
        ContactEdge(_uid(2), _uid(20)),
        ContactEdge(_uid(3), _uid(20)),
    ]
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
    """Three source contacts on A all edged to single contacts on TWO target
    investigations (B + C) → 2 stacked lens candidates (between contacts
    1-2 and 2-3).  Bilateral closure required per owner directive
    2026-05-31."""
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
        ContactStack(
            _uid(300),
            (ContactStackEntry(_uid(20), _uid(1004), 3.5),),
        ),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(3), _uid(10)),
        ContactEdge(_uid(1), _uid(20)),
        ContactEdge(_uid(2), _uid(20)),
        ContactEdge(_uid(3), _uid(20)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 2
    # Verify the two stacked pairs are present.
    pairs = {(c.contact_above_id, c.contact_below_id) for c in result}
    assert (_uid(1), _uid(2)) in pairs
    assert (_uid(2), _uid(3)) in pairs


def test_two_independent_lens_topologies() -> None:
    """Two unrelated lens topologies in the same model → 2 candidates.

    Each source body needs its own bilateral closure (≥2 target
    investigations) per owner directive 2026-05-31.
    """
    stacks = [
        ContactStack(
            _uid(100),
            (
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),
            ),
        ),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(1002), 3.0),)),
        ContactStack(_uid(150), (ContactStackEntry(_uid(15), _uid(1002), 3.0),)),
        ContactStack(
            _uid(300),
            (
                ContactStackEntry(_uid(20), _uid(1003), 4.0),
                ContactStackEntry(_uid(21), _uid(1004), 7.0),
            ),
        ),
        ContactStack(_uid(400), (ContactStackEntry(_uid(30), _uid(1005), 5.0),)),
        ContactStack(_uid(350), (ContactStackEntry(_uid(35), _uid(1005), 5.0),)),
    ]
    edges = [
        # Topology 1: body on _uid(100) closes to both _uid(200) and _uid(150).
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(1), _uid(15)),
        ContactEdge(_uid(2), _uid(15)),
        # Topology 2: body on _uid(300) closes to both _uid(400) and _uid(350).
        ContactEdge(_uid(20), _uid(30)),
        ContactEdge(_uid(21), _uid(30)),
        ContactEdge(_uid(20), _uid(35)),
        ContactEdge(_uid(21), _uid(35)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 2
