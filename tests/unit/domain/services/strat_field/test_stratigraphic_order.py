"""Behavioural tests for ``build_stratigraphic_order`` (Stage 1).

Comments are phrased in the spec's vocabulary — "the two ZAND occurrences are
distinct stratigraphic instances", "a cycle is a non-conformable boundary" —
NOT in implementation terms (no references to graphlib, CycleError, or DAG
internals).  This ensures a regression reads as a clear contract break rather
than an implementation mismatch.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.strat_field.lens_classification import classify_lenses
from groundmodel.domain.services.strat_field.stratigraphic_order import (
    NonConformableError,
    build_stratigraphic_order,
)

from .fixtures import (
    conflicting_columns,
    interbedded_columns,
    klei_silt_klei_columns,
    pinch_columns,
)

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


# ---------------------------------------------------------------------------
# SO-5: matrix-backbone-only ordering (lenses excluded)
# ---------------------------------------------------------------------------


def test_enclosed_lens_without_matrix_filter_is_non_conformable():
    """The KLEI/SILT/KLEI over-merge cycles when every body is ordered.

    The two bracketing KLEI units share one body identity, so the single column
    KLEI/SILT/KLEI places that body both above AND below the SILT — a directed
    cycle.  Ordering ALL bodies (no matrix filter) must surface this as a
    non-conformable boundary.  This is the RED-justifying negative case: it
    proves the lens genuinely cycles, so excluding it is what removes the cycle.
    """
    with pytest.raises(NonConformableError):
        build_stratigraphic_order(klei_silt_klei_columns())


def test_order_excludes_lenses_and_is_conformable():
    """Ordering ONLY the matrix backbone drops the enclosed lens and stays acyclic.

    With the lens (SILT) excluded, the KLEI host that bracketed it becomes the
    single matrix unit and the order builds with no cycle.  The lens lithology
    must NOT appear as an internal horizon's below-formation, and the column
    must carry exactly the matrix instances (here a single KLEI body → surface +
    floor = two horizons).
    """
    cols = klei_silt_klei_columns()
    part = classify_lenses(cols)

    # 1) it did not raise — the matrix backbone is conformable
    col = build_stratigraphic_order(cols, matrix_body_ids=part.matrix_body_ids)

    # 2) no horizon names the lens body's lithology as an internal interface
    below_formations = {h.below_formation for h in col.horizons if h.below_formation is not None}
    assert "SILT" not in below_formations

    # 3) the column carries exactly the matrix instances: N_matrix + 1 horizons.
    #    Here the single shared KLEI body is the only matrix instance → 2 horizons
    #    (surface + floor), and KLEI is the single below-formation.
    n_matrix = len(part.matrix_body_ids)
    assert n_matrix == 1
    assert len(col.horizons) == n_matrix + 1
    assert below_formations == {"KLEI"}


def test_matrix_filter_collapses_host_brackets_to_one_unit():
    """A host bracketing a removed lens collapses to a SINGLE matrix unit, not a ValueError.

    Filtering the KLEI/SILT/KLEI column to matrix bodies leaves [KLEI, KLEI] —
    the two occurrences of the SAME host body, now adjacent because the SILT
    between them was removed.  A body bracketing a removed lens is ONE matrix
    unit, so the filter must collapse the consecutive duplicate rather than
    raising the "body directly above itself" ValueError.
    """
    cols = klei_silt_klei_columns()
    part = classify_lenses(cols)
    # klei_body is the lone matrix backbone unit; silt_body is the lens.
    assert part.matrix_body_ids == frozenset({"klei_body"})
    col = build_stratigraphic_order(cols, matrix_body_ids=part.matrix_body_ids)
    # One matrix instance → surface + floor = 2 horizons; no ValueError raised.
    assert len(col.horizons) == 2


def test_matrix_collapse_keeps_first_host_contact_drops_reentry():
    """The collapse keeps the host's TOP contact and drops the lens re-entry (base) contact.

    The matrix horizon is anchored at the host's top contact; the re-entry contact at
    the BASE of the bracketing host (the contact below the removed lens) is a lens-level
    detail and must NOT become a second matrix control point at the wrong depth.

    In ``klei_silt_klei_columns()`` the two KLEI occurrences carry DISTINCT contact_ids:
    the first (top) is ``"k-klei-top"`` and the re-entry (base) is ``"k-klei-base"``.
    Collapsing the consecutive duplicate keeps the first occurrence, so the surviving
    surface horizon must reference ``"k-klei-top"`` and never ``"k-klei-base"``.
    """
    cols = klei_silt_klei_columns()
    part = classify_lenses(cols)
    col = build_stratigraphic_order(cols, matrix_body_ids=part.matrix_body_ids)

    # Single matrix instance (KLEI) → surface (rank 0) + floor (rank 1).
    # The surface horizon carries the host's top-contact id.
    all_contact_ids = {cid for h in col.horizons for cid in h.contact_ids}
    assert "k-klei-top" in all_contact_ids, (
        f"Expected the host's TOP contact id to survive but got {all_contact_ids}"
    )
    assert "k-klei-base" not in all_contact_ids, (
        "The dropped lens re-entry (base) contact must NOT become a matrix control point "
        f"but it appears in {all_contact_ids}"
    )


def test_matrix_body_ids_none_equals_no_arg_default():
    """Passing ``matrix_body_ids=None`` is identical to the no-argument call.

    The new parameter must be a pure addition: the default path (None) orders
    every body exactly as before, so an existing fixture produces the same
    StratColumn whether or not the parameter is supplied.
    """
    cols = interbedded_columns()
    assert build_stratigraphic_order(cols, matrix_body_ids=None) == build_stratigraphic_order(cols)
