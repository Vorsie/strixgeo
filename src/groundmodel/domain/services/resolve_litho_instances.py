"""Pure domain service — assign instance ordinals over a litho model.

An *instance* is one connected component of correlated litho layers. Two
layers belong to the same instance iff a path of user-approved correlation
edges connects them. Uncorrelated layers — including two same-formation
layers stacked at one column, or two laterally-separate columns never linked
— are distinct instances and receive distinct ordinals.

Ordinals are assigned per ``(parent_formation_id, litho_main_soil_code)``
naming group, shallowest component first, starting at 0. The component with
the shallowest member is ordinal 0, the next is 1, and so on. This matches
the depth-rank the section renderer already computes for body labels
(QHSa1 = shallowest sand instance under that parent).

No I/O, no database access, no logging. The caller
(``ResolveLithoInstances`` use case) loads the data, calls this function, and
writes the results back (creating/reconciling body rows + stamping
``litho_layer.body_id``).

This module also hosts ``connected_formation_ids`` (+ its ``CorrelationEdge``
input DTO), a separate pure BFS helper consumed by
``application.propagate_litho_admixtures`` to walk the formation-level
correlation graph. It is intentionally kept distinct from the layer-level
resolver above.
"""

from __future__ import annotations

from collections import defaultdict, deque
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
        Parent geological formation. Together with ``litho_main_soil_code``
        this forms the naming group. Litho layers always have a parent.
    litho_main_soil_code : str | None
        Base lithology token (ZAND/KLEI/SILT/GRIND/VEEN).
    depth_top_m : float
        Top depth of the layer interval; the ordinal sort key.
    source_investigation_id : UUID
        The layer's anchor investigation (borehole_id or cpt_id).
    """

    layer_id: UUID
    formation_id: UUID
    parent_formation_id: UUID | None
    litho_main_soil_code: str | None
    depth_top_m: float
    source_investigation_id: UUID


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


def _components(node_ids: set[UUID], adjacency: dict[UUID, set[UUID]]) -> list[list[UUID]]:
    """Return connected components (BFS). Singletons are single-element lists.

    Parameters
    ----------
    node_ids : set[UUID]
        All layer ids to cover. An id absent from ``adjacency`` is a singleton.
    adjacency : dict[UUID, set[UUID]]
        Undirected adjacency list (both directions populated by the caller).

    Returns
    -------
    list[list[UUID]]
        One sub-list per component; order within each is BFS discovery order.
    """
    visited: set[UUID] = set()
    out: list[list[UUID]] = []
    for start in node_ids:
        if start in visited:
            continue
        comp: list[UUID] = []
        queue: deque[UUID] = deque([start])
        visited.add(start)
        while queue:
            cur = queue.popleft()
            comp.append(cur)
            for nb in adjacency.get(cur, ()):
                if nb not in visited:
                    visited.add(nb)
                    queue.append(nb)
        out.append(comp)
    return out


def resolve_litho_instances(
    layers: list[LayerNode],
    edges: list[LayerEdge],
) -> ResolveResult:
    """Resolve instances (connected components) and assign group ordinals.

    Parameters
    ----------
    layers : list[LayerNode]
        Every accepted layer in the model (singletons included).
    edges : list[LayerEdge]
        User-approved correlation edges (layer-id endpoints). Endpoints not
        present in ``layers`` are ignored (dangling-edge guard).

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

    adjacency: dict[UUID, set[UUID]] = defaultdict(set)
    for e in edges:
        if e.layer_a_id in node_ids and e.layer_b_id in node_ids:
            adjacency[e.layer_a_id].add(e.layer_b_id)
            adjacency[e.layer_b_id].add(e.layer_a_id)

    components = _components(node_ids, adjacency)

    # Sort key for the shallowest member of a component: by depth, then layer
    # UUID for determinism.
    def _key(ln: LayerNode) -> tuple[float, str]:
        return (ln.depth_top_m, str(ln.layer_id))

    GroupKey = tuple[UUID | None, str | None]
    group_to_comps: dict[GroupKey, list[tuple[tuple[float, str], list[UUID], LayerNode]]] = (
        defaultdict(list)
    )
    for comp in components:
        members = [node_map[fid] for fid in comp]
        rep = min(members, key=_key)  # shallowest member = representative
        gk: GroupKey = (rep.parent_formation_id, rep.litho_main_soil_code)
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

    visited: set[UUID] = set()
    queue: deque[UUID] = deque([seed])
    visited.add(seed)
    while queue:
        current = queue.popleft()
        for neighbour in adjacency.get(current, ()):
            if neighbour not in visited:
                visited.add(neighbour)
                queue.append(neighbour)
    return visited
