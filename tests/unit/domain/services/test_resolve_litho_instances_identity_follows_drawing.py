"""Body identity follows the drawing — owner ruling 2026-10-04.

Verbatim: *"b, identity follows the drawing"*. Bands are one body ONLY where the
section fill paints them as one mass. An accepted tie that the fill does not
paint as a band joins nothing: it stays a surface statement.

The case on his project (testproject_dev, Cross-section 4): ZAND (SL:M) bands on
GEO-08/116-S20 and GEO-08/116-S21 were joined by ONE manual top tie that jumps
three shallower soundings. In the sub-TD zone a lone top tie makes no band (no
base tie = no band), so the fill painted nothing between them and the renderer
posted no geometry fact for the pair — yet the resolver made them one body,
because a tie joined. Expected: two bodies. With the base tie added, the fill
paints a band, the renderer posts the fact, and they are one body.

In the pure resolver the painted connectivity is ``edges`` (the geometry facts
the renderer posts at ``bodies/recompute``); the accepted ties travel separately
as ``ties`` and never union on their own.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    resolve_litho_instances,
)

P = UUID("00000000-0000-0000-0000-0000000000aa")  # parent (geological) formation
F_ZAND_SLM = UUID("00000000-0000-0000-0000-00000000a002")  # litho unit ZAND (SL:M)
F_ZAND = UUID("00000000-0000-0000-0000-00000000a001")  # litho unit ZAND
INV_S20 = UUID("00000000-0000-0000-0000-0000000000c0")
INV_S21 = UUID("00000000-0000-0000-0000-0000000000c1")
INV_S22 = UUID("00000000-0000-0000-0000-0000000000c2")
INV_S23 = UUID("00000000-0000-0000-0000-0000000000c3")


def _band(layer_id: str, depth: float, inv: UUID, unit: UUID = F_ZAND_SLM) -> LayerNode:
    """One accepted litho band of ``unit`` on investigation ``inv``."""
    return LayerNode(
        layer_id=UUID(layer_id),
        formation_id=unit,
        parent_formation_id=P,
        litho_main_soil_code="ZAND",
        depth_top_m=depth,
        source_investigation_id=inv,
    )


def _partition(result) -> set[frozenset[UUID]]:  # noqa: ANN001 - ResolveResult
    """The body partition as a set of member-id sets (order-free)."""
    return {frozenset(i.member_layer_ids) for i in result.instances}


def test_an_unbanded_tie_joins_nothing_two_bodies() -> None:
    """(a) CS4: a lone top tie the fill does not paint as a band -> two bodies.

    S20 25.18-25.60 m and S21 24.50-25.50 m, one accepted tie, NO geometry fact
    (the fill painted nothing between them). The tie is a surface statement.
    """
    s20 = _band("00000000-0000-0000-0000-000000000201", 25.18, INV_S20)
    s21 = _band("00000000-0000-0000-0000-000000000202", 24.50, INV_S21)
    tie = LayerEdge(layer_a_id=s20.layer_id, layer_b_id=s21.layer_id)

    result = resolve_litho_instances(layers=[s20, s21], edges=[], ties=[tie])

    assert _partition(result) == {frozenset({s20.layer_id}), frozenset({s21.layer_id})}
    # Numbered per unit, shallowest first: S21 (24.50) is #0, S20 (25.18) is #1.
    assert result.layer_to_ordinal[s21.layer_id] == 0
    assert result.layer_to_ordinal[s20.layer_id] == 1
    # The resolver names the tie it did not band, for the log and the tie status.
    assert result.unbanded_ties == (tie,)


def test_a_painted_band_joins_the_two_bands_one_body() -> None:
    """(b) The same pair with the base tie added: the fill paints a band -> one body.

    The renderer posts the geometry fact for the painted band; the fact unions.
    The tie is then banded, so it is not reported.
    """
    s20 = _band("00000000-0000-0000-0000-000000000211", 25.18, INV_S20)
    s21 = _band("00000000-0000-0000-0000-000000000212", 24.50, INV_S21)
    tie = LayerEdge(layer_a_id=s20.layer_id, layer_b_id=s21.layer_id)
    fact = LayerEdge(layer_a_id=s21.layer_id, layer_b_id=s20.layer_id)

    result = resolve_litho_instances(layers=[s20, s21], edges=[fact], ties=[tie])

    assert _partition(result) == {frozenset({s20.layer_id, s21.layer_id})}
    assert result.unbanded_ties == ()


def test_in_a_tie_fact_tie_chain_only_the_painted_pair_merges() -> None:
    """(c) Chain tie - fact - tie: only the fact-joined pair is one body.

    S20 -tie- S21 =fact= S22 -tie- S23. The fill painted one mass over S21/S22
    only, so the two outer bands keep their own bodies.
    """
    s20 = _band("00000000-0000-0000-0000-000000000221", 25.0, INV_S20)
    s21 = _band("00000000-0000-0000-0000-000000000222", 25.1, INV_S21)
    s22 = _band("00000000-0000-0000-0000-000000000223", 25.2, INV_S22)
    s23 = _band("00000000-0000-0000-0000-000000000224", 25.3, INV_S23)
    ties = [
        LayerEdge(layer_a_id=s20.layer_id, layer_b_id=s21.layer_id),
        LayerEdge(layer_a_id=s22.layer_id, layer_b_id=s23.layer_id),
    ]
    facts = [LayerEdge(layer_a_id=s21.layer_id, layer_b_id=s22.layer_id)]

    result = resolve_litho_instances(layers=[s20, s21, s22, s23], edges=facts, ties=ties)

    assert _partition(result) == {
        frozenset({s20.layer_id}),
        frozenset({s21.layer_id, s22.layer_id}),
        frozenset({s23.layer_id}),
    }
    assert set(result.unbanded_ties) == set(ties)


def test_a_tie_whose_ends_are_painted_one_mass_through_others_is_banded() -> None:
    """A tie is banded when the fill joins its ends, even through a third band.

    S20 =fact= S21 =fact= S22 with a tie S20-S22: one painted mass, one body,
    and the tie is not reported as unbanded.
    """
    s20 = _band("00000000-0000-0000-0000-000000000231", 25.0, INV_S20)
    s21 = _band("00000000-0000-0000-0000-000000000232", 25.1, INV_S21)
    s22 = _band("00000000-0000-0000-0000-000000000233", 25.2, INV_S22)
    facts = [
        LayerEdge(layer_a_id=s20.layer_id, layer_b_id=s21.layer_id),
        LayerEdge(layer_a_id=s21.layer_id, layer_b_id=s22.layer_id),
    ]
    ties = [LayerEdge(layer_a_id=s20.layer_id, layer_b_id=s22.layer_id)]

    result = resolve_litho_instances(layers=[s20, s21, s22], edges=facts, ties=ties)

    assert len(result.instances) == 1
    assert result.unbanded_ties == ()


def test_facts_never_cross_units_and_a_cross_unit_tie_is_not_unbanded() -> None:
    """(d) Never-weld stays: a fact across ZAND / ZAND (SL:M) joins nothing.

    A tie across two units states a shared surface by design (it can never be one
    body), so it is not reported as an unbanded tie either.
    """
    zand = _band("00000000-0000-0000-0000-000000000241", 2.0, INV_S20, F_ZAND)
    silty = _band("00000000-0000-0000-0000-000000000242", 2.1, INV_S21, F_ZAND_SLM)
    edge = LayerEdge(layer_a_id=zand.layer_id, layer_b_id=silty.layer_id)

    result = resolve_litho_instances(layers=[zand, silty], edges=[edge], ties=[edge])

    assert len(result.instances) == 2
    assert result.unbanded_ties == ()


def test_a_dangling_tie_is_ignored() -> None:
    """A tie whose endpoint left the model is neither unioned nor reported."""
    s20 = _band("00000000-0000-0000-0000-000000000251", 25.0, INV_S20)
    gone = UUID("00000000-0000-0000-0000-0000000002ff")
    tie = LayerEdge(layer_a_id=s20.layer_id, layer_b_id=gone)

    result = resolve_litho_instances(layers=[s20], edges=[], ties=[tie])

    assert len(result.instances) == 1
    assert result.unbanded_ties == ()
