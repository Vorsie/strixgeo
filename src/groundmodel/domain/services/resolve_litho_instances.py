"""Pure domain service — assign instance ordinals over a litho model.

An *instance* is one connected component of correlated litho layers. Two
layers belong to the same instance iff a path of user-approved correlation
edges connects them AND they share a lithology. Uncorrelated layers —
including two same-formation layers stacked at one column, or two laterally-
separate columns never linked — are distinct instances and receive distinct
ordinals.

One-lithology invariant (owner directive 2026-06-03): a body is a single
lithology. An edge whose two endpoints have different ``litho_main_soil_code``
is dropped from the adjacency graph, so a mis-correlation (or auto-correlate
crossing a facies change) never merges, say, a clay layer and a silt layer
into one mixed body. Admixture variants of the SAME soil (different formation
rows, same ``litho_main_soil_code``) still merge.

A2 — geological-formation independence (owner directive 2026-06-04): the
former one-geological-formation invariant is REVERSED. A body MAY span a
geological-formation boundary; ``parent_formation_id`` no longer drops edges.
A continuous sand correlated across the Holocene/Pleistocene boundary is ONE
body. The geological name becomes a derived, majority-overlap label on the
body (computed by the use-case / API), not an identity constraint. Lithology
remains the only edge filter, so merging stays edge-driven and user-controlled
(the Boom-Klei-on-clay case stays two bodies because the engineer does not
correlate across that contact).

Ordinals are assigned per ``litho_main_soil_code`` naming group, shallowest
component first, starting at 0. The component with the shallowest member is
ordinal 0, the next is 1, and so on. This matches the depth-rank the section
renderer computes for body labels (Sa1 = shallowest sand instance, Sa2 next),
regardless of which geological formation each instance falls in.

No I/O, no database access, no logging. The caller
(``ResolveLithoInstances`` use case) loads the data, calls this function, and
writes the results back (creating/reconciling body rows + stamping
``litho_layer.body_id``).

The layer-level resolver groups nodes with a CONSTRAINED union-find (cannot-link
constraints from user "Separate" rulings, debt #278 R5) — see
``_constrained_components``. It does NOT use ``_bfs_reachable``.

This module also hosts ``connected_formation_ids`` (+ its ``CorrelationEdge``
input DTO), a separate pure BFS helper consumed by
``application.propagate_litho_admixtures`` to walk the formation-level
correlation graph. It is intentionally kept distinct from the layer-level
resolver above (different node kind, different filters, different traversal):
``connected_formation_ids`` is the only remaining caller of ``_bfs_reachable``.
"""

from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class LayerNode:
    """Lightweight snapshot of one accepted litho_layer row.

    Attributes
    ----------
    layer_id : UUID
        Primary key of the litho_layer row. Also the id the correlation
        edge endpoints reference (edges FK litho_layer.id post-A4).
    formation_id : UUID
        The layer's naming-type formation row.
    parent_formation_id : UUID | None
        Parent geological formation. A2: NO longer a resolver filter or part of
        the naming group — retained only so the use-case layer can derive the
        body's majority geological label. May be ``None`` (A2 litho units are
        geologically agnostic; the association is set, if at all, as a later
        annotation).
    litho_main_soil_code : str | None
        Base lithology token (ZAND/KLEI/SILT/GRIND/VEEN).
    depth_top_m : float
        Top depth of the layer interval; the ordinal sort key.
    source_investigation_id : UUID
        The layer's anchor investigation (borehole_id or cpt_id).
    packing_formation_id : UUID | None
        The PACKING CLASS row, for a geotechnical model's band. ``None`` for a
        litho layer, which has no packing class — the soil filter alone decides
        there, exactly as before. Owner, 2026-08-19: *"if a lens is touching a
        body with same litho and packing then lens disappears and it becomes one
        body, in the renderer and in the database"* — a geotech body is one soil
        AND one packing density, so two sand bands of different densities are
        two bodies however they are tied.
    packing_nad_class : int | None
        The band's NAD packing class (1–31), or ``None`` for a litho layer or a
        skeleton band that carries none. The model stores one packing formation
        ROW per (class, litho parent, GEOLOGICAL parent), so the same class
        exists under several row ids — and the mass comparison the owner ruled
        (2026-08-21: *"yes one mass one body"*) is the CLASS, not the row.
        Where both ends carry a class, the class decides; where either does
        not, the row comparison stands (two unknowns are not known equal).
    """

    layer_id: UUID
    formation_id: UUID
    parent_formation_id: UUID | None
    litho_main_soil_code: str | None
    depth_top_m: float
    source_investigation_id: UUID
    packing_formation_id: UUID | None = None
    packing_nad_class: int | None = None


