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

Body identity is GEOMETRY-ONLY (owner 2026-09-02): every geometrically-
disconnected mass keeps its own body id. A user "Join with…" (``body_union`` /
``LayerUnion``) is a GROUP relation — it lumps similar bodies for exports /
display ("group 3 (silt FF)") and must NEVER change a ``body_id`` — so the
resolver IGNORES ``unions`` (dormant); the grouping is resolved client-side
(``geotechGroupOrdinals``). ``separations`` are likewise dormant (the Separate
verb was removed 2026-09-01). Both args are still accepted for caller / bundle-
restore / test compatibility; a later slice removes the dead handling.

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
class LayerUnion:
    """One user "Join with…" ruling — a GROUP relation between two layers.

    Owner ruling 2026-09-02 (his words): *"I want all bodies that are separate to
    keep their separate body IDs. Grouping is just for lumping things that are
    similar together, so we have more data and maybe we have less export classes.
    E.g. in an export it then becomes group 3 (silt FF)."* And, because a group can
    span two different litho bodies, merging would lose provenance, so *"the only
    way to group those is add a label"*.

    So a "Join with…" is a **GROUP** relation, NOT a merge. It lumps two similar
    bodies (same soil + same NAD class) so exports can pool them into one class and
    the units pane can tag them "(group N)"; it must NEVER change a body's
    ``body_id``. Body identity is geometry-only — every geometrically-disconnected
    mass keeps its own id.

    DORMANT in the pure resolver (owner 2026-09-02): the resolver IGNORES ``unions``
    entirely — it never unions nodes for identity. The grouping is resolved for
    DISPLAY / POOLING on the client (``geotechGroupOrdinals``). The dataclass + the
    ``unions`` parameter are kept for signature / caller / bundle-restore / test
    compatibility; the "never a mixed body" rule now lives ONLY in the body-unions
    router's write-time guard (``same_mass`` on soil + class). See the module note.

    The relation is expressed in LAYER-id space, never body-id space — body ids
    re-mint on every resolve, so a body-anchored ruling would bind the wrong mass
    after the next renumbering. Anchoring on the layer rows survives that (this is
    why a ``body_union`` row is re-anchored, not dropped, across a re-subdivide).

    Attributes
    ----------
    layer_a_id : UUID
        One anchor (litho_layer id). Order is irrelevant — the two anchors simply
        name the two bodies the engineer grouped together.
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
    inert_unions : tuple[LayerUnion, ...]
        ALWAYS EMPTY since owner 2026-09-02: a "Join with…" is a GROUP relation,
        not a merge, so the resolver never judges a union inert. The "never a mixed
        body" guard now runs at write time in the body-unions router, not here.
        Kept for signature / caller compatibility (a later slice removes it).
    suppressed_unions : tuple[LayerUnion, ...]
        ALWAYS EMPTY since owner 2026-09-02 (and already empty since separations
        went dormant, 2026-09-01): a union never enters the partition, so nothing
        can suppress it. Kept for signature / caller compatibility.
    """

    instances: list[InstanceAssignment]
    layer_to_ordinal: dict[UUID, int]
    layer_to_formation: dict[UUID, UUID]
    inert_unions: tuple[LayerUnion, ...] = ()
    suppressed_unions: tuple[LayerUnion, ...] = ()


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


def same_mass(a: LayerNode, b: LayerNode) -> bool:
    """Whether two layers describe ONE mass — the shared merge predicate.

    A body is a single lithology, and a geotechnical body is a single lithology
    AND a single packing density. Both a machine edge and a user "Join with…"
    union may only merge two layers this returns ``True`` for; the edge loop
    drops a tie that fails it, and a union that fails it is inert (never a mixed
    body). Extracted so edges and unions apply the identical rule (owner
    2026-06-03 one-lithology invariant + 2026-08-19 / 2026-08-21 one-packing
    invariant).

    Rules, in order:

    * **Soil.** Different ``litho_main_soil_code`` → not one mass (a
      mis-correlation, or auto-correlate crossing a facies change — the clay-in-a-
      silt-body dogfeed of 2026-06-03). Admixture variants of the SAME soil merge,
      because the comparison keys on the base soil, not the formation row.
    * **Packing (geotech only).** Where BOTH ends carry a packing class:
      - both NAD classes known → they must be equal (the CLASS is the mass
        identity, owner 2026-08-21: *"yes one mass one body"* — one class lives
        under several row ids across geological parents, so comparing rows would
        split a body tied across a geological boundary);
      - otherwise (a skeleton band with no class) → the packing formation ROW
        must be equal (two unknowns are not known to be the same density).
      A litho layer carries no packing class, so this branch is inert there and
      the soil rule stands alone.

    Parameters
    ----------
    a, b : LayerNode
        The two candidate layers.

    Returns
    -------
    bool
        ``True`` when the two layers may share a body, ``False`` otherwise.
    """
    if a.litho_main_soil_code != b.litho_main_soil_code:
        return False
    if a.packing_formation_id is not None and b.packing_formation_id is not None:
        if a.packing_nad_class is not None and b.packing_nad_class is not None:
            if a.packing_nad_class != b.packing_nad_class:
                return False
        elif a.packing_formation_id != b.packing_formation_id:
            return False
    return True


# Back-compat alias — the predicate was private until it became a cross-layer
# contract the body-union write guard consumes (the router builds two LayerNodes
# and calls it), so the public name is ``same_mass``. Kept for any importer of
# the old private name.
_same_mass = same_mass


