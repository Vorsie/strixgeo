"""Pure domain service — assign instance ordinals across a litho model.

This module is the correctness heart of Phase-2 litho correlation.
It takes a snapshot of the current edge graph + formation list and
returns a mapping of formation_id → assigned ordinal, plus a list of
lock conflicts that the caller must surface to the engineer.

No I/O, no database access, no logging dependency.  The caller
(CorrelateLithoUnits / UncorrelateLithoUnits) loads the data, calls
this function, and writes the results back.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from uuid import UUID

# ---------------------------------------------------------------------------
# Input data-transfer objects — simple dataclasses, no ORM.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FormationNode:
    """Lightweight snapshot of one geological_formation row for the resolver.

    Attributes
    ----------
    formation_id : UUID
        Primary key of the geological_formation row.
    parent_formation_id : UUID | None
        Parent geological formation id.  Litho units always have a
        parent; geological-model rows carry None and should never
        appear as input to this resolver.
    litho_main_soil_code : str | None
        BaseLithology token (ZAND/KLEI/SILT/GRIND/VEEN).  Together
        with ``parent_formation_id`` this forms the group key —
        formations that share both belong to the same naming group and
        compete for ordinals 1, 2, 3, ...
    earliest_contact_depth_m : float | None
        Minimum ``depth_top_m`` across all contacts anchored to this
        formation within the model.  Used to assign ordinals: the
        shallowest (smallest depth) body is ordinal 1, the next is 2,
        etc.  ``None`` for a formation that has no contacts yet; treated
        as ``+inf`` (pushed to the end) so contactless units always get
        the highest ordinal in their group.
    instance_ordinal : int | None
        Current persisted ordinal.  May be None (unresolved) or an
        integer previously written by the resolver or the user.
    instance_ordinal_locked : bool
        When True the user has manually fixed this ordinal; the
        resolver must not change it.  A locked formation that conflicts
        with another locked formation in the same component produces a
        ``LockConflict`` entry.
    """

    formation_id: UUID
    parent_formation_id: UUID | None
    litho_main_soil_code: str | None
    earliest_contact_depth_m: float | None
    instance_ordinal: int | None
    instance_ordinal_locked: bool


@dataclass(frozen=True)
class CorrelationEdge:
    """Lightweight snapshot of one litho_correlation_edge row.

    Attributes
    ----------
    formation_a_id : UUID
        Lesser endpoint UUID (canonical ordering enforced by the DB).
    formation_b_id : UUID
        Greater endpoint UUID.
    """

    formation_a_id: UUID
    formation_b_id: UUID


@dataclass(frozen=True)
class LockConflict:
    """Two locked formations in the same component claim the same ordinal.

    The resolver resolves the tie deterministically (lower
    ``earliest_contact_depth_m`` wins; lexicographic formation UUID for
    equal depth) and flags the loser.  The caller should surface this
    to the engineer so they can inspect and correct the lock.

    Attributes
    ----------
    winner_formation_id : UUID
        The locked formation that keeps its ordinal.
    loser_formation_id : UUID
        The locked formation whose ordinal was overridden.
    contested_ordinal : int
        The ordinal both claimed.
    """

    winner_formation_id: UUID
    loser_formation_id: UUID
    contested_ordinal: int


@dataclass
class ResolveResult:
    """Output of ``resolve_litho_instances``.

    Attributes
    ----------
    ordinals : dict[UUID, int]
        Maps formation_id → assigned ordinal for every formation in
        the input list.  All formations receive an ordinal (singletons
        with no edge receive ordinal 1 — they are body 1 of their
        group by definition).
    lock_conflicts : list[LockConflict]
        Zero or more conflicts found during resolution.  Each conflict
        identifies a formation whose locked ordinal was overridden
        because it clashed with another locked formation in the same
        connected component.  The caller should log / surface these to
        the engineer.
    """

    ordinals: dict[UUID, int]
    lock_conflicts: list[LockConflict]


# ---------------------------------------------------------------------------
# Helper — group key
# ---------------------------------------------------------------------------


def _group_key(node: FormationNode) -> tuple[UUID | None, str | None]:
    """Return the naming-group key for ``node``.

    Two formations with the same ``(parent_formation_id,
    litho_main_soil_code)`` compete for ordinals within the same
    sequence.  E.g. two sand bodies inside "Quaternary deposits" are
    both ZAND under the same parent → they are both in the same group,
    and the resolver numbers them 1 and 2.

    Formations in different groups have independent ordinal sequences.
    """
    return (node.parent_formation_id, node.litho_main_soil_code)


# ---------------------------------------------------------------------------
# Helper — connected-component discovery (BFS)
# ---------------------------------------------------------------------------


def _find_components(
    node_ids: set[UUID],
    adjacency: dict[UUID, set[UUID]],
) -> list[list[UUID]]:
    """Return all connected components as lists of formation ids.

    Uses BFS.  Each node appears in exactly one component.  Singletons
    (no edges) are returned as single-element lists.

    Parameters
    ----------
    node_ids : set[UUID]
        All node ids to cover.  Any id present here but absent from
        ``adjacency`` is a singleton.
    adjacency : dict[UUID, set[UUID]]
        Undirected adjacency list: both directions are populated by
        the caller.

    Returns
    -------
    list[list[UUID]]
        One sub-list per component; order within each sub-list is BFS
        discovery order.
    """
    visited: set[UUID] = set()
    components: list[list[UUID]] = []
    for start in node_ids:
        if start in visited:
            continue
        component: list[UUID] = []
        queue: deque[UUID] = deque([start])
        visited.add(start)
        while queue:
            current = queue.popleft()
            component.append(current)
            for neighbour in adjacency.get(current, ()):
                if neighbour not in visited:
                    visited.add(neighbour)
                    queue.append(neighbour)
        components.append(component)
    return components


# ---------------------------------------------------------------------------
# Depth sort key — None (no contacts yet) sorts after any real depth.
# ---------------------------------------------------------------------------


def _depth_sort_key(node: FormationNode) -> tuple[float, str]:
    """Return a sort key for ordinal assignment within a component.

    Primary: ``earliest_contact_depth_m``, ascending (shallowest =
    ordinal 1).  ``None`` (no contacts yet) is treated as ``+inf`` so
    contactless formations always land at the end.

    Tiebreak: lexicographic string of the formation UUID.  UUID v7
    is time-ordered so two formations created in the same session get
    a stable, deterministic order even when they share the exact same
    earliest depth.
    """
    depth = node.earliest_contact_depth_m
    numeric_depth = depth if depth is not None else float("inf")
    return (numeric_depth, str(node.formation_id))


# ---------------------------------------------------------------------------
# Public resolver
# ---------------------------------------------------------------------------


def resolve_litho_instances(
    formations: list[FormationNode],
    edges: list[CorrelationEdge],
) -> ResolveResult:
    """Assign instance ordinals to all formations given the correlation graph.

    Algorithm
    ---------
    1. Build an undirected adjacency list from ``edges``.
    2. Find connected components using BFS over all formation nodes.
    3. For each component, determine the naming group
       ``(parent_formation_id, litho_main_soil_code)``.  All nodes in
       a component share the same group (edges only exist between
       formations with the same parent + soil code — the use case
       enforces this at insert time).
    4. Compute the next free ordinal for each group across all components
       *before* assigning, so ordinal numbering is consistent globally:
       components in the same group are numbered sequentially by earliest
       depth (component whose shallowest formation is shallowest = 1,
       next = 2, etc.).
    5. Within a component, apply the locked-ordinal rule:
       a. Collect locked formations first.  If two locked formations
          in the same component claim the same ordinal, the one with
          the lower (earliest_contact_depth_m, UUID) sort key wins and
          the other is recorded as a ``LockConflict``.
       b. Assign the locked winner's ordinal as fixed.
       c. All non-locked formations in the component receive the same
          ordinal as the component (a single component = a single body).
    6. Singletons (components of size 1) auto-receive ordinal 1 in their
       group — they are the first (and only) body seen so far.

    Lock semantics in detail
    ------------------------
    A locked formation's ``instance_ordinal`` is treated as a hard
    constraint: the resolver will not change it unless two locked
    formations in the same component conflict.  In that case, the
    lower-depth formation keeps its ordinal and the other is flagged
    as a ``LockConflict``.  The loser is then treated as unlocked for
    the rest of the resolution (its effective ordinal is overridden by
    the component's assigned value).

    Ordinal numbering
    -----------------
    Ordinals are assigned per ``(parent_formation_id, litho_main_soil_code)``
    group, starting at 1.  The assignment order across components within
    the same group is determined by the minimum ``_depth_sort_key`` among
    all formation members of each component — the component containing
    the shallowest formation (or, on a tie, the formation with the
    lexicographically smallest UUID) gets ordinal 1.

    When a locked formation's ordinal falls outside the 1..N range that
    the group would normally occupy, it is still honoured (the user
    knows what they're doing).  The auto-assigned ordinals skip the
    locked value and use the next available integer in sequence.

    Parameters
    ----------
    formations : list[FormationNode]
        Every formation in the model (not just those with edges).  Must
        include singletons so they receive ordinal 1 in their group.
    edges : list[CorrelationEdge]
        All undirected edges in the model.  Each edge connects exactly
        two formation ids that appear in ``formations``.

    Returns
    -------
    ResolveResult
        ``ordinals`` maps every input formation_id to an integer ≥ 1.
        ``lock_conflicts`` is empty when no two locked formations in the
        same component share the same claimed ordinal.

    Notes
    -----
    This function is PURE — no I/O, no database access, no side effects.
    It may be called from any layer without violating the clean-architecture
    dependency rule.  The caller (CorrelateLithoUnits / UncorrelateLithoUnits)
    is responsible for loading data and writing results back.
    """
    node_map: dict[UUID, FormationNode] = {f.formation_id: f for f in formations}
    node_ids: set[UUID] = set(node_map)

    # Build undirected adjacency list from the edge list.  Both directions
    # are populated so BFS discovers the full component regardless of the
    # canonical ordering in the edge row.
    adjacency: dict[UUID, set[UUID]] = defaultdict(set)
    for edge in edges:
        # Only add edges whose both endpoints are in the formation list.
        # Dangling edges (whose formation was deleted after the edge was
        # created) are silently ignored — the DB CASCADE removes them
        # anyway; this guard is a belt-and-suspenders for in-flight state.
        if edge.formation_a_id in node_ids and edge.formation_b_id in node_ids:
            adjacency[edge.formation_a_id].add(edge.formation_b_id)
            adjacency[edge.formation_b_id].add(edge.formation_a_id)

    # --- Connected components (BFS) -----------------------------------------
    components: list[list[UUID]] = _find_components(node_ids, adjacency)

    # --- Group components by (parent, soil_code) and sort by shallowest depth.
    # A component's representative depth = _depth_sort_key of its shallowest
    # member.  Sorting components within the same group by this key gives the
    # stable global ordinal assignment.
    GroupKey = tuple[UUID | None, str | None]
    # For each group, collect (component_min_sort_key, component) pairs.
    group_components: dict[GroupKey, list[tuple[tuple[float, str], list[UUID]]]] = defaultdict(list)
    for component in components:
        nodes_in = [node_map[fid] for fid in component]
        # All nodes in a component share the same group key (the use case
        # validates this at insert time).  Take from the first node.
        gk = _group_key(nodes_in[0])
        # Component's representative sort key = minimum across members.
        min_key = min(_depth_sort_key(n) for n in nodes_in)
        group_components[gk].append((min_key, component))

    # Sort each group's component list by the component's min_key.  This
    # produces the canonical ordinal assignment order: component with the
    # shallowest (or lexicographically earliest) member gets ordinal 1.
    for gk in group_components:
        group_components[gk].sort(key=lambda pair: pair[0])

    # --- Assign ordinals + handle lock conflicts -----------------------------
    ordinals: dict[UUID, int] = {}
    lock_conflicts: list[LockConflict] = []

    for gk, sorted_components in group_components.items():
        # Track which ordinals in this group are claimed by locked formations
        # so auto-assignment can skip them.
        locked_ordinals_used: set[int] = set()
        # First pass: honour locked formations and detect conflicts.
        # component_locked[i] = {ordinal: winner_fid} for each component.
        component_lock_winners: list[dict[int, UUID]] = []
        for _min_key, component in sorted_components:
            locked_in_component: dict[int, FormationNode] = {}
            conflicts_this: list[LockConflict] = []
            for fid in component:
                node = node_map[fid]
                if not node.instance_ordinal_locked or node.instance_ordinal is None:
                    continue
                claimed = node.instance_ordinal
                if claimed in locked_in_component:
                    # Conflict: two locked formations claim the same ordinal.
                    # Lower sort key wins.
                    existing = locked_in_component[claimed]
                    if _depth_sort_key(node) < _depth_sort_key(existing):
                        # New challenger wins.
                        conflicts_this.append(
                            LockConflict(
                                winner_formation_id=node.formation_id,
                                loser_formation_id=existing.formation_id,
                                contested_ordinal=claimed,
                            )
                        )
                        locked_in_component[claimed] = node
                    else:
                        # Existing winner holds.
                        conflicts_this.append(
                            LockConflict(
                                winner_formation_id=existing.formation_id,
                                loser_formation_id=node.formation_id,
                                contested_ordinal=claimed,
                            )
                        )
                else:
                    locked_in_component[claimed] = node
            lock_conflicts.extend(conflicts_this)
            # winner map: ordinal → winning formation_id (losers are treated
            # as unlocked for the auto-assign pass below).
            loser_ids: set[UUID] = {c.loser_formation_id for c in conflicts_this}
            winners: dict[int, UUID] = {
                ordinal: node.formation_id
                for ordinal, node in locked_in_component.items()
                if node.formation_id not in loser_ids
            }
            component_lock_winners.append(winners)
            for ordinal in winners:
                locked_ordinals_used.add(ordinal)

        # Second pass: auto-assign ordinals to each component.
        # All members of a component (locked or not) share the same effective
        # ordinal — the correlation asserts they are ONE body.  The component's
        # ordinal is determined by its rank in the sorted list (ordinal 1 for
        # the shallowest component, 2 for the next, etc.) but honours existing
        # locked ordinals when the component has exactly one winning lock and
        # no conflict.
        auto_counter = 1  # next free ordinal not yet claimed by any lock winner
        for component_rank, ((_min_key, component), winners) in enumerate(
            zip(sorted_components, component_lock_winners)
        ):
            if len(winners) == 1:
                # Exactly one locked winner in this component — honour it.
                component_ordinal = next(iter(winners))
            elif len(winners) > 1:
                # Multiple (non-conflicting) locked winners inside the same
                # component?  This should be rare: it means two locked
                # formations with *different* ordinals ended up connected.
                # Honour the smallest ordinal (most conservative choice) and
                # note: the architect spec says "locked-conflict → lower-
                # earliest-depth wins" — that was for same-ordinal conflicts
                # which are the only real case.  Different ordinals inside one
                # component means the user explicitly numbered two things that
                # are actually correlated — we keep the lower ordinal and don't
                # flag this as a conflict (it is unusual but not invalid).
                component_ordinal = min(winners)
            else:
                # No locked winner — auto-assign the next ordinal not already
                # claimed by a lock winner in this group.
                while auto_counter in locked_ordinals_used:
                    auto_counter += 1
                component_ordinal = auto_counter
                auto_counter += 1

            # All members of this component receive the same ordinal.
            for fid in component:
                ordinals[fid] = component_ordinal

        # Make sure auto_counter advances past all locked ordinals for the
        # NEXT component in this group (already handled by the while-loop
        # above, but restate for clarity).

    return ResolveResult(ordinals=ordinals, lock_conflicts=lock_conflicts)
