"""Unit tests for the must-link (Join-with) side of the litho resolver.

Owner ruling 2026-08-31 (debt #278): a **"Join with…"** verb — the positive half
of the body-identity rule — so the engineer can state *"this body IS the same as
that body"* and have the resolver honour it. His standing rule: *"a body is only
a body if it is geometrically connected, OR if the user says this body is the
same as that body"* — the subtractive half (Separate / cannot-link) already
exists; a union is the additive half only the user writes.

A union is a **must-link** constraint in LAYER-id space: "the body containing
``layer_a`` IS the same body as the body containing ``layer_b``". These tests
speak the ruling's own words — *the user says these two ARE the same body, and
the resolver honours it* — and exercise the pure ``resolve_litho_instances``
function only (no DB).

Precedence and guards under test:

* R-JOIN-1 — cannot-link wins: a union contradicting a standing separation is
  suppressed (the separation holds) and reported in ``suppressed_unions``.
* R-JOIN-2 — never a mixed body: a union across two soils / packing classes is
  INERT and reported in ``inert_unions``.
* R-JOIN-3 — a dangling anchor makes the union inert (silently, mirroring a
  dangling separation).
* R-JOIN-4 — determinism / priority: user unions are processed before machine
  edges, so a machine edge can never complete a separation through a
  pre-applied union.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    LayerSeparation,
    LayerUnion,
    resolve_litho_instances,
)

P = UUID("00000000-0000-0000-0000-0000000000aa")  # parent formation
F_SAND = UUID("00000000-0000-0000-0000-0000000000f1")
F_CLAY = UUID("00000000-0000-0000-0000-0000000000f2")

# Two distinct packing-formation rows for the same NAD class (the model keeps one
# row per (class, litho parent, geological parent), so one class exists under
# several row ids — the skeleton-band case U6 exercises).
PACK_ROW_1 = UUID("00000000-0000-0000-0000-0000000000d1")
PACK_ROW_2 = UUID("00000000-0000-0000-0000-0000000000d2")

INV_A = UUID("00000000-0000-0000-0000-0000000000a1")
INV_B = UUID("00000000-0000-0000-0000-0000000000b1")
INV_X = UUID("00000000-0000-0000-0000-0000000000c1")

L_A = UUID("00000000-0000-0000-0000-000000000001")
L_B = UUID("00000000-0000-0000-0000-000000000002")
L_X = UUID("00000000-0000-0000-0000-000000000003")
L_C = UUID("00000000-0000-0000-0000-00000000000c")
L_D = UUID("00000000-0000-0000-0000-00000000000d")


def _layer(
    layer_id: UUID,
    depth: float,
    inv: UUID,
    *,
    formation_id: UUID = F_SAND,
    soil: str | None = "ZAND",
    packing_formation_id: UUID | None = None,
    packing_nad_class: int | None = None,
) -> LayerNode:
    return LayerNode(
        layer_id=layer_id,
        formation_id=formation_id,
        parent_formation_id=P,
        litho_main_soil_code=soil,
        depth_top_m=depth,
        source_investigation_id=inv,
        packing_formation_id=packing_formation_id,
        packing_nad_class=packing_nad_class,
    )


def _partition(result: object) -> set[frozenset[UUID]]:
    """The resolved partition as a set of member-id frozensets (order-free)."""
    return {frozenset(inst.member_layer_ids) for inst in result.instances}  # type: ignore[attr-defined]


def test_the_user_says_these_two_are_the_same_body_no_edge_needed() -> None:
    """U1 — a union merges two disconnected same-class components.

    The user says A and B ARE the same body. There is NO correlation edge or
    geometry fact between them — they are two separate bodies — yet the union
    alone merges them into one, exactly as the ruling promises.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=[], unions=unions)
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}
    assert result.layer_to_ordinal[a.layer_id] == result.layer_to_ordinal[b.layer_id]
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_the_merge_is_identical_under_shuffled_union_and_edge_input() -> None:
    """U2 — the resolved partition is the same whatever order unions/edges arrive.

    User unions are prepended to the sorted machine edges, and both are sorted
    canonically first, so several shuffles of the same input produce ONE
    identical partition — the determinism guarantee.
    """
    a = _layer(L_A, 3.0, INV_A)
    x = _layer(L_X, 3.1, INV_X)
    b = _layer(L_B, 3.2, INV_B)
    edges_forward = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=x.layer_id)]
    edges_reverse = [LayerEdge(layer_a_id=x.layer_id, layer_b_id=a.layer_id)]
    union_variants = [
        [LayerUnion(layer_a_id=x.layer_id, layer_b_id=b.layer_id)],
        [LayerUnion(layer_a_id=b.layer_id, layer_b_id=x.layer_id)],
    ]
    partitions = [
        _partition(resolve_litho_instances(layers=[a, x, b], edges=ev, unions=uv))
        for ev in (edges_forward, edges_reverse)
        for uv in union_variants
    ]
    assert all(p == partitions[0] for p in partitions)
    # A-X by the edge, X-B by the union → all three in one body, every time.
    assert partitions[0] == {frozenset({a.layer_id, x.layer_id, b.layer_id})}


