"""Unit tests for the "Join with…" GROUP relation in the litho resolver.

Owner ruling 2026-09-02 (his words): *"I want all bodies that are separate to keep
their separate body IDs. Grouping is just for lumping things that are similar
together, so we have more data and maybe we have less export classes. E.g. in an
export it then becomes group 3 (silt FF) — these parameters."* And, because a
group can span two different litho bodies, merging would lose provenance, so *"the
only way to group those is add a label"*.

So a **"Join with…"** (``body_union``) is a **GROUP** relation, NOT a merge. Body
IDENTITY is geometry-only: every geometrically-disconnected mass keeps its own
body id, and a union must NO LONGER change any ``body_id``. Grouping is resolved
for display / pooling on the client (``geotechGroupOrdinals``); the pure resolver
IGNORES ``unions`` entirely.

These tests speak the ruling's own words — *a union groups two bodies, they keep
their separate body ids, identity is geometry only* — and exercise the pure
``resolve_litho_instances`` function only (no DB). They are the mirror of the old
must-link tests, which pinned the now-removed MERGE behaviour.

What the resolver does under the GROUP contract:

* A union never merges its two anchors — they stay two bodies (unless GEOMETRY,
  i.e. a correlation edge or geometry fact, connects them).
* Nothing is reported ``inert`` or ``suppressed`` — the resolver no longer judges
  unions at all. The "never a mixed body" rule now lives ONLY in the router's
  write-time guard (``same_mass`` on soil + NAD class); a group is still "things
  that are similar".
* Geometry alone decides identity, exactly as it does with no unions supplied.
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


def test_a_union_groups_two_bodies_they_keep_their_separate_body_ids() -> None:
    """U1 — a union GROUPS two bodies; they keep their separate body ids.

    The user says A and B belong to the same GROUP (lump similar things together).
    There is NO correlation edge or geometry fact between them, so they are two
    geometrically-disconnected masses — and under the ruling *"all bodies that are
    separate keep their separate body IDs"* the union must NOT merge them. Identity
    is geometry-only, so they stay two bodies with two distinct ordinals.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=[], unions=unions)
    assert len(result.instances) == 2, "a group must never merge two separate bodies"
    assert _partition(result) == {frozenset({a.layer_id}), frozenset({b.layer_id})}
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_group_does_not_change_the_geometry_only_partition() -> None:
    """U2 — grouping never pulls a third body in; only geometry (an edge) does.

    A and X are one body via a correlation EDGE. The user then groups X with B.
    Because a union is a GROUP relation and never changes identity, B stays its own
    body — the partition is {A,X} and {B}, identical whatever order the union and
    edge arrive in (the geometry-only partition is order-independent).
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
    # A-X by the edge (geometry); the union X-B changes NOTHING, so B stays apart.
    assert partitions[0] == {frozenset({a.layer_id, x.layer_id}), frozenset({b.layer_id})}


def test_a_dangling_union_anchor_changes_nothing() -> None:
    """U3 — a union whose anchor is not in this model's layers is ignored (guard).

    A deleted or rebuilt layer leaves a stale union naming an absent anchor. Under
    the GROUP contract the union changes nothing anyway, so the two present layers
    stay two bodies — and it is dropped silently, never reported.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    # The union names L_X, which is NOT in the layer set this run.
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=L_X)]
    result = resolve_litho_instances(layers=[a, b], edges=[], unions=unions)
    assert len(result.instances) == 2
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_union_across_two_soils_does_not_merge_and_is_not_reported() -> None:
    """U4 — a union across two soils never makes a mixed body (trivially, no merge).

    A body is a single lithology. Under the GROUP contract a union never merges
    anything, so a sand and a clay stay two bodies with no work — and the resolver
    reports nothing inert (the "things that are similar" write guard lives in the
    router now, not here).
    """
    sand = _layer(L_A, 3.0, INV_A, formation_id=F_SAND, soil="ZAND")
    clay = _layer(L_B, 3.2, INV_B, formation_id=F_CLAY, soil="KLEI")
    unions = [LayerUnion(layer_a_id=sand.layer_id, layer_b_id=clay.layer_id)]
    result = resolve_litho_instances(layers=[sand, clay], edges=[], unions=unions)
    assert len(result.instances) == 2, "a cross-soil group must never make one body"
    assert not result.inert_unions, "the resolver no longer judges unions inert (router guards)"
    assert not result.suppressed_unions


