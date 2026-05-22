"""Unit tests for ``connected_formation_ids`` — BFS over the correlation graph.

Cases
-----
BFS1  Seed with no edges → singleton ``{seed}``.
BFS2  Linear chain A-B-C → all three reachable from any endpoint.
BFS3  Branching star (A connected to B, C, D) → full star reachable from A.
BFS4  Two disjoint components → seed only reaches its own component.
BFS5  Seed is NOT an endpoint in any edge but is isolated → ``{seed}``.
BFS6  Symmetric: A→B and B→A given two edge rows → no double-counting.

No DB, no I/O.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.resolve_litho_instances import (
    CorrelationEdge,
    connected_formation_ids,
)

_A = UUID("aaaaaaaa-0000-0000-0000-000000000000")
_B = UUID("bbbbbbbb-0000-0000-0000-000000000000")
_C = UUID("cccccccc-0000-0000-0000-000000000000")
_D = UUID("dddddddd-0000-0000-0000-000000000000")
_X = UUID("ee000000-0000-0000-0000-000000000000")
_Y = UUID("ff000000-0000-0000-0000-000000000000")


def _edge(a: UUID, b: UUID) -> CorrelationEdge:
    return CorrelationEdge(formation_a_id=a, formation_b_id=b)


def test_bfs1_singleton_no_edges() -> None:
    """BFS1: A seed with no edges returns only itself."""
    result = connected_formation_ids(_A, [])
    assert result == {_A}


def test_bfs2_linear_chain_from_left() -> None:
    """BFS2: A-B-C chain → full component reachable from A."""
    edges = [_edge(_A, _B), _edge(_B, _C)]
    assert connected_formation_ids(_A, edges) == {_A, _B, _C}


def test_bfs2_linear_chain_from_middle() -> None:
    """BFS2: A-B-C chain → full component reachable from B (middle)."""
    edges = [_edge(_A, _B), _edge(_B, _C)]
    assert connected_formation_ids(_B, edges) == {_A, _B, _C}


def test_bfs2_linear_chain_from_right() -> None:
    """BFS2: A-B-C chain → full component reachable from C."""
    edges = [_edge(_A, _B), _edge(_B, _C)]
    assert connected_formation_ids(_C, edges) == {_A, _B, _C}


def test_bfs3_star_from_centre() -> None:
    """BFS3: Star A-{B,C,D} → full star reachable from centre A."""
    edges = [_edge(_A, _B), _edge(_A, _C), _edge(_A, _D)]
    assert connected_formation_ids(_A, edges) == {_A, _B, _C, _D}


def test_bfs3_star_from_leaf() -> None:
    """BFS3: Star A-{B,C,D} → full star reachable from leaf B."""
    edges = [_edge(_A, _B), _edge(_A, _C), _edge(_A, _D)]
    assert connected_formation_ids(_B, edges) == {_A, _B, _C, _D}


def test_bfs4_disjoint_components_only_own() -> None:
    """BFS4: Two disjoint pairs — seed only reaches its own pair."""
    edges = [_edge(_A, _B), _edge(_X, _Y)]
    assert connected_formation_ids(_A, edges) == {_A, _B}
    assert connected_formation_ids(_X, edges) == {_X, _Y}


def test_bfs4_disjoint_seed_is_isolated() -> None:
    """BFS4: Seed not in any edge but another component exists → singleton."""
    edges = [_edge(_X, _Y)]
    assert connected_formation_ids(_A, edges) == {_A}


def test_bfs6_no_double_counting_on_symmetric_edges() -> None:
    """BFS6: Providing both directions A→B and B→A doesn't double-count."""
    # The DB enforces canonical ordering (a < b), but the BFS helper
    # should be safe even if both directions appear.
    edges = [_edge(_A, _B), _edge(_B, _A)]
    result = connected_formation_ids(_A, edges)
    assert result == {_A, _B}
    # Exactly 2 — no phantom duplicates.
    assert len(result) == 2
