"""Unit tests for the constrained (cannot-link) side of the litho resolver.

Owner ruling 2026-08-31 (debt #278, R5): a **"Separate"** verb — the counterpart
to Dissolve — so the engineer can state *"these two are NOT the same body"* and
have the resolver honour it PERMANENTLY. His standing rule: *"a body is only a
body if it is geometrically connected, OR if the user says this body is the same
as that body"* — the positive half (Dissolve / ties / geometry facts) already
exists; a separation is the subtractive half.

A separation is a **cannot-link** constraint in LAYER-id space: "the body
containing ``layer_a`` is never the same body as the body containing
``layer_b``". These tests speak the ruling's own words — *the user says these two
are NOT the same body, and the resolver honours it* — and exercise the pure
``resolve_litho_instances`` function only (no DB).
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
INV_X = UUID("00000000-0000-0000-0000-0000000000c1")

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


def test_the_user_says_these_two_are_not_the_same_body_direct_edge_is_cut() -> None:
    """A direct edge between the two anchors does NOT merge them once separated.

    The user says A and B are NOT the same body. A correlation edge (or geometry
    fact) directly between them would otherwise union them into one body; the
    separation overrules that union, so they stay two bodies.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=edges, separations=seps)
    assert len(result.instances) == 2
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]


def test_an_indirect_path_a_x_b_is_cut_at_the_canonical_edge() -> None:
    """An indirect path A-X-B is cut at the edge the canonical sort visits last.

    The two anchors are joined only through a middle layer X (A-X and X-B). The
    separation forbids A and B sharing a body, so the resolver drops exactly one
    edge — and WHICH one is fixed by the canonical edge sort, not left to chance.

    Hand-verified sort (endpoints as strings): A-X keys on
    ("...001", "...003"), X-B keys on ("...002", "...003"); "...001" < "...002",
    so A-X is unioned FIRST and X-B is the edge that would complete the
    separation — so X-B is the cut. X therefore joins A, and B stands alone.
    Pinning the exact side guards against a flipped sort direction passing
    silently.
    """
    a = _layer(L_A, 3.0, INV_A)
    x = _layer(L_X, 3.1, INV_X)
    b = _layer(L_B, 3.2, INV_B)
    edges = [
        LayerEdge(layer_a_id=a.layer_id, layer_b_id=x.layer_id),
        LayerEdge(layer_a_id=x.layer_id, layer_b_id=b.layer_id),
    ]
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, x, b], edges=edges, separations=seps)
    assert len(result.instances) == 2
    # X joins A (the first-sorted edge survived); B is cut off on its own.
    assert result.layer_to_ordinal[x.layer_id] == result.layer_to_ordinal[a.layer_id]
    assert result.layer_to_ordinal[b.layer_id] != result.layer_to_ordinal[a.layer_id]
    assert _partition(result) == {frozenset({a.layer_id, x.layer_id}), frozenset({b.layer_id})}


