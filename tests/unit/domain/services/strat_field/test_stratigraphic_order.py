"""Behavioural tests for ``build_stratigraphic_order`` (Stage 1).

Comments are phrased in the spec's vocabulary — "the two ZAND occurrences are
distinct stratigraphic instances", "a cycle is a non-conformable boundary" —
NOT in implementation terms (no references to graphlib, CycleError, or DAG
internals).  This ensures a regression reads as a clear contract break rather
than an implementation mismatch.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.strat_field.stratigraphic_order import (
    NonConformableError,
    build_stratigraphic_order,
)

from .fixtures import conflicting_columns, interbedded_columns, pinch_columns

# ---------------------------------------------------------------------------
# SO-1: interbedded sequence
# ---------------------------------------------------------------------------


def test_interbedded_sequence_sorts_top_to_bottom():
    """The five-instance ZAND/SILT/ZAND/SILT/KLEI column sorts top-down (ascending rank)."""
    col = build_stratigraphic_order(interbedded_columns())
    ranks = [h.rank for h in col.horizons]
    assert ranks == sorted(ranks)


def test_interbedded_produces_six_horizons():
    """Five instances yield exactly six horizons: surface + 4 internal + floor."""
    col = build_stratigraphic_order(interbedded_columns())
    assert len(col.horizons) == 6


def test_interbedded_surface_horizon_has_no_above():
    """Rank-0 horizon is the model surface — nothing above it."""
    col = build_stratigraphic_order(interbedded_columns())
    assert col.horizons[0].above_formation is None


def test_interbedded_floor_horizon_has_no_below():
    """The deepest horizon is open at the base — nothing below it."""
    col = build_stratigraphic_order(interbedded_columns())
    assert col.horizons[-1].below_formation is None


def test_interbedded_two_zand_occurrences_get_distinct_ranks():
    """The two ZAND instances are distinct bodies — they must occupy different horizon ranks.

    A layer-cake implementation that merges them by formation_id would produce
    only one ZAND-below horizon; the correct model must produce two, each at a
    different rank (the core interbedding invariant).
    """
    col = build_stratigraphic_order(interbedded_columns())
    zand_below_ranks = [h.rank for h in col.horizons if h.below_formation == "ZAND"]
    assert len(zand_below_ranks) == 2, (
        f"Expected 2 ZAND-below horizons (two distinct ZAND instances) but got {zand_below_ranks}"
    )
    assert zand_below_ranks[0] != zand_below_ranks[1]


def test_interbedded_iso_values_are_monotonically_increasing():
    """iso_value increases strictly with rank (the field's ordering contract)."""
    col = build_stratigraphic_order(interbedded_columns())
    iso_values = [h.iso_value for h in col.horizons]
    assert iso_values == sorted(iso_values)
    # strictly increasing — no two horizons share an iso_value
    assert len(set(iso_values)) == len(iso_values)


def test_interbedded_contact_ids_populated():
    """Every internal horizon carries at least one contact_id from the input columns."""
    col = build_stratigraphic_order(interbedded_columns())
    # Every internal horizon carries at least one contact_id from the input
    # columns — the minimum the field solver needs to locate the interface.
    internal = [
        h for h in col.horizons if h.above_formation is not None and h.below_formation is not None
    ]
    for h in internal:
        assert len(h.contact_ids) >= 1, f"Horizon rank={h.rank} has no contact_ids"


# ---------------------------------------------------------------------------
# SO-2: pinch column
# ---------------------------------------------------------------------------


def test_pinch_unit_still_takes_one_rank():
    """A SILT lens present in only one column still generates a horizon."""
    col = build_stratigraphic_order(pinch_columns())
    assert any(h.below_formation == "SILT" for h in col.horizons), (
        "Expected a SILT-below horizon from the middle-column lens but none found"
    )


def test_pinch_column_produces_four_horizons():
    """Three instances (ZAND, SILT lens, KLEI) yield exactly four horizons."""
    col = build_stratigraphic_order(pinch_columns())
    assert len(col.horizons) == 4


# ---------------------------------------------------------------------------
# SO-3: non-conformable / cycle detection
# ---------------------------------------------------------------------------


def test_non_conformable_order_raises_with_the_offending_pair():
    """Reversed ordering across two columns (cycle) raises NonConformableError.

    The error message must name both offending formations so the engineer
    can locate the fault/unconformity in the data without reading source code.
    """
    with pytest.raises(NonConformableError) as exc_info:
        build_stratigraphic_order(conflicting_columns())
    msg = str(exc_info.value)
    assert "SAND" in msg and "CLAY" in msg, (
        f"NonConformableError message should name both formations but got: {msg!r}"
    )


# ---------------------------------------------------------------------------
# SO-4: single-column degenerate cases
# ---------------------------------------------------------------------------


def test_single_column_two_units_produces_three_horizons():
    """One column with two units: surface + one internal + floor = 3 horizons."""
    from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

    col = build_stratigraphic_order(
        [
            (
                OrderInputUnit(instance_key="sand", formation_id="SAND", contact_id="c1"),
                OrderInputUnit(instance_key="clay", formation_id="CLAY", contact_id="c2"),
            )
        ]
    )
    assert len(col.horizons) == 3
    assert col.horizons[0].above_formation is None
    assert col.horizons[0].below_formation == "SAND"
    assert col.horizons[1].above_formation == "SAND"
    assert col.horizons[1].below_formation == "CLAY"
    assert col.horizons[2].above_formation == "CLAY"
    assert col.horizons[2].below_formation is None


def test_formation_id_mismatch_raises_value_error():
    """If the same instance_key maps to two different formation_ids, raise ValueError."""
    from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

    with pytest.raises(ValueError, match="instance_key"):
        build_stratigraphic_order(
            [
                (OrderInputUnit(instance_key="x", formation_id="SAND", contact_id="c1"),),
                (OrderInputUnit(instance_key="x", formation_id="CLAY", contact_id="c2"),),
            ]
        )


def test_empty_input_returns_empty_strat_column():
    """No columns (or only empty columns) yields an empty StratColumn, not a crash.

    A cross-section with zero in-corridor investigations is a legitimate input
    the orchestrator can hand us; it must come back as "nothing to build here",
    not an opaque IndexError.
    """
    assert build_stratigraphic_order([]).horizons == ()
    assert build_stratigraphic_order([(), ()]).horizons == ()


def test_same_instance_key_twice_in_one_column_raises_value_error():
    """A body listed directly above itself in one column is a caller data bug.

    This is a data-model violation (the same physical body cannot be its own
    overlying unit), reported as a ValueError naming the offending key — NOT a
    NonConformableError, which is reserved for genuine geological cycles.
    """
    from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

    with pytest.raises(ValueError, match="instance_key"):
        build_stratigraphic_order(
            [
                (
                    OrderInputUnit(instance_key="dup", formation_id="SAND", contact_id="c1"),
                    OrderInputUnit(instance_key="dup", formation_id="SAND", contact_id="c2"),
                )
            ]
        )