@dataclass(frozen=True)
class LayerEdge:
    """One user-approved correlation edge between two layers.

    Attributes
    ----------
    layer_a_id : UUID
        One endpoint (litho_layer id).
    layer_b_id : UUID
        The other endpoint (litho_layer id).
    """

    layer_a_id: UUID
    layer_b_id: UUID


@dataclass(frozen=True)
class LayerSeparation:
    """One user "Separate" ruling — a cannot-link constraint between two layers.

    Owner ruling 2026-08-31 (debt #278, R5): the "Separate" verb is the
    counterpart to Dissolve, so the engineer can state *"these two are NOT the
    same body"* and have the resolver honour it PERMANENTLY. Where a
    ``LayerEdge`` (a tie or a geometry fact) UNIONS its two layers, a separation
    FORBIDS its two anchors from ever landing in one body — even when a chain of
    edges would otherwise connect them.

    The constraint is expressed in LAYER-id space, never body-id space: body ids
    re-mint on every resolve (the ``(formation, ordinal)`` key recycles rows), so
    a body-anchored constraint would bind the wrong mass after the next
    renumbering. Anchoring on the layer rows survives that.

    Attributes
    ----------
    layer_a_id : UUID
        One anchor (litho_layer id). Order is irrelevant to the constraint — the
        two anchors simply may not share a body.
    layer_b_id : UUID
        The other anchor (litho_layer id).
    """

    layer_a_id: UUID
    layer_b_id: UUID


@dataclass(frozen=True)
class InstanceAssignment:
    """One resolved instance (connected component of layers).

    Attributes
    ----------
    formation_id : UUID
        Representative formation row = the shallowest member layer's
        formation. The reconciled body uses this as its formation_id.
    ordinal : int
        0-based ordinal within the ``(parent, soil)`` naming group
        (0 = shallowest instance in the group).
    member_layer_ids : list[UUID]
        Every layer in this component (each gets ``body_id`` stamped).
    source_investigation_id : UUID
        The shallowest member layer's investigation — the body's source.
    earliest_depth_m : float
        The shallowest member layer's ``depth_top_m``.
    """

    formation_id: UUID
    ordinal: int
    member_layer_ids: list[UUID]
    source_investigation_id: UUID
    earliest_depth_m: float


@dataclass
class ResolveResult:
    """Output of ``resolve_litho_instances``.

    Attributes
    ----------
    instances : list[InstanceAssignment]
        One entry per connected component.
    layer_to_ordinal : dict[UUID, int]
        layer_id -> its instance ordinal (convenience for callers/tests).
    layer_to_formation : dict[UUID, UUID]
        layer_id -> its instance's representative formation_id (the body's
        formation; may differ from the layer's own formation_id when a
        component spans admixtures).
    """

    instances: list[InstanceAssignment]
    layer_to_ordinal: dict[UUID, int]
    layer_to_formation: dict[UUID, UUID]


def _bfs_reachable(seed: UUID, adjacency: dict[UUID, set[UUID]]) -> list[UUID]:
    """Return every node reachable from ``seed``, in BFS discovery order.

    Traversal core for :func:`connected_formation_ids` (the formation-level
    correlation graph). The layer-level resolver no longer uses it — it groups
    nodes with the constrained union-find in :func:`_constrained_components`, so
    a user "Separate" ruling can cut an edge BFS would blindly follow.

    Parameters
    ----------
    seed : UUID
        Node to start from. Always included (first) in the result.
    adjacency : dict[UUID, set[UUID]]
        Undirected adjacency list (both directions populated by the caller).
        A seed absent from ``adjacency`` yields ``[seed]``.

    Returns
    -------
    list[UUID]
        The connected component containing ``seed``, in discovery order.
    """
    visited: set[UUID] = {seed}
    order: list[UUID] = []
    queue: deque[UUID] = deque([seed])
    while queue:
        cur = queue.popleft()
        order.append(cur)
        for nb in adjacency.get(cur, ()):
            if nb not in visited:
                visited.add(nb)
                queue.append(nb)
    return order


