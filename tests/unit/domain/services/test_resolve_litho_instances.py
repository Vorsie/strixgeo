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


def test_correlated_edge_across_geological_boundary_merges_same_lithology() -> None:
    """A2: a same-lithology body MAY span a geological-formation boundary.

    Owner directive 2026-06-04 REVERSES the one-geological-formation invariant.
    A continuous sand correlated across the Holocene/Pleistocene boundary — two
    litho layers with DIFFERENT geological parents but the SAME lithology,
    joined by a user-approved edge — now resolves to ONE body. The geological
    name becomes a derived, majority-overlap label on the body, not an identity
    constraint. Lithology is the only surviving edge filter; the geological
    parent no longer drops edges.
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
    # A2: same lithology across a geo boundary, correlated → ONE body.
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {
        holocene_sand.layer_id,
        pleistocene_sand.layer_id,
    }


def test_uncorrelated_cross_boundary_same_soil_stay_distinct() -> None:
    """A2: merging is edge-driven, not lithology-alone — the Boom-Klei safety.

    Two same-lithology layers across a geological boundary that are NOT joined
    by a user-approved edge stay TWO bodies. This is what keeps a Quaternary
    clay sitting on Boom Klei (both KLEI, real unconformity) separate: the
    engineer simply does not correlate across the contact. The resolver never
    auto-merges on lithology alone — only an explicit edge merges.
    """
    p_quaternary = UUID("00000000-0000-0000-0000-0000000000a1")
    p_boom = UUID("00000000-0000-0000-0000-0000000000a2")
    quat_clay = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000001"),
        formation_id=F_SAND,
        parent_formation_id=p_quaternary,
        litho_main_soil_code="KLEI",
        depth_top_m=4.0,
        source_investigation_id=INV_A,
    )
    boom_clay = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000002"),
        formation_id=F_SAND,
        parent_formation_id=p_boom,
        litho_main_soil_code="KLEI",
        depth_top_m=12.0,
        source_investigation_id=INV_A,
    )
    result = resolve_litho_instances(layers=[quat_clay, boom_clay], edges=[])
    assert len(result.instances) == 2


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


# ---------------------------------------------------------------------------
# THE GEOTECH MASS — "same litho and packing density".
#
# Owner, 2026-08-19 (the complete emit specification): *"Fill sweep if a lens is
# touching a body with same litho and packing then lens disappears and it
# becomes one body, in the renderer AND IN THE DATABASE."* A geotech body is
# therefore a mass of one SOIL and one PACKING CLASS: two sand bands of
# different densities are two bodies however they are tied, and two of the same
# density that touch are one. The litho model is unchanged — it has no packing
# class, so it passes none and the soil filter alone decides.
# ---------------------------------------------------------------------------

F_MD = UUID("00000000-0000-0000-0000-0000000000d6")  # ZAND, NAD 6 (medium dense)
F_D = UUID("00000000-0000-0000-0000-0000000000d7")  # ZAND, NAD 7 (dense)


def _band(
    layer_id: str, depth: float, inv: UUID, packing: UUID, nad_class: int | None = None
) -> LayerNode:
    """One geotech band: same soil as its neighbours, its own packing class."""
    return LayerNode(
        layer_id=UUID(layer_id),
        formation_id=packing,
        parent_formation_id=P,
        litho_main_soil_code="ZAND",
        depth_top_m=depth,
        source_investigation_id=inv,
        packing_formation_id=packing,
        packing_nad_class=nad_class,
    )


def test_geotech_bands_of_different_packing_never_share_a_body() -> None:
    """A tie between a medium-dense and a dense sand does not make one mass."""
    a = _band("00000000-0000-0000-0000-000000000001", 1.0, INV_A, F_MD)
    b = _band("00000000-0000-0000-0000-000000000002", 1.2, INV_B, F_D)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 2


def test_geotech_bands_of_the_same_packing_become_one_body() -> None:
    """Touching bands of one soil AND one packing class are one body."""
    a = _band("00000000-0000-0000-0000-000000000003", 1.0, INV_A, F_MD)
    b = _band("00000000-0000-0000-0000-000000000004", 1.2, INV_B, F_MD)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}


def test_geotech_same_class_on_duplicate_rows_is_one_mass_one_body() -> None:
    """Same NAD class across a geological boundary is ONE body.

    The subdivide keeps one packing formation ROW per (class, litho parent,
    GEOLOGICAL parent), so a litho unit spanning a geological boundary carries
    the same class under two row ids. The owner ruled the mass is the CLASS
    (2026-08-21: "yes one mass one body"), matching his A2 note — a body may
    span a geological boundary.
    """
    row_geo_a = UUID("00000000-0000-0000-0000-0000000000e6")  # ZAND, NAD 6 under geo A
    row_geo_b = UUID("00000000-0000-0000-0000-0000000000f6")  # ZAND, NAD 6 under geo B
    a = _band("00000000-0000-0000-0000-000000000011", 1.0, INV_A, row_geo_a, nad_class=6)
    b = _band("00000000-0000-0000-0000-000000000012", 1.2, INV_B, row_geo_b, nad_class=6)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}


def test_geotech_different_classes_stay_two_bodies_whatever_the_rows() -> None:
    """The class comparison never over-welds: NAD 6 and NAD 7 are two masses."""
    row_geo_a = UUID("00000000-0000-0000-0000-0000000000e6")
    row_geo_b = UUID("00000000-0000-0000-0000-0000000000f7")
    a = _band("00000000-0000-0000-0000-000000000013", 1.0, INV_A, row_geo_a, nad_class=6)
    b = _band("00000000-0000-0000-0000-000000000014", 1.2, INV_B, row_geo_b, nad_class=7)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 2


def test_geotech_unknown_class_keeps_row_identity() -> None:
    """A skeleton band (no class) falls back to the row comparison.

    Two unknowns are not known to be the same density, so different rows stay
    two bodies exactly as before the ruling.
    """
    a = _band("00000000-0000-0000-0000-000000000015", 1.0, INV_A, F_MD, nad_class=None)
    b = _band("00000000-0000-0000-0000-000000000016", 1.2, INV_B, F_D, nad_class=None)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 2


def test_litho_layers_carry_no_packing_class_and_keep_merging() -> None:
    """Negative control: the litho model is untouched by the packing filter.

    Two admixture variants of one soil (different formation rows, no packing
    class) still merge, which is the standing litho rule.
    """
    a = _layer("00000000-0000-0000-0000-000000000005", 1.0, INV_A, F_SAND)
    b = _layer(
        "00000000-0000-0000-0000-000000000006",
        1.2,
        INV_B,
        UUID("00000000-0000-0000-0000-0000000000f2"),
    )
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 1