def resolve_litho_instances(
    layers: list[LayerNode],
    edges: list[LayerEdge],
    separations: Sequence[LayerSeparation] = (),
    unions: Sequence[LayerUnion] = (),
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
        DORMANT since the owner removed the Separate / Rejoin verbs
        (2026-09-01). Formerly a cannot-link constraint (debt #278, R5); the arg
        is still ACCEPTED so every caller — including bundle restore of legacy
        rows — is unchanged, but it has NO effect: the resolve is byte-identical
        whether or not separations are supplied (``live_separations`` is forced
        empty in the body, so a ``body_union`` always unions and no union is ever
        suppressed). Restore the live filter when the Separate verb returns.
    unions : Sequence[LayerUnion], optional
        User "Join with…" GROUP rulings (debt #278). DORMANT since owner
        2026-09-02: a union is a GROUP relation, NOT a merge — it lumps similar
        bodies for exports / display and must NEVER change a ``body_id``. Body
        identity is geometry-only, so the resolver IGNORES this argument entirely:
        no union enters the partition, and ``inert_unions`` / ``suppressed_unions``
        are always empty. The resolve is byte-identical whether or not unions are
        supplied. The arg is still ACCEPTED so every caller — including bundle
        restore of legacy rows and the direct unit tests — is unchanged. Grouping
        is resolved client-side (``geotechGroupOrdinals``); the "never a mixed
        body" guard runs at write time in the body-unions router. Restore the live
        merge here only if the ruling ever reverts.

    Returns
    -------
    ResolveResult
        Instances + the layer->ordinal / layer->formation lookups, plus the
        inert / suppressed unions the caller warns about.

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
        # A body is a single mass — one lithology, and one packing density on a
        # geotech model. ``same_mass`` is the shared predicate a union applies
        # too (owner 2026-06-03 one-lithology + 2026-08-19/-21 one-packing). A2
        # (2026-06-04): the geological parent no longer filters edges, so a
        # same-lithology body MAY span a geological boundary.
        if not same_mass(a, b):
            continue
        surviving_edges.append((e.layer_a_id, e.layer_b_id))

    # --- "Join with…" unions (debt #278) — DORMANT since owner 2026-09-02 ------
    # A union is now a GROUP relation, NOT a merge. The engineer groups similar
    # bodies together (same soil + same NAD class — "things that are similar") so
    # an export can pool them into one class — "group 3 (silt FF)" — and the units
    # pane can tag a grouped body "(group N)". Grouping gives MORE data per export
    # class; it must NEVER change a body's identity. Body identity is geometry-only
    # (the granular connected-components rule: every geometrically-disconnected
    # mass keeps its own body id), because a group can span two different litho
    # bodies and merging would lose that provenance (owner 2026-09-02: "all bodies
    # that are separate keep their separate body IDs … the only way to group those
    # is add a label").
    #
    # So the resolver IGNORES ``unions``: none is prepended to the machine edges,
    # and nothing is reported inert/suppressed. The grouping is resolved for
    # DISPLAY / POOLING on the client (``geotechGroupOrdinals``), never here. The
    # ``unions`` arg + the ``LayerUnion`` dataclass stay for signature / caller /
    # bundle-restore / test compatibility; the "never a mixed body" rule now lives
    # ONLY in the body-unions router's write-time guard (``same_mass`` on soil +
    # class). Mirrors the dormant ``separations`` treatment below; a later slice
    # removes this dead handling (debt #278 follow-on).
    _ = unions  # accepted for signature / caller compatibility; dormant (GROUP, not merge)
    inert_unions: list[LayerUnion] = []  # dormant: a union never merges, so never inert
    suppressed_unions: list[LayerUnion] = []  # dormant: separations gone, nothing suppresses

    def _canonical(uv: tuple[UUID, UUID]) -> tuple[str, str]:
        return (min(str(uv[0]), str(uv[1])), max(str(uv[0]), str(uv[1])))

    # Determinism: with the (now dormant) cannot-link constraints the partition can
    # depend on the order pairs are unioned, so the machine edges are sorted
    # canonically before the constrained union-find. Unions are no longer prepended
    # (dormant, GROUP not merge), so ``all_pairs`` is the machine edges ALONE —
    # geometry is the only thing that decides identity.
    surviving_edges.sort(key=_canonical)
    all_pairs = surviving_edges

    # Owner 2026-09-01: the Separate / Rejoin verbs were removed and
    # ``body_separation`` is DORMANT — the ORM, table, router and bundle restore
    # survive so leftover rows stay readable, but a standing separation must no
    # longer affect a resolve (a leftover row was refusing the owner's Join). We
    # keep accepting the ``separations`` arg (signature + every caller unchanged)
    # but ignore it: there are no cannot-link constraints. (Unions are dormant too,
    # 2026-09-02, so nothing rides the constrained union-find any more; both
    # ``inert_unions`` and ``suppressed_unions`` are always empty.) When Separate
    # returns this becomes the live filter again.
    live_separations: list[tuple[UUID, UUID]] = []
    _ = separations  # accepted for signature / caller compatibility; dormant

    components = _constrained_components(node_ids, all_pairs, live_separations)

    # No post-hoc suppressed-union pass any more: a union is a GROUP relation that
    # never enters the partition (dormant, above), so there is nothing to detect as
    # "the separation overruled it" — ``suppressed_unions`` stays the empty list set
    # in the dormant stub. (A later slice removes the whole union path.)

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
        inert_unions=tuple(inert_unions),
        suppressed_unions=tuple(suppressed_unions),
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