def _constrained_components(
    node_ids: set[UUID],
    edges: list[tuple[UUID, UUID]],
    separations: list[tuple[UUID, UUID]],
) -> list[list[UUID]]:
    """Connected components under user "Separate" (cannot-link) constraints.

    Plain connectivity would union every layer reachable by an edge. A
    separation FORBIDS its two anchors from sharing a body, so this is a
    constrained union-find: an edge whose union would place both sides of one
    separation under a single root is SKIPPED rather than applied.

    Determinism note: without constraints, connected components are independent
    of the order edges are processed. WITH cannot-link constraints they are NOT —
    which of two competing edges is dropped depends on which is seen first. The
    caller therefore sorts ``edges`` canonically before calling this, and that
    sort IS the determinism guarantee.

    Parameters
    ----------
    node_ids : set[UUID]
        Every layer id to cover. An id touched by no surviving edge is a
        singleton component.
    edges : list[tuple[UUID, UUID]]
        Surviving edges (already filtered by lithology / packing / dangling
        guards AND sorted canonically) as ``(u, v)`` pairs.
    separations : list[tuple[UUID, UUID]]
        Live cannot-link pairs (already filtered so both anchors are in
        ``node_ids`` — a dangling anchor is inert and must be dropped by the
        caller).

    Returns
    -------
    list[list[UUID]]
        One sub-list per component. Members within a component are in ascending
        ``str(id)`` order (deterministic; the grouping, not the order, is what
        downstream ordinal assignment consumes).
    """
    parent: dict[UUID, UUID] = {n: n for n in node_ids}
    # root -> {separation_index -> set of sides ('A' / 'B') present under it}.
    # The invariant maintained below: no single root ever holds BOTH sides of
    # one separation, because the union that would create that is skipped.
    incidence: dict[UUID, dict[int, set[str]]] = {}

    def find(x: UUID) -> UUID:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:  # path compression
            parent[x], x = root, parent[x]
        return root

    # Seed each anchor's singleton root with its side BEFORE any edge is unioned,
    # so the constraints are active from the very first union.
    for idx, (a, b) in enumerate(separations):
        incidence.setdefault(find(a), {}).setdefault(idx, set()).add("A")
        incidence.setdefault(find(b), {}).setdefault(idx, set()).add("B")

    for u, v in edges:
        ru, rv = find(u), find(v)
        if ru == rv:
            continue
        inc_u = incidence.get(ru, {})
        inc_v = incidence.get(rv, {})
        # Would merging give some separation both its sides under one root?
        # Only indices present on BOTH roots can newly complete the pair.
        if any(inc_u[i] | inc_v[i] == {"A", "B"} for i in inc_u.keys() & inc_v.keys()):
            continue  # honour the user's "these two are NOT the same body"
        # Union: keep the root carrying the LARGER incidence map so the smaller
        # one is what gets copied across (fewer entries to merge).
        if len(inc_u) < len(inc_v):
            ru, rv, inc_u, inc_v = rv, ru, inc_v, inc_u
        parent[rv] = ru
        if inc_v:
            dest = incidence.setdefault(ru, {})
            for i, sides in inc_v.items():
                dest.setdefault(i, set()).update(sides)
            incidence.pop(rv, None)

    groups: dict[UUID, list[UUID]] = defaultdict(list)
    for n in sorted(node_ids, key=str):
        groups[find(n)].append(n)
    return list(groups.values())


