"""Unit tests for the DORMANT separation arg of the litho resolver.

Owner ruling 2026-09-01: the geotech body verbs were simplified to **Join with…**
(``body_union``) + **Disjoin** only. The **Separate** / **Rejoin** verbs were
removed and ``body_separation`` is now DORMANT — the ORM, the table, the router
and the bundle restore path survive so leftover rows stay readable, but a
standing separation NO LONGER affects a resolve. A leftover separation row must
never refuse the owner's Join (the hard blocker this slice removes).

Concretely the resolver still ACCEPTS the ``separations`` argument (the signature
and every caller — including bundle restore — are unchanged), but ignores it:
``live_separations`` is forced empty inside ``resolve_litho_instances``, so a
``body_union`` always unions and no union is ever post-hoc suppressed.

These tests speak that contract in its own words — *a standing separation no
longer cuts a body* — and exercise the pure ``resolve_litho_instances`` function
only (no DB). The historical cannot-link tests (a separation cut an edge, an
indirect path, isolated an anchor) were REMOVED with the verb; git history holds
them.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    LayerSeparation,
    resolve_litho_instances,
)

P = UUID("00000000-0000-0000-0000-0000000000aa")  # parent formation
F_SAND = UUID("00000000-0000-0000-0000-0000000000f1")

INV_A = UUID("00000000-0000-0000-0000-0000000000a1")
INV_B = UUID("00000000-0000-0000-0000-0000000000b1")

L_A = UUID("00000000-0000-0000-0000-000000000001")
L_B = UUID("00000000-0000-0000-0000-000000000002")
L_X = UUID("00000000-0000-0000-0000-000000000003")


def _layer(layer_id: UUID, depth: float, inv: UUID) -> LayerNode:
    return LayerNode(
        layer_id=layer_id,
        formation_id=F_SAND,
        parent_formation_id=P,
        litho_main_soil_code="ZAND",
        depth_top_m=depth,
        source_investigation_id=inv,
    )


def _partition(result: object) -> set[frozenset[UUID]]:
    """The resolved partition as a set of member-id frozensets (order-free)."""
    return {frozenset(inst.member_layer_ids) for inst in result.instances}  # type: ignore[attr-defined]


def test_a_standing_separation_no_longer_cuts_an_edge_connected_body() -> None:
    """A leftover separation no longer splits two edge-connected anchors.

    Before the verb was removed a separation between A and B overruled the edge
    that joined them and left two bodies. Now the separation is DORMANT: the edge
    unions A and B into ONE body exactly as if the separation were not there. This
    is the resolve half of unblocking Join from leftover separation rows.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=edges, separations=seps)
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}
    assert result.layer_to_ordinal[a.layer_id] == result.layer_to_ordinal[b.layer_id]


def test_a_separation_is_ignored_exactly_as_if_it_were_not_passed() -> None:
    """The resolve is byte-identical whether or not a separation is supplied.

    The strongest statement of "dormant": the same layers and edges resolve to
    the SAME partition with a standing separation and without it. An indirect
    A-X-B chain that a separation used to cut now stays one body either way.
    """
    a = _layer(L_A, 3.0, INV_A)
    x = _layer(L_X, 3.1, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    edges = [
        LayerEdge(layer_a_id=a.layer_id, layer_b_id=x.layer_id),
        LayerEdge(layer_a_id=x.layer_id, layer_b_id=b.layer_id),
    ]
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    with_sep = _partition(resolve_litho_instances(layers=[a, x, b], edges=edges, separations=seps))
    without_sep = _partition(resolve_litho_instances(layers=[a, x, b], edges=edges))
    assert with_sep == without_sep
    assert with_sep == {frozenset({a.layer_id, x.layer_id, b.layer_id})}


def test_a_separation_between_disconnected_layers_is_still_a_no_op() -> None:
    """Two layers with nothing joining them stay two bodies, separation or not.

    A and B have no edge between them, so they are already two bodies. A dormant
    separation cannot change that — the partition is two singletons regardless.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    with_sep = _partition(resolve_litho_instances(layers=[a, b], edges=[], separations=seps))
    without_sep = _partition(resolve_litho_instances(layers=[a, b], edges=[]))
    assert with_sep == without_sep
    assert len(with_sep) == 2