def test_a_union_across_two_known_packing_classes_does_not_merge() -> None:
    """U5 — a union across two KNOWN, differing NAD classes never makes one body.

    A geotech body is one soil AND one packing density. Under the GROUP contract a
    union never merges, so two sand bands whose NAD classes are both known and
    differ stay two bodies — and nothing is reported inert.
    """
    dense = _layer(L_A, 3.0, INV_A, packing_formation_id=PACK_ROW_1, packing_nad_class=6)
    denser = _layer(L_B, 3.2, INV_B, packing_formation_id=PACK_ROW_2, packing_nad_class=7)
    unions = [LayerUnion(layer_a_id=dense.layer_id, layer_b_id=denser.layer_id)]
    result = resolve_litho_instances(layers=[dense, denser], edges=[], unions=unions)
    assert len(result.instances) == 2, "differing packing classes must never be one body"
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_union_never_merges_skeleton_bands_identity_is_geometry_only() -> None:
    """U6 — a union no longer merges skeleton bands, same row or not.

    Before the ruling, two skeleton bands (no NAD class) on the SAME packing row
    merged under a union and DIFFERENT rows did not. Under the GROUP contract a
    union merges NEITHER: identity is geometry-only, so both cases stay two bodies.
    The ``same_mass`` packing row-fallback now governs only machine edges and the
    router's write-time group guard — never union identity.
    """
    # Different rows, both class-None → still two bodies (a union never merges).
    a1 = _layer(L_A, 3.0, INV_A, packing_formation_id=PACK_ROW_1, packing_nad_class=None)
    b1 = _layer(L_B, 3.2, INV_B, packing_formation_id=PACK_ROW_2, packing_nad_class=None)
    diff_row = resolve_litho_instances(
        layers=[a1, b1],
        edges=[],
        unions=[LayerUnion(layer_a_id=a1.layer_id, layer_b_id=b1.layer_id)],
    )
    assert len(diff_row.instances) == 2, "different packing rows: a union must not merge"
    assert not diff_row.inert_unions

    # Same row, both class-None → ALSO two bodies now (the old MERGE is gone).
    a2 = _layer(L_A, 3.0, INV_A, packing_formation_id=PACK_ROW_1, packing_nad_class=None)
    b2 = _layer(L_B, 3.2, INV_B, packing_formation_id=PACK_ROW_1, packing_nad_class=None)
    same_row = resolve_litho_instances(
        layers=[a2, b2],
        edges=[],
        unions=[LayerUnion(layer_a_id=a2.layer_id, layer_b_id=b2.layer_id)],
    )
    assert len(same_row.instances) == 2, "same packing row: a union still must not merge"
    assert not same_row.inert_unions
    assert not same_row.suppressed_unions


def test_a_union_does_not_merge_even_with_a_dormant_separation_present() -> None:
    """U7 — a union never merges, dormant separation or not — two bodies stay two.

    A leftover (dormant) separation on the same pair changes nothing, and neither
    does the union: under the GROUP contract identity is geometry-only, so A and B
    — with no edge between them — stay two bodies. Nothing is reported suppressed
    (separations are dormant) or inert.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=[], separations=seps, unions=unions)
    assert len(result.instances) == 2, "a union must not merge — identity is geometry-only"
    assert _partition(result) == {frozenset({a.layer_id}), frozenset({b.layer_id})}
    assert result.layer_to_ordinal[a.layer_id] != result.layer_to_ordinal[b.layer_id]
    assert not result.suppressed_unions
    assert not result.inert_unions


def test_two_unions_leave_all_four_bodies_separate() -> None:
    """U8 — grouping two disjoint pairs merges NOTHING; all four stay separate.

    The user groups C with D and (a dormant separation aside) A stays apart from B.
    Because a union is a GROUP relation, C and D are NOT merged — every one of the
    four geometrically-disconnected masses keeps its own body id.
    """
    a = _layer(L_A, 3.0, INV_A)
    b = _layer(L_B, 3.2, INV_B)
    c = _layer(L_C, 5.0, INV_A)
    d = _layer(L_D, 5.2, INV_B)
    seps = [LayerSeparation(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    unions = [LayerUnion(layer_a_id=c.layer_id, layer_b_id=d.layer_id)]
    result = resolve_litho_instances(layers=[a, b, c, d], edges=[], separations=seps, unions=unions)
    assert _partition(result) == {
        frozenset({a.layer_id}),
        frozenset({b.layer_id}),
        frozenset({c.layer_id}),
        frozenset({d.layer_id}),
    }, "no union may merge any pair — identity is geometry-only"
    assert result.layer_to_ordinal[c.layer_id] != result.layer_to_ordinal[d.layer_id]
    assert not result.inert_unions
    assert not result.suppressed_unions


def test_a_union_on_an_already_connected_geometry_body_is_a_no_op() -> None:
    """U9 — a union changes nothing on a body geometry already made one (guard).

    A and B are already ONE body via a correlation edge (geometry). Adding a union
    of the same pair leaves the partition exactly as it was — one body — because
    the edge, not the union, is what joined them. The union never affects identity
    either way.
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


def test_only_the_machine_edge_joins_the_chain_the_union_does_nothing() -> None:
    """U10 — with a union A-X and a machine edge X-B, only the edge joins.

    The user groups A with X, and a MACHINE edge (geometry) joins X-B. Because the
    union never affects identity, A stays its own body while X and B are one body
    via the edge — the partition is {X,B} and {A}. Only geometry decides identity.
    """
    a = _layer(L_A, 3.0, INV_A)
    x = _layer(L_X, 3.1, INV_X)
    b = _layer(L_B, 3.2, INV_B)
    unions = [LayerUnion(layer_a_id=a.layer_id, layer_b_id=x.layer_id)]
    edges = [LayerEdge(layer_a_id=x.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, x, b], edges=edges, unions=unions)
    assert _partition(result) == {
        frozenset({x.layer_id, b.layer_id}),
        frozenset({a.layer_id}),
    }, "the union A-X must not pull A into the edge-joined {X,B} body"
    assert not result.suppressed_unions
    assert not result.inert_unions