def resolve_litho_instances(
    layers: list[LayerNode],
    edges: list[LayerEdge],
    separations: Sequence[LayerSeparation] = (),
) -> ResolveResult:
    """Resolve instances (connected components) and assign group ordinals.

    Parameters
    ----------
    layers : list[LayerNode]
        Every accepted layer in the model (singletons included).
    edges : list[LayerEdge]
        User-approved correlation edges (layer-id endpoints). Endpoints not
        present in ``layers`` are ignored (dangling-edge guard).
    separations : Sequence[LayerSeparation], optional
        User "Separate" rulings — cannot-link constraints (debt #278, R5).
        Each forbids its two anchors from ever landing in one body, even when a
        chain of edges would otherwise connect them. A separation whose anchor is
        absent from ``layers`` this run is INERT (the dangling-anchor mirror of
        the dangling-edge guard). Default empty: the litho/geotech resolve is
        byte-identical to plain connectivity when the engineer has separated
        nothing.

    Returns
    -------
    ResolveResult
        Instances + the layer->ordinal / layer->formation lookups.

    Notes
    -----
    Pure function — no I/O. Safe to call from any layer.
    """
    node_map: dict[UUID, LayerNode] = {ln.layer_id: ln for ln in layers}
    node_ids: set[UUID] = set(node_map)

    surviving_edges: list[tuple[UUID, UUID]] = []
    for e in edges:
        a = node_map.get(e.layer_a_id)
        b = node_map.get(e.layer_b_id)
        if a is None or b is None:
            continue  # dangling-edge guard (endpoint not in this model)
        # One-lithology invariant: a body is a single lithology. Drop an edge
        # that joins two DIFFERENT lithologies — a mis-correlation, or auto-
        # correlate crossing a facies change — so the two never merge into one
        # mixed body (dogfeed 2026-06-03: a clay layer grouped into a silt body
        # was painted green). Admixture variants of the SAME soil still merge,
        # because the comparison keys on ``litho_main_soil_code``, not formation.
        if a.litho_main_soil_code != b.litho_main_soil_code:
            continue
        # SAME LITHO **AND PACKING** for a geotechnical model (owner, 2026-08-19).
        # A band carries its packing class; a litho layer carries none, so this
        # is inert on the litho model and the soil filter above stands alone
        # there. Where both ends carry one and they differ, the tie states a
        # CONTACT between two masses, not one mass — the same reading the fill
        # uses when it emits an onlap instead of nothing.
        #
        # "Packing" is the CLASS, never the formation ROW (owner 2026-08-21:
        # *"yes one mass one body"*): the model keeps one packing formation row
        # per (class, litho parent, GEOLOGICAL parent), so the same NAD class
        # exists under several row ids and comparing rows silently split every
        # body tied across a geological boundary — the exact case the A2 note
        # below says MUST stay one body. Where either end's class is unknown
        # (a skeleton band), the row comparison stands: two unknowns are not
        # known to be the same density.
        if a.packing_formation_id is not None and b.packing_formation_id is not None:
            if a.packing_nad_class is not None and b.packing_nad_class is not None:
                if a.packing_nad_class != b.packing_nad_class:
                    continue
            elif a.packing_formation_id != b.packing_formation_id:
                continue
        # A2 (owner directive 2026-06-04): the one-geological-formation invariant
        # is REVERSED. A same-lithology body MAY span a geological boundary — a
        # continuous sand correlated across the Holocene/Pleistocene line is ONE
        # body. The geological name is a derived, majority-overlap label on the
        # body (computed by the use-case / API), not an identity constraint, so
        # the parent_formation_id no longer drops edges. Lithology is the only
        # surviving filter. The Boom-Klei-on-clay case stays two bodies because
        # the engineer does not correlate across that contact (merging is
        # edge-driven, never lithology-alone).
        surviving_edges.append((e.layer_a_id, e.layer_b_id))

    # Determinism: with the cannot-link constraints below, the partition depends
    # on the order edges are unioned. Sorting the surviving edges canonically
    # (by their two endpoints as strings) fixes that order, so the resolved
    # bodies are the same whatever order the edges arrived from the DB.
    surviving_edges.sort(key=lambda uv: (min(str(uv[0]), str(uv[1])), max(str(uv[0]), str(uv[1]))))

    # A separation whose anchor left the model this run is INERT — the
    # dangling-anchor mirror of the dangling-edge guard above. A deleted or
    # rebuilt layer neutralises the constraint (the re-anchor pass restores it on
    # the next rebuild), so a stale separation can never fragment the wrong body.
    live_separations: list[tuple[UUID, UUID]] = [
        (s.layer_a_id, s.layer_b_id)
        for s in separations
        if s.layer_a_id in node_ids and s.layer_b_id in node_ids
    ]

    components = _constrained_components(node_ids, surviving_edges, live_separations)

    # Sort key for the shallowest member of a component: by depth, then layer
    # UUID for determinism.
    def _key(ln: LayerNode) -> tuple[float, str]:
        return (ln.depth_top_m, str(ln.layer_id))

    # A2: the naming group keys on lithology ALONE (the geological parent no
    # longer partitions instances). Two ZAND bodies in different geological
    # formations share the ZAND naming group and rank by depth (Sa1 = shallowest
    # sand instance, Sa2 = next), regardless of chrono attribution.
    GroupKey = tuple[str | None]
    group_to_comps: dict[GroupKey, list[tuple[tuple[float, str], list[UUID], LayerNode]]] = (
        defaultdict(list)
    )
    for comp in components:
        members = [node_map[fid] for fid in comp]
        rep = min(members, key=_key)  # shallowest member = representative
        gk: GroupKey = (rep.litho_main_soil_code,)
        group_to_comps[gk].append((_key(rep), comp, rep))

    instances: list[InstanceAssignment] = []
    layer_to_ordinal: dict[UUID, int] = {}
    layer_to_formation: dict[UUID, UUID] = {}

    for _gk, comps in group_to_comps.items():
        comps.sort(key=lambda triple: triple[0])  # shallowest component first
        for ordinal, (_rep_key, comp, rep) in enumerate(comps):
            instances.append(
                InstanceAssignment(
                    formation_id=rep.formation_id,
                    ordinal=ordinal,
                    member_layer_ids=list(comp),
                    source_investigation_id=rep.source_investigation_id,
                    earliest_depth_m=rep.depth_top_m,
                )
            )
            for lid in comp:
                layer_to_ordinal[lid] = ordinal
                layer_to_formation[lid] = rep.formation_id

    return ResolveResult(
        instances=instances,
        layer_to_ordinal=layer_to_ordinal,
        layer_to_formation=layer_to_formation,
    )


