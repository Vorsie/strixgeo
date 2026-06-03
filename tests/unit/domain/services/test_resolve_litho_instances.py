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
