"""Unit tests for the layer-level litho instance resolver."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    resolve_litho_instances,
)

P = UUID("00000000-0000-0000-0000-0000000000aa")  # parent formation
F_SAND = UUID("00000000-0000-0000-0000-0000000000f1")  # clean-sand formation row
INV_A = UUID("00000000-0000-0000-0000-0000000000a1")
INV_B = UUID("00000000-0000-0000-0000-0000000000b1")


def _layer(layer_id: str, depth: float, inv: UUID, formation: UUID = F_SAND) -> LayerNode:
    return LayerNode(
        layer_id=UUID(layer_id),
        formation_id=formation,
        parent_formation_id=P,
        litho_main_soil_code="ZAND",
        depth_top_m=depth,
        source_investigation_id=inv,
    )


def test_two_uncorrelated_same_formation_layers_get_distinct_ordinals() -> None:
    """Two same-formation layers with no edge between them -> distinct ordinals.

    Two SAND layers, same formation row, NO edge between them -> two
    instances numbered 0 and 1 (shallowest first).
    """
    shallow = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A)
    deep = _layer("00000000-0000-0000-0000-000000000002", 8.0, INV_A)
    result = resolve_litho_instances(layers=[shallow, deep], edges=[])
    assert result.layer_to_ordinal[shallow.layer_id] == 0
    assert result.layer_to_ordinal[deep.layer_id] == 1
    assert len(result.instances) == 2


def test_correlated_layers_share_one_instance() -> None:
    """Correlated layers on different columns collapse to one instance.

    Two SAND layers on different columns, correlated -> one instance,
    one ordinal, both members.
    """
    a = _layer("00000000-0000-0000-0000-000000000001", 3.0, INV_A)
    b = _layer("00000000-0000-0000-0000-000000000002", 3.2, INV_B)
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=edges)
    assert result.layer_to_ordinal[a.layer_id] == result.layer_to_ordinal[b.layer_id]
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}


def test_uncorrelating_splits_back_into_two() -> None:
    """Removing the edge splits the instance back into two.

    Same two layers, no edge -> two instances again (proves the resolver is
    a pure function of the current edge set).
    """
    a = _layer("00000000-0000-0000-0000-000000000001", 3.0, INV_A)
    b = _layer("00000000-0000-0000-0000-000000000002", 3.2, INV_B)
    result = resolve_litho_instances(layers=[a, b], edges=[])
    assert len(result.instances) == 2


def test_distinct_soil_codes_number_independently() -> None:
    """Different soil codes under one parent number independently from 0.

    SAND and SILT under the same parent are independent groups: each
    starts at ordinal 0.
    """
    sand = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A, F_SAND)
    silt = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000003"),
        formation_id=UUID("00000000-0000-0000-0000-0000000000f2"),
        parent_formation_id=P,
        litho_main_soil_code="SILT",
        depth_top_m=5.0,
        source_investigation_id=INV_A,
    )
    result = resolve_litho_instances(layers=[sand, silt], edges=[])
    assert result.layer_to_ordinal[sand.layer_id] == 0
    assert result.layer_to_ordinal[silt.layer_id] == 0


def test_cross_lithology_edge_does_not_merge_into_one_body() -> None:
    """An edge across a LITHOLOGY boundary must NOT form one body.

    A body is a single lithology (owner directive 2026-06-03). A correlation
    edge joining a ZAND layer to a SILT layer — a mis-correlation, or auto-
    correlate crossing a facies change — is dropped, so the two stay separate
    instances. Without this guard the resolver grouped a clay layer into a
    silt body and the band fill painted the clay green.
    """
    sand = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A)  # ZAND
    silt = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000002"),
        formation_id=UUID("00000000-0000-0000-0000-0000000000f2"),
        parent_formation_id=P,
        litho_main_soil_code="SILT",
        depth_top_m=2.2,
        source_investigation_id=INV_B,
    )
    edges = [LayerEdge(layer_a_id=sand.layer_id, layer_b_id=silt.layer_id)]
    result = resolve_litho_instances(layers=[sand, silt], edges=edges)
    # The cross-lithology edge is dropped → two separate single-lithology bodies.
    assert len(result.instances) == 2
    assert result.layer_to_ordinal[sand.layer_id] == 0
    assert result.layer_to_ordinal[silt.layer_id] == 0  # different group, own 0


def test_edge_across_geological_boundary_does_not_merge() -> None:
    """A sand split at a geological boundary stays TWO bodies, not one.

    A body must not span a geological-formation boundary (owner directive
    2026-06-04). A single sand split at the Holocene/Pleistocene boundary into
    two litho layers with DIFFERENT geological parents — even stacked on one
    column and correlated same-lithology — must resolve to two instances.
    Without this, the two re-merge into one body that holds a single open-end
    slot, so open-ending one unit silently moves the cap off the other
    (dogfeed: QHSa2 vs QPSa1 overwriting each other).
    """
    p_holocene = UUID("00000000-0000-0000-0000-0000000000a1")
    p_pleistocene = UUID("00000000-0000-0000-0000-0000000000a2")
    holocene_sand = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000001"),
        formation_id=F_SAND,
        parent_formation_id=p_holocene,
        litho_main_soil_code="ZAND",
        depth_top_m=6.9,
        source_investigation_id=INV_A,
    )
    pleistocene_sand = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000002"),
        formation_id=F_SAND,
        parent_formation_id=p_pleistocene,
        litho_main_soil_code="ZAND",
        depth_top_m=10.0,
        source_investigation_id=INV_A,
    )
    edges = [LayerEdge(layer_a_id=holocene_sand.layer_id, layer_b_id=pleistocene_sand.layer_id)]
    result = resolve_litho_instances(layers=[holocene_sand, pleistocene_sand], edges=edges)
    # The cross-geological-boundary edge is dropped → two single-formation bodies,
    # so the two layers never share a body_id (and thus never share an open cap).
    assert len(result.instances) == 2
    members_per_instance = [set(i.member_layer_ids) for i in result.instances]
    assert {holocene_sand.layer_id} in members_per_instance
    assert {pleistocene_sand.layer_id} in members_per_instance


def test_same_soil_different_formation_rows_still_merge() -> None:
    """Same lithology, different formation rows (admixture) still merge.

    The one-lithology guard keys on ``litho_main_soil_code``, not formation
    row — two ZAND layers with different admixture formations stay one body.
    """
    a = _layer("00000000-0000-0000-0000-000000000001", 3.0, INV_A, F_SAND)
    b = _layer(
        "00000000-0000-0000-0000-000000000002",
        3.2,
        INV_B,
        UUID("00000000-0000-0000-0000-0000000000f3"),  # silty-sand row, still ZAND soil
    )
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=edges)
    assert len(result.instances) == 1


def test_cross_formation_component_maps_to_shallowest_formation() -> None:
    """A component spanning two formation rows maps every member to the shallowest's.

    Two SAND layers under the same parent but with DIFFERENT formation
    rows (clean sand vs silty sand, i.e. different admixture), correlated
    into ONE component -> every member maps to the SHALLOWEST member's
    formation_id, and the single instance reports that formation.
    """
    shallow = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A, F_SAND)
    deep = _layer(
        "00000000-0000-0000-0000-000000000002",
        8.0,
        INV_B,
        UUID("00000000-0000-0000-0000-0000000000f3"),  # F_SAND_SILTY
    )
    edges = [LayerEdge(layer_a_id=shallow.layer_id, layer_b_id=deep.layer_id)]
    result = resolve_litho_instances(layers=[shallow, deep], edges=edges)
    assert len(result.instances) == 1
    assert shallow.layer_id in result.layer_to_formation
    assert deep.layer_id in result.layer_to_formation
    assert result.layer_to_formation[shallow.layer_id] == F_SAND
    assert result.layer_to_formation[deep.layer_id] == F_SAND
    assert result.instances[0].formation_id == F_SAND


def test_instance_representative_is_shallowest_layer() -> None:
    """A multi-layer instance's representative identity is its shallowest layer.

    A multi-layer instance reports the shallowest layer's formation +
    investigation as its representative identity.
    """
    deep = _layer("00000000-0000-0000-0000-000000000002", 8.0, INV_B)
    shallow = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A)
    edges = [LayerEdge(layer_a_id=deep.layer_id, layer_b_id=shallow.layer_id)]
    result = resolve_litho_instances(layers=[deep, shallow], edges=edges)
    inst = result.instances[0]
    assert inst.source_investigation_id == INV_A
    assert inst.earliest_depth_m == 2.0