# ---------------------------------------------------------------------------
# Formation-level correlation-graph BFS helper — consumed by
# application.propagate_litho_admixtures. Kept independent of the layer-level
# resolver above. Do not delete: it has an external caller.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CorrelationEdge:
    """Lightweight snapshot of one formation-level correlation edge.

    Attributes
    ----------
    formation_a_id : UUID
        Lesser endpoint UUID (canonical ordering enforced by the DB).
    formation_b_id : UUID
        Greater endpoint UUID.
    """

    formation_a_id: UUID
    formation_b_id: UUID


def connected_formation_ids(
    seed: UUID,
    edges: list[CorrelationEdge],
) -> set[UUID]:
    """Return the BFS-reachable formation-id set for ``seed`` in the edge graph.

    Includes ``seed`` itself (a singleton with no edges returns ``{seed}``).
    Dangling edges (those whose endpoints are not reachable from ``seed``)
    are silently traversed — the function builds its own adjacency list from
    the supplied edge list and BFS from the seed.

    This function is PURE — no I/O, no side effects, callable from any layer.

    Parameters
    ----------
    seed : UUID
        Formation id to start BFS from.
    edges : list[CorrelationEdge]
        All edges in the model (or a pre-filtered subset — the function only
        traverses edges reachable from ``seed``).

    Returns
    -------
    set[UUID]
        All formation ids in the same connected component as ``seed``,
        including ``seed`` itself.
    """
    adjacency: dict[UUID, set[UUID]] = {}
    for edge in edges:
        adjacency.setdefault(edge.formation_a_id, set()).add(edge.formation_b_id)
        adjacency.setdefault(edge.formation_b_id, set()).add(edge.formation_a_id)

    return set(_bfs_reachable(seed, adjacency))
