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


# ---------------------------------------------------------------------------
# NEVER WELD ACROSS LITHOLOGY VARIANTS — owner ruling 2026-10-03.
#
# Verbatim: *"a zand and zand/matig siltig are 2 different lithologies, never
# weld those."* A band of unit X and a band of unit Y never share a body,
# whatever their main soil family; the contact between them is a body boundary
# like ZAND / KLEI. An admixture variant is a unit in its own right with its own
# bodies numbered from #0. Join by hand (a GROUP, never a merge) stays the way to
# pool the two.
# ---------------------------------------------------------------------------

F_ZAND = UUID("00000000-0000-0000-0000-00000000a001")  # litho unit ZAND
F_ZAND_SLM = UUID("00000000-0000-0000-0000-00000000a002")  # litho unit ZAND (SL:M)


def test_touching_zand_and_zand_matig_siltig_are_two_bodies() -> None:
    """ZAND and ZAND (SL:M) are two lithologies: touching bands never weld.

    The geometry fact (or a tie) between them states a shared contact, never
    one body.
    """
    zand = _layer("00000000-0000-0000-0000-000000000101", 2.0, INV_A, F_ZAND)
    silty = _layer("00000000-0000-0000-0000-000000000102", 4.0, INV_A, F_ZAND_SLM)
    result = resolve_litho_instances(
        layers=[zand, silty], edges=[LayerEdge(zand.layer_id, silty.layer_id)]
    )
    assert len(result.instances) == 2
    assert result.layer_to_formation[zand.layer_id] == F_ZAND
    assert result.layer_to_formation[silty.layer_id] == F_ZAND_SLM


def test_an_admixture_variant_numbers_its_own_bodies_from_zero() -> None:
    """Each litho unit numbers its bodies from #0, the variant included.

    Shallow ZAND, then ZAND (SL:M), then a deeper ZAND: ZAND #0 and #1, and the
    matig siltig unit starts at its own #0.
    """
    zand_top = _layer("00000000-0000-0000-0000-000000000111", 1.0, INV_A, F_ZAND)
    silty = _layer("00000000-0000-0000-0000-000000000112", 3.0, INV_A, F_ZAND_SLM)
    zand_deep = _layer("00000000-0000-0000-0000-000000000113", 6.0, INV_A, F_ZAND)
    result = resolve_litho_instances(layers=[zand_top, silty, zand_deep], edges=[])
    assert result.layer_to_ordinal[zand_top.layer_id] == 0
    assert result.layer_to_ordinal[zand_deep.layer_id] == 1
    assert result.layer_to_ordinal[silty.layer_id] == 0


def test_same_unit_bands_tied_through_a_variant_stay_per_unit() -> None:
    """A chain ZAND - ZAND (SL:M) - ZAND never bridges the two ZAND bands.

    The variant is a boundary: the two ZAND bands touch only the variant, so
    they stay two ZAND bodies, and the variant is its own body.
    """
    a = _layer("00000000-0000-0000-0000-000000000121", 1.0, INV_A, F_ZAND)
    mid = _layer("00000000-0000-0000-0000-000000000122", 1.1, INV_B, F_ZAND_SLM)
    b = _layer("00000000-0000-0000-0000-000000000123", 1.2, INV_B, F_ZAND)
    edges = [LayerEdge(a.layer_id, mid.layer_id), LayerEdge(mid.layer_id, b.layer_id)]
    result = resolve_litho_instances(layers=[a, mid, b], edges=edges)
    assert len(result.instances) == 3


def _geo_band(
    layer_id: str,
    depth: float,
    inv: UUID,
    packing: UUID,
    nad_class: int,
    litho_unit: UUID,
) -> LayerNode:
    """One geotech band carrying the litho unit it subdivides."""
    return LayerNode(
        layer_id=UUID(layer_id),
        formation_id=packing,
        parent_formation_id=P,
        litho_main_soil_code="ZAND",
        depth_top_m=depth,
        source_investigation_id=inv,
        packing_formation_id=packing,
        packing_nad_class=nad_class,
        litho_unit_id=litho_unit,
    )


def test_geotech_same_class_in_zand_and_zand_matig_siltig_are_two_bodies() -> None:
    """A medium-dense ZAND band never welds to a medium-dense ZAND (SL:M) band.

    Same soil, same NAD class, touching, but two litho units: two geotech
    bodies, each numbered from #0 within its own unit.
    """
    row_zand_md = UUID("00000000-0000-0000-0000-00000000b006")
    row_slm_md = UUID("00000000-0000-0000-0000-00000000c006")
    a = _geo_band("00000000-0000-0000-0000-000000000131", 1.0, INV_A, row_zand_md, 6, F_ZAND)
    b = _geo_band("00000000-0000-0000-0000-000000000132", 2.0, INV_A, row_slm_md, 6, F_ZAND_SLM)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 2
    assert result.layer_to_ordinal[a.layer_id] == 0
    assert result.layer_to_ordinal[b.layer_id] == 0


def test_geotech_same_unit_same_class_across_rows_stays_one_body() -> None:
    """Negative control: the class-across-geological-rows rule still welds.

    One litho unit, one NAD class, two packing rows (two geological parents):
    still ONE body (owner 2026-08-21, the class is the mass inside a unit).
    """
    row_geo_a = UUID("00000000-0000-0000-0000-00000000b106")
    row_geo_b = UUID("00000000-0000-0000-0000-00000000b206")
    a = _geo_band("00000000-0000-0000-0000-000000000141", 1.0, INV_A, row_geo_a, 6, F_ZAND)
    b = _geo_band("00000000-0000-0000-0000-000000000142", 1.2, INV_B, row_geo_b, 6, F_ZAND)
    result = resolve_litho_instances([a, b], [LayerEdge(a.layer_id, b.layer_id)])
    assert len(result.instances) == 1