def test_a_dangling_union_anchor_makes_the_union_inert() -> None:
    """U3 — a union whose anchor is not in this model's layers is ignored.

    A deleted or rebuilt layer neutralises a union exactly like the dangling
    guard neutralises a stale edge or separation: the anchor is absent from the
    node map this run, so the must-link cannot bind and the two present layers
    stay two bodies. It is dropped SILENTLY (mirroring a dangling separation) —
    the re-anchor pass restores it after the rebuild, so it is not a reported
    inert union.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    # The union names L_X, which is NOT in the layer set this run.
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=L_X)]
    result = resolve_litho_instances(layers=[a, b], edges=[], unions=unions)
    assert len(result.instances) == 2
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    # Dangling → silent drop, NOT reported (unlike a cross-class inert union).
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_union_across_two_soils_is_inert_and_reported() -> None:
    """U4 — a union joining two different soils is INERT, never a mixed body.

    A body is a single lithology. A union that would join a sand and a clay
    fails the same soil predicate an edge does, so it does nothing — and because
    the user explicitly asked for it, it is reported in ``inert_unions`` so the
    use case can WARN that the classes re-derived apart.
    """
    sand = _layer(L_A, 3.0, INV_A, formation_id=F_SAND, soil="ZAND")
    clay = _layer(L_B, 3.2, INV_B, formation_id=F_CLAY, soil="KLEI")
    unions = [LayerUnion(layer_a_id=sand.layer_id, layer_b_id=clay.layer_id)]
    result = resolve_litho_instances(layers=[sand, clay], edges=[], unions=unions)
    assert len(result.instances) == 2, "a cross-soil union must never make one body"
    assert len(result.inert_unions) == 1
    assert {result.inert_unions[0].layer_a_id, result.inert_unions[0].layer_b_id} == {
        sand.layer_id,
        clay.layer_id,
    }
    assert not result.suppressed_unions


def test_a_union_across_two_known_packing_classes_is_inert_and_reported() -> None:
    """U5 — a union joining two KNOWN, differing NAD classes is inert + reported.

    A geotech body is one soil AND one packing density. Two sand bands whose NAD
    classes are both known and differ describe two masses, so the union is inert
    and reported — the same read the edge loop applies when it drops a tie whose
    ends no longer share a class.
    """
    dense = _layer(L_A, 3.0, INV_A, packing_formation_id=PACK_ROW_1, packing_nad_class=6)
    denser = _layer(L_B, 3.2, INV_B, packing_formation_id=PACK_ROW_2, packing_nad_class=7)
    unions = [LayerUnion(layer_a_id=dense.layer_id, layer_b_id=denser.layer_id)]
    result = resolve_litho_instances(layers=[dense, denser], edges=[], unions=unions)
    assert len(result.instances) == 2, "differing packing classes must never be one body"
    assert len(result.inert_unions) == 1
    assert not result.suppressed_unions


def test_skeleton_bands_join_only_within_one_packing_row() -> None:
    """U6 — skeleton bands (no NAD class) merge on the same row, inert across rows.

    Where either end's packing class is unknown (a skeleton band), the row
    comparison stands: two unknowns are not known to be the same density. So a
    union between two skeleton bands on DIFFERENT packing rows is inert, while a
    union between two on the SAME row merges — mirroring the edge loop's
    row-fallback exactly.
    """
    # Different rows, both class-None → inert.
    a1 = _layer(L_A, 3.0, INV_A, packing_formation_id=PACK_ROW_1, packing_nad_class=None)
    b1 = _layer(L_B, 3.2, INV_B, packing_formation_id=PACK_ROW_2, packing_nad_class=None)
    inert = resolve_litho_instances(
        layers=[a1, b1],
        edges=[],
        unions=[LayerUnion(layer_a_id=a1.layer_id, layer_b_id=b1.layer_id)],
    )
    assert len(inert.instances) == 2, "different packing rows must not merge"
    assert len(inert.inert_unions) == 1

    # Same row, both class-None → merge.
    a2 = _layer(L_A, 3.0, INV_A, packing_formation_id=PACK_ROW_1, packing_nad_class=None)
    b2 = _layer(L_B, 3.2, INV_B, packing_formation_id=PACK_ROW_1, packing_nad_class=None)
    merged = resolve_litho_instances(
        layers=[a2, b2],
        edges=[],
        unions=[LayerUnion(layer_a_id=a2.layer_id, layer_b_id=b2.layer_id)],
    )
    assert len(merged.instances) == 1, "the same packing row must merge"
    assert not merged.inert_unions


def test_a_union_contradicting_a_separation_is_suppressed() -> None:
    """U7 — cannot-link wins: a union of a separated pair is suppressed.

    The engineer separated A and B ("these are NOT the same body"), then a union
    (arriving via a restore/clone, say) names the same pair. Precedence is
    absolute: the separation holds, the union does NOTHING, and it is reported in
    ``suppressed_unions`` so the use case can WARN — never a silent override of
    the standing separation.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=[], separations=seps, unions=unions)
    assert len(result.instances) == 2, "the separation must win over the union"
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert len(result.suppressed_unions) == 1
    assert {result.suppressed_unions[0].layer_a_id, result.suppressed_unions[0].layer_b_id} == {
        a.layer_id,
        b.layer_id,
    }
    assert not result.inert_unions


