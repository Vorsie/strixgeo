"""Unit tests for bridging litho correlations across columns with no packing.

Owner ruling (2026-08-04 late evening):

    the pairing must connect CPT to CPT ACROSS intervening borehole columns on
    the section (today ties stop at borehole columns because adjacency is
    column-neighbour based; the v2 partition engine already supports jump ties,
    so propose CPT<->CPT pairs that skip undivided borehole columns)

Auto-correlate runs BEFORE "Divide boreholes" in the new four-step pipeline, so
every borehole column is still empty of packing bands when the packing ties are
proposed.  Without a bridge a section drawn CPT - borehole - CPT proposes
nothing at all: both of its litho correlations land on a column with no geotech
stack to align.

Cases
-----
J1  A litho chain CPT - borehole - CPT proposes one CPT-to-CPT pair.
J2  Two boreholes in a row are skipped just the same.
J3  Once the borehole carries packing bands, nothing is bridged over it.
J4  The bridge never pairs two bands on the same column.
J5  A CPT that carries packing is never jumped over.
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.geotech_edge_bridging import (
    bridge_litho_edges_over_bandless_columns,
)

_CPT_A = "cpt-a"
_CPT_B = "cpt-b"
_CPT_C = "cpt-c"
_BH_1 = "bh-1"
_BH_2 = "bh-2"


def _layer(tag: int) -> UUID:
    """Build a stable, readable litho-layer id.

    Parameters
    ----------
    tag : int
        Small integer distinguishing the layer.

    Returns
    -------
    UUID
        A deterministic id.
    """
    return UUID(int=tag)


def _terminals(layer_investigation: dict[UUID, str], banded_columns: set[str]) -> set[UUID]:
    """Per-layer terminal set for tests whose scenes band whole columns."""
    return {layer for layer, inv in layer_investigation.items() if inv in banded_columns}


def test_j1_a_chain_through_a_borehole_proposes_a_cpt_to_cpt_pair() -> None:
    """J1: CPT - borehole - CPT yields the CPT pair the borehole sat between."""
    a, bh, b = _layer(1), _layer(2), _layer(3)
    bridged = bridge_litho_edges_over_bandless_columns(
        litho_edges={(a, bh), (bh, b)},
        layer_investigation={a: _CPT_A, bh: _BH_1, b: _CPT_B},
        layers_with_bands=_terminals({a: _CPT_A, bh: _BH_1, b: _CPT_B}, {_CPT_A, _CPT_B}),
    )

    assert (min(a, b), max(a, b)) in bridged
    # The original edges are still there — the bridge ADDS.
    assert (min(a, bh), max(a, bh)) in bridged
    assert (min(bh, b), max(bh, b)) in bridged


def test_j2_two_boreholes_in_a_row_are_skipped_just_the_same() -> None:
    """J2: CPT - borehole - borehole - CPT still reaches CPT to CPT."""
    a, bh1, bh2, b = _layer(1), _layer(2), _layer(3), _layer(4)
    bridged = bridge_litho_edges_over_bandless_columns(
        litho_edges={(a, bh1), (bh1, bh2), (bh2, b)},
        layer_investigation={a: _CPT_A, bh1: _BH_1, bh2: _BH_2, b: _CPT_B},
        layers_with_bands=_terminals(
            {a: _CPT_A, bh1: _BH_1, bh2: _BH_2, b: _CPT_B}, {_CPT_A, _CPT_B}
        ),
    )

    assert (min(a, b), max(a, b)) in bridged


def test_j3_a_borehole_that_carries_packing_is_not_bridged_over() -> None:
    """J3: once the borehole has bands, its own two correlations are the answer."""
    a, bh, b = _layer(1), _layer(2), _layer(3)
    bridged = bridge_litho_edges_over_bandless_columns(
        litho_edges={(a, bh), (bh, b)},
        layer_investigation={a: _CPT_A, bh: _BH_1, b: _CPT_B},
        layers_with_bands=_terminals({a: _CPT_A, bh: _BH_1, b: _CPT_B}, {_CPT_A, _BH_1, _CPT_B}),
    )

    assert (min(a, b), max(a, b)) not in bridged
    assert bridged == {(min(a, bh), max(a, bh)), (min(bh, b), max(bh, b))}


def test_j4_the_bridge_never_pairs_two_bands_on_the_same_column() -> None:
    """J4: a chain that loops back to its own column produces no self-pair."""
    a_top, bh, a_bot = _layer(1), _layer(2), _layer(3)
    bridged = bridge_litho_edges_over_bandless_columns(
        litho_edges={(a_top, bh), (bh, a_bot)},
        layer_investigation={a_top: _CPT_A, bh: _BH_1, a_bot: _CPT_A},
        layers_with_bands=_terminals({a_top: _CPT_A, bh: _BH_1, a_bot: _CPT_A}, {_CPT_A}),
    )

    assert (min(a_top, a_bot), max(a_top, a_bot)) not in bridged


def test_j5_a_cpt_that_carries_packing_is_never_jumped_over() -> None:
    """J5: A - B - C with all three divided yields no A-to-C shortcut."""
    a, b, c = _layer(1), _layer(2), _layer(3)
    bridged = bridge_litho_edges_over_bandless_columns(
        litho_edges={(a, b), (b, c)},
        layer_investigation={a: _CPT_A, b: _CPT_B, c: _CPT_C},
        layers_with_bands=_terminals({a: _CPT_A, b: _CPT_B, c: _CPT_C}, {_CPT_A, _CPT_B, _CPT_C}),
    )

    assert (min(a, c), max(a, c)) not in bridged


def test_j6_a_column_banded_only_in_another_litho_unit_is_transit_for_this_walk() -> None:
    """J6: terminal is per-LAYER, not per-investigation (review finding 3).

    CPT-B carries packing bands — but only inside a DIFFERENT litho unit than
    the one this correlation chain walks. For this chain's window B has nothing
    the derivation could align (``_stack`` would come back empty), so treating
    B as a terminal both stops the bridge AND leaves the pair to be skipped as
    an empty stack: the flanking CPTs would never be proposed at all. B must be
    transit here, exactly as if it carried no bands.
    """
    from groundmodel.application.geotech_edge_derivation import (
        bridge_edges_over_bandless_columns,
    )

    la, lb, lc = _layer(1), _layer(2), _layer(3)
    bridged = bridge_edges_over_bandless_columns(
        litho_approved_edges={(la, lb), (lb, lc)},
        litho_layer_depths={
            la: (_CPT_A, 0.0, 4.0),
            lb: (_CPT_B, 0.0, 4.0),
            lc: (_CPT_C, 0.0, 4.0),
        },
        # B's only band lives at 10-12 m — a different litho unit entirely.
        geotech_layer_by_inv_depth={
            _CPT_A: [(0.0, 4.0, _layer(11), _layer(21), 5)],
            _CPT_B: [(10.0, 12.0, _layer(12), _layer(22), 6)],
            _CPT_C: [(0.0, 4.0, _layer(13), _layer(23), 5)],
        },
    )
    assert (min(la, lc), max(la, lc)) in bridged, (
        "the bridge must walk through a column whose bands all lie outside "
        "this chain's litho window"
    )
