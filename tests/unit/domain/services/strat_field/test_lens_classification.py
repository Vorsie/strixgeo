"""Behavioural tests for the shared enclosure classifier (``classify_lenses``).

Comments are phrased in the spec's vocabulary (enclosed minority, host body,
matrix backbone, lens-in-lens, true reversal) rather than in implementation
terms, so a regression reads as a clear contract break.

The fixtures reproduce the real ``test.strix`` over-merge signature: a recurring
lithology that the resolver records both ABOVE and BELOW the same minority in one
borehole (KLEI / SILT / KLEI), under ONE shared ``instance_key``.  That shared
identity — not the lithology — is the enclosure criterion under test.
"""

from __future__ import annotations

import graphlib
from collections.abc import Sequence

import pytest

from groundmodel.domain.services.strat_field.lens_classification import (
    LensClassificationError,
    classify_lenses,
)
from groundmodel.domain.services.strat_field.lens_types import Lens, LensPartition
from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit
from tests.unit.domain.services.strat_field.fixtures import (
    klei_silt_klei_columns,
    klei_silt_zand_silt_klei_columns,
    reversed_pair_columns,
)


def _matrix_order_is_acyclic(
    columns: Sequence[Sequence[OrderInputUnit]],
    matrix_body_ids: frozenset[str],
) -> bool:
    """Return True iff the matrix-only precedence graph is acyclic (a DAG).

    Filters each column to its matrix units (preserving top→bottom order),
    builds the consecutive-pair "above → below" precedence edges over those
    units only, and asks ``graphlib.TopologicalSorter`` whether the resulting
    graph topo-sorts (no cycle).  This mirrors Stage 1's own DAG check, so a
    True result means Stage 1 would succeed on the matrix backbone.
    """
    predecessors: dict[str, set[str]] = {key: set() for key in matrix_body_ids}
    for column in columns:
        matrix_units = [u for u in column if u.instance_key in matrix_body_ids]
        for above, below in zip(matrix_units, matrix_units[1:], strict=False):
            if above.instance_key != below.instance_key:
                predecessors[below.instance_key].add(above.instance_key)
    sorter = graphlib.TopologicalSorter(predecessors)
    try:
        sorter.prepare()
    except graphlib.CycleError:
        return False
    return True


# ---------------------------------------------------------------------------
# Value-object shape
# ---------------------------------------------------------------------------


def test_lens_value_objects_are_frozen_data():
    """A Lens and a LensPartition hold their fields verbatim."""
    lens = Lens(body_id="silt_body", host_body_id="klei_body", nesting_depth=1)
    assert lens.body_id == "silt_body"
    assert lens.host_body_id == "klei_body"
    assert lens.nesting_depth == 1
    part = LensPartition(matrix_body_ids=frozenset({"klei_body"}), lenses=(lens,))
    assert part.matrix_body_ids == frozenset({"klei_body"})
    assert part.lenses == (lens,)


# ---------------------------------------------------------------------------
# Classifier behaviour
# ---------------------------------------------------------------------------


def test_enclosed_minority_is_a_lens():
    """A minority bracketed above AND below by the SAME body is a depth-1 lens."""
    # KLEI / SILT / KLEI in a column: SILT enclosed by the SAME klei body -> lens.
    part = classify_lenses(klei_silt_klei_columns())
    assert "silt_body" not in part.matrix_body_ids
    assert any(
        L.body_id == "silt_body" and L.host_body_id == "klei_body" and L.nesting_depth == 1
        for L in part.lenses
    )


def test_lens_in_lens():
    """A minority enclosed by a lens is itself a lens, one nesting level deeper."""
    # KLEI / SILT / ZAND / SILT / KLEI: SILT enclosed by KLEI, ZAND enclosed by SILT.
    part = classify_lenses(klei_silt_zand_silt_klei_columns())
    assert {L.body_id: L.nesting_depth for L in part.lenses} == {"silt_body": 1, "zand_body": 2}


def test_lens_out_yields_a_dag():
    """Removing the lenses leaves a conformable (acyclic) matrix backbone."""
    # After removing the lenses, the matrix precedence graph is acyclic.
    cols = klei_silt_klei_columns()
    part = classify_lenses(cols)
    assert _matrix_order_is_acyclic(cols, part.matrix_body_ids)


def test_true_reversal_is_not_a_lens():
    """A genuine A/B order reversal across columns is interfingering, not a lens."""
    # body A above B in column 1, B above A in column 2 (DIFFERENT columns, no
    # M/B/M sandwich) -> genuine interfingering, NOT classified as a lens.
    part = classify_lenses(reversed_pair_columns())
    assert part.lenses == ()  # nothing enclosed; the cycle stays (Stage 1 will raise)


def test_residual_matrix_cycle_raises():
    """A lens found, but the matrix still cycles (true reversal co-exists) -> error."""
    # B is enclosed by A: column [A, B, A] -> B classified as lens.
    # C and D form a genuine reversal: [C, D] and [D, C] -> matrix {A, C, D} stays cyclic.
    enclosed = (
        OrderInputUnit("a_body", "KLEI", "e-a-top"),
        OrderInputUnit("b_body", "SILT", "e-b-top"),
        OrderInputUnit("a_body", "KLEI", "e-a-base"),
    )
    reversal_1 = (
        OrderInputUnit("c_body", "ZAND", "r1-c-top"),
        OrderInputUnit("d_body", "VEEN", "r1-d-top"),
    )
    reversal_2 = (
        OrderInputUnit("d_body", "VEEN", "r2-d-top"),
        OrderInputUnit("c_body", "ZAND", "r2-c-top"),
    )
    with pytest.raises(LensClassificationError):
        classify_lenses([enclosed, reversal_1, reversal_2])