def test_a_disjoint_union_and_separation_coexist() -> None:
    """U8 — a union on one pair and a separation on another are both honoured.

    Separating A from B does not touch a union of an unrelated pair C-D: C and D
    merge into one body while A and B stay apart. Neither constraint reaches the
    other's roots.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    c = _layer(L_C, 5.0, INV_A)
    d = _layer(L_D, 5.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    unions = [LayerUnion(layer_a_id=c.layer_id, layer_b_id=d.layer_id)]
    result = resolve_litho_instances(layers=[a, b, c, d], edges=[], separations=seps, unions=unions)
    # A|B never joined (no edge, and separated anyway); C|D merged by the union.
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert result.layer_to_ordinal[c.layer_id] == result.layer_to_ordinal[d.layer_id]
    assert {frozenset({c.layer_id, d.layer_id})}.issubset(_partition(result))
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_union_of_already_connected_anchors_is_a_no_op() -> None:
    """U9 — union of two anchors already in one body changes nothing.

    A and B are already one body via a correlation edge. Adding a union of the
    same pair leaves the partition exactly as it was — one body — and the union
    is neither inert nor suppressed (it landed in one component, satisfied).
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    with_union = _partition(resolve_litho_instances(layers=[a, b], edges=edges, unions=unions))
    without_union = _partition(resolve_litho_instances(layers=[a, b], edges=edges))
    assert with_union == without_union
    assert with_union == {frozenset({a.layer_id, b.layer_id})}
    result = resolve_litho_instances(layers=[a, b], edges=edges, unions=unions)
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_machine_edge_cannot_complete_a_separation_through_a_union() -> None:
    """U10 — the user union is applied first, so a machine edge never rides it.

    Separation A≠B. The user joins A and X (a union), and a MACHINE edge connects
    X and B. Because the user's union is processed before the machine edge, A-X
    merges first and it is the machine edge X-B that gets cut to honour the
    separation — never the user's union. B is walled off; A and X are one body.

    Were the machine edge processed first, it would union X into B's incidence
    and the LATER union A-X would be the edge dropped — the user's ruling
    silently overruled by housekeeping. Prepending the unions guarantees the
    opposite.
    """
    a = _layer(L_A, 3.0, INV_A)
    x = _layer(L_X, 3.1, INV_X)
    b = _layer(L_B, 3.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=x.layer_id)]
    edges = [LayerEdge(layer_a_id=x.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, x, b], edges=edges, separations=seps, unions=unions)
    assert _partition(result) == {
        frozenset({a.layer_id, x.layer_id}),
        frozenset({b.layer_id}),
    }
    # The user's union took effect (A and X together); it is not suppressed.
    assert not result.suppressed_unions
    assert not result.inert_unions
