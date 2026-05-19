"""Unit tests for resolve_litho_instances — the Phase-2 ordinal resolver.

Covers all 6 architect-mandated cases plus tiebreak determinism:

Case 1  — two disconnected singletons → each is body 1 in its group.
Case 2  — simple pair (one edge) → both share ordinal 1.
Case 3  — chain A-B-C (two edges) → all three in one component, ordinal 1.
Case 4  — two components in the same (parent, soil) group → ordinals 1 & 2
           assigned by earliest depth, shallowest component = 1.
Case 5  — locked ordinal in stable component → unchanged.
Case 6  — locked conflict → lower earliest depth wins, loser flagged.
Tiebreak — equal depth, different UUIDs → lexicographic UUID order is stable.

No DB, no I/O.  Runs in the pre-commit unit suite.
"""

from __future__ import annotations

from uuid import UUID

import pytest

from groundmodel.domain.services.resolve_litho_instances import (
    CorrelationEdge,
    FormationNode,
    LockConflict,
    resolve_litho_instances,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PARENT = UUID("00000000-0000-0000-0000-000000000001")
_PARENT2 = UUID("00000000-0000-0000-0000-000000000002")
_SAND = "ZAND"
_CLAY = "KLEI"


def _node(
    fid: UUID,
    *,
    parent: UUID | None = _PARENT,
    soil: str | None = _SAND,
    depth: float | None = None,
    ordinal: int | None = None,
    locked: bool = False,
) -> FormationNode:
    """Build a FormationNode with sensible defaults."""
    return FormationNode(
        formation_id=fid,
        parent_formation_id=parent,
        litho_main_soil_code=soil,
        earliest_contact_depth_m=depth,
        instance_ordinal=ordinal,
        instance_ordinal_locked=locked,
    )


def _edge(a: UUID, b: UUID) -> CorrelationEdge:
    """Build a CorrelationEdge; canonical ordering applied automatically."""
    lo, hi = (a, b) if a < b else (b, a)
    return CorrelationEdge(formation_a_id=lo, formation_b_id=hi)


# ---------------------------------------------------------------------------
# Case 1 — two disconnected singletons in the same group
# ---------------------------------------------------------------------------


def test_case1_two_singletons_each_body_1() -> None:
    """Two disconnected singletons → each receives ordinal 1 in their group.

    Even though they share (parent, soil_code), they are in separate
    connected components.  Each component is the sole representative
    at its depth level, so both start as component-rank 1.

    However: two singletons in the SAME group produce two components
    competing for ordinals 1 and 2.  The shallowest gets 1; the other gets 2.
    With no depth information (None → +inf) they are both "deepest", so
    lexicographic UUID order breaks the tie: the lexicographically smaller
    UUID gets ordinal 1.

    This test uses distinct parents so they are in DIFFERENT groups and
    each legitimately gets ordinal 1.
    """
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    nodes = [
        _node(a, parent=_PARENT, soil=_SAND),  # group 1
        _node(b, parent=_PARENT2, soil=_SAND),  # group 2
    ]
    result = resolve_litho_instances(formations=nodes, edges=[])
    assert result.ordinals[a] == 1
    assert result.ordinals[b] == 1
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Case 2 — simple pair connected by one edge
# ---------------------------------------------------------------------------


def test_case2_simple_pair_shares_ordinal_1() -> None:
    """Two formations connected by one edge → one component, ordinal 1."""
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    nodes = [_node(a, depth=5.0), _node(b, depth=10.0)]
    edges = [_edge(a, b)]
    result = resolve_litho_instances(formations=nodes, edges=edges)
    assert result.ordinals[a] == 1
    assert result.ordinals[b] == 1
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Case 3 — chain A-B-C (two edges)
# ---------------------------------------------------------------------------


def test_case3_chain_one_component_ordinal_1() -> None:
    """Chain A-B-C → one component of 3, all get ordinal 1."""
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    c = UUID("30000000-0000-0000-0000-000000000000")
    nodes = [_node(a, depth=1.0), _node(b, depth=5.0), _node(c, depth=9.0)]
    edges = [_edge(a, b), _edge(b, c)]
    result = resolve_litho_instances(formations=nodes, edges=edges)
    assert result.ordinals[a] == 1
    assert result.ordinals[b] == 1
    assert result.ordinals[c] == 1
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Case 4 — two components in the same group, ordered by depth
# ---------------------------------------------------------------------------


def test_case4_two_components_same_group_ordinals_by_depth() -> None:
    """Two disconnected components in the same (parent, soil) group.

    The component containing the shallowest member gets ordinal 1;
    the other gets ordinal 2.
    """
    # Component X: shallowest member at 2.0 m
    x1 = UUID("10000000-0000-0000-0000-000000000000")
    x2 = UUID("20000000-0000-0000-0000-000000000000")
    # Component Y: shallowest member at 8.0 m
    y1 = UUID("30000000-0000-0000-0000-000000000000")
    y2 = UUID("40000000-0000-0000-0000-000000000000")
    nodes = [
        _node(x1, depth=2.0),
        _node(x2, depth=5.0),
        _node(y1, depth=8.0),
        _node(y2, depth=12.0),
    ]
    edges = [_edge(x1, x2), _edge(y1, y2)]
    result = resolve_litho_instances(formations=nodes, edges=edges)
    # Shallower component (X) → ordinal 1
    assert result.ordinals[x1] == 1
    assert result.ordinals[x2] == 1
    # Deeper component (Y) → ordinal 2
    assert result.ordinals[y1] == 2
    assert result.ordinals[y2] == 2
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Case 4b — two SINGLETONS in the same group (no edges) — the common
# Phase-2 starting state, distinct from Case 4's connected pairs (C2)
# ---------------------------------------------------------------------------


def test_two_singletons_same_group_get_distinct_ordinals() -> None:
    """Two uncorrelated formations in the SAME (parent, soil) group are
    two singleton components → ordinals 1 and 2 by earliest depth.

    Before any edge is drawn every per-test occurrence is its own
    singleton; they must auto-number within the group (shallowest = 1),
    NOT all collapse to body 1 (review C2). Case 1 deliberately uses
    different parents; Case 4 uses connected pairs — this pins the
    singleton-as-component path in a single group.
    """
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    nodes = [
        _node(a, parent=_PARENT, soil=_SAND, depth=9.0),  # deeper → 2
        _node(b, parent=_PARENT, soil=_SAND, depth=2.0),  # shallower → 1
    ]
    result = resolve_litho_instances(formations=nodes, edges=[])
    assert result.ordinals[b] == 1
    assert result.ordinals[a] == 2
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Case 5 — locked ordinal in a stable (no-conflict) component
# ---------------------------------------------------------------------------


def test_case5_locked_ordinal_unchanged_in_stable_component() -> None:
    """A locked formation keeps its ordinal when no conflict exists."""
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    # Two separate singleton components in the same group.
    # Formation A is locked to ordinal 2 (unusual but valid).
    nodes = [
        _node(a, depth=1.0, ordinal=2, locked=True),
        _node(b, depth=5.0),
    ]
    result = resolve_litho_instances(formations=nodes, edges=[])
    # Locked formation keeps its ordinal.
    assert result.ordinals[a] == 2
    # Auto-assigned formation gets the next ordinal not claimed by a lock.
    # Group has two components; the shallowest (a) is locked to 2, so the
    # auto counter starts at 1 and skips 2 → b gets 1.
    assert result.ordinals[b] == 1
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Case 6 — locked conflict inside one component
# ---------------------------------------------------------------------------


def test_case6_locked_conflict_lower_depth_wins() -> None:
    """Two locked formations in the same component with the same ordinal.

    The formation with lower earliest_contact_depth_m wins.  The loser
    is recorded as a LockConflict.
    """
    # Both share the same claimed ordinal 1.
    # Formation A is shallower (depth 3.0) → A wins.
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    nodes = [
        _node(a, depth=3.0, ordinal=1, locked=True),
        _node(b, depth=7.0, ordinal=1, locked=True),
    ]
    edges = [_edge(a, b)]
    result = resolve_litho_instances(formations=nodes, edges=edges)
    # Both are in one component; component ordinal = 1 (the lock winner's).
    assert result.ordinals[a] == 1
    assert result.ordinals[b] == 1
    # One conflict recorded — B is the loser.
    assert len(result.lock_conflicts) == 1
    conflict: LockConflict = result.lock_conflicts[0]
    assert conflict.winner_formation_id == a
    assert conflict.loser_formation_id == b
    assert conflict.contested_ordinal == 1


# ---------------------------------------------------------------------------
# Tiebreak determinism — equal depth, different UUIDs
# ---------------------------------------------------------------------------


def test_tiebreak_equal_depth_lexicographic_uuid_order() -> None:
    """Equal depth → lexicographically smaller UUID gets the lower ordinal."""
    # UUID "10..." < "20..." lexicographically.
    lo = UUID("10000000-0000-0000-0000-000000000000")
    hi = UUID("20000000-0000-0000-0000-000000000000")
    # Both singletons in the same group, same depth.
    nodes = [
        _node(lo, depth=5.0),
        _node(hi, depth=5.0),
    ]
    result = resolve_litho_instances(formations=nodes, edges=[])
    # "lo" has lexicographically smaller UUID → gets ordinal 1.
    assert result.ordinals[lo] == 1
    assert result.ordinals[hi] == 2
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Additional: no-depth formations sort after real depths
# ---------------------------------------------------------------------------


def test_no_depth_formation_gets_highest_ordinal() -> None:
    """A formation with no contacts (depth=None) sorts after all real depths."""
    a = UUID("10000000-0000-0000-0000-000000000000")
    b = UUID("20000000-0000-0000-0000-000000000000")
    # a has a real depth; b has no contacts yet.
    nodes = [
        _node(a, depth=5.0),
        _node(b, depth=None),
    ]
    result = resolve_litho_instances(formations=nodes, edges=[])
    assert result.ordinals[a] == 1  # real depth → shallower → ordinal 1
    assert result.ordinals[b] == 2  # no depth → treated as +inf → ordinal 2
    assert result.lock_conflicts == []


# ---------------------------------------------------------------------------
# Additional: #57-class guard — correlations are model-level, not section-level
# ---------------------------------------------------------------------------


def test_resolver_has_no_section_or_seeded_contact_ids() -> None:
    """resolver output has no seeded_formation_contact_ids attribute.

    Structural guard: resolve_litho_instances operates on FormationNodes
    and CorrelationEdges — model-level entities.  Its ResolveResult must
    never carry anything section-related, confirming the #57 trap
    (applyUpdatedSection / seeded_formation_contact_ids) cannot occur
    here by design.
    """
    a = UUID("10000000-0000-0000-0000-000000000000")
    result = resolve_litho_instances(formations=[_node(a)], edges=[])
    assert not hasattr(result, "seeded_formation_contact_ids")
    assert not hasattr(result, "updated_section")
    assert not hasattr(result, "section_id")