def test_the_cut_is_identical_under_shuffled_edge_input() -> None:
    """The resolved partition is the same whatever order the edges arrive in.

    With a cannot-link constraint the partition becomes order-dependent, so the
    resolver sorts its edges canonically before unioning. That sort is the
    determinism guarantee: several shuffles of the same edge list must produce
    one identical partition.
    """
    a = _layer(L_A, 3.0, INV_A)
    x = _layer(L_X, 3.1, INV_X)
    b = _layer(L_B, 3.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    edge_variants = [
        [
            LayerEdge(layer_a_id=a.layer_id, layer_b_id=x.layer_id),
            LayerEdge(layer_a_id=x.layer_id, layer_b_id=b.layer_id),
        ],
        [
            LayerEdge(layer_a_id=x.layer_id, layer_b_id=b.layer_id),
            LayerEdge(layer_a_id=a.layer_id, layer_b_id=x.layer_id),
        ],
        [
            LayerEdge(layer_a_id=b.layer_id, layer_b_id=x.layer_id),
            LayerEdge(layer_a_id=x.layer_id, layer_b_id=a.layer_id),
        ],
    ]
    partitions = [
        _partition(resolve_litho_instances(layers=[a, x, b], edges=ev, separations=seps))
        for ev in edge_variants
    ]
    assert all(p == partitions[0] for p in partitions)
    # And it is not merely stable but the SAME cut every time: X with A, B alone.
    assert partitions[0] == {frozenset({a.layer_id, x.layer_id}), frozenset({b.layer_id})}


def test_a_dangling_separation_anchor_makes_the_separation_inert() -> None:
    """A separation whose anchor is not in this model's layers is ignored.

    A deleted or rebuilt layer neutralises a separation exactly like the
    dangling-edge guard neutralises a stale edge: the anchor is absent from the
    node map this run, so the constraint cannot bind and the edge unions as
    normal.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    # The separation names L_X, which is NOT in the layer set this run.
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=L_X)]
    result = resolve_litho_instances(layers=[a, b], edges=edges, separations=seps)
    # Inert separation → the edge still unions A and B into one body.
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}


def test_a_separation_between_already_disconnected_layers_is_a_no_op() -> None:
    """Separating two layers that were never joined changes nothing.

    A and B have no edge between them, so they are already two bodies. Adding a
    separation leaves the partition exactly as it was — two singletons.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    with_sep = _partition(resolve_litho_instances(layers=[a, b], edges=[], separations=seps))
    without_sep = _partition(resolve_litho_instances(layers=[a, b], edges=[]))
    assert with_sep == without_sep
    assert len(with_sep) == 2


def test_a_separation_never_affects_another_component() -> None:
    """A separation on one pair leaves an unrelated component untouched.

    Separating A from B must not disturb a second, independent component (C-D)
    that is joined by its own edge. The constraint binds only the roots of its
    two anchors.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    c = _layer(UUID("00000000-0000-0000-0000-00000000000c"), 5.0, INV_A)
    d = _layer(UUID("00000000-0000-0000-0000-00000000000d"), 5.2, INV_B)
    edges = [
        LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id),
        LayerEdge(layer_a_id=c.layer_id, layer_b_id=d.layer_id),
    ]
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b, c, d], edges=edges, separations=seps)
    # A|B split by the separation; C|D remain one body, unaffected.
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert result.layer_to_ordinal[c.layer_id] == result.layer_to_ordinal[d.layer_id]
    cd = {frozenset({c.layer_id, d.layer_id})}
    assert cd.issubset(_partition(result))


def test_one_anchor_separated_from_two_partners_honours_both() -> None:
    """A separated from BOTH B and C stays apart from each, while B and C merge.

    All three are pairwise tied (A-B, A-C, B-C) — one body without any
    separation. Two separations share anchor A (A≠B and A≠C), so BOTH the A-B
    and A-C unions are cut, isolating A. B and C are not separated from each
    other, so their tie still merges them. This exercises the per-root
    incidence merge carrying two constraints at once.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.1, INV_B)
    c = _layer(UUID("00000000-0000-0000-0000-000000000004"), 3.2, INV_X)
    edges = [
        LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id),
        LayerEdge(layer_a_id=a.layer_id, layer_b_id=c.layer_id),
        LayerEdge(layer_a_id=b.layer_id, layer_b_id=c.layer_id),
    ]
    seps = [
        LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id),
        LayerSeparation(layer_a_id=a.layer_id, layer_b_id=c.layer_id),
    ]
    result = resolve_litho_instances(layers=[a, b, c], edges=edges, separations=seps)
    # A is walled off from both partners; B and C (un-separated) stay one body.
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[c.layer_id]
    assert result.layer_to_ordinal[b.layer_id] == result.layer_to_ordinal[c.layer_id]
    assert _partition(result) == {
        frozenset({a.layer_id}),
        frozenset({b.layer_id, c.layer_id}),
    }
