"""Shared real-data-shaped fixture builders for the implicit stratigraphic builder tests.

Each factory returns a sequence of columns (one per investigation location) suitable
for passing directly to ``build_stratigraphic_order`` and later stages.  The shapes
are deliberately modelled after the kinds of sequences that appear in real BE/NL
projects (interbedding, pinching lenses, conflicting dips from a non-conformable
boundary) rather than idealized layer-cake stacks — the lesson from the loft builder
is that test data that doesn't look like the real data misses the real bugs.

All factories return ``list[tuple[OrderInputUnit, ...]]`` where ``OrderInputUnit``
is imported from the stage module.  No xyz coordinates are attached yet (Stage 2
extends these fixtures with spatial positions).

Fixture catalogue
-----------------
interbedded_columns
    Three columns with a ZAND/SILT/ZAND/SILT/KLEI interbedded sequence.
    The two ZAND occurrences are distinct stratigraphic instances (distinct
    instance_keys); likewise the two SILTs.  Depths vary column-to-column to
    simulate a dipping contact.

pinch_columns
    A SILT lens that is present only in the MIDDLE column; the outer columns
    go straight from ZAND to KLEI.  The lens yields exactly one SILT horizon
    in the output StratColumn.

conflicting_columns
    Two columns with the SAME two instance_keys in REVERSED order:
    column A has SAND above CLAY, column B has CLAY above SAND.  This is a
    non-conformable cycle (a fault / unconformity) and must trigger
    ``NonConformableError``.
"""

from __future__ import annotations

from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

# ---------------------------------------------------------------------------
# interbedded_columns
# ---------------------------------------------------------------------------


def interbedded_columns() -> list[tuple[OrderInputUnit, ...]]:
    """Return three investigation columns with a ZAND/SILT/ZAND/SILT/KLEI sequence.

    The stratigraphic sequence has five distinct instances:
    - ``zand1``  — upper ZAND body (youngest / shallowest)
    - ``silt1``  — upper SILT interbed
    - ``zand2``  — lower ZAND body
    - ``silt2``  — lower SILT interbed
    - ``klei1``  — basal KLEI unit (oldest / deepest)

    All three columns carry all five instances in the same top-down order,
    with distinct ``contact_id`` per column (three separate investigation picks
    of the same bodies).  Depths/coordinates arrive in Stage 2; at Stage 1 only
    the instance order and identity matter.

    Returns
    -------
    list of tuple of OrderInputUnit
        Three columns, each an ordered (top → bottom) tuple of units.
    """
    # Column A — leftmost investigation
    col_a: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="zand1", formation_id="ZAND", contact_id="ca-zand1-top"),
        OrderInputUnit(instance_key="silt1", formation_id="SILT", contact_id="ca-silt1-top"),
        OrderInputUnit(instance_key="zand2", formation_id="ZAND", contact_id="ca-zand2-top"),
        OrderInputUnit(instance_key="silt2", formation_id="SILT", contact_id="ca-silt2-top"),
        OrderInputUnit(instance_key="klei1", formation_id="KLEI", contact_id="ca-klei1-top"),
    )

    # Column B — middle investigation (slightly deeper contacts, simulating dip)
    col_b: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="zand1", formation_id="ZAND", contact_id="cb-zand1-top"),
        OrderInputUnit(instance_key="silt1", formation_id="SILT", contact_id="cb-silt1-top"),
        OrderInputUnit(instance_key="zand2", formation_id="ZAND", contact_id="cb-zand2-top"),
        OrderInputUnit(instance_key="silt2", formation_id="SILT", contact_id="cb-silt2-top"),
        OrderInputUnit(instance_key="klei1", formation_id="KLEI", contact_id="cb-klei1-top"),
    )

    # Column C — rightmost investigation (shallower contacts, simulating dip reversal)
    col_c: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="zand1", formation_id="ZAND", contact_id="cc-zand1-top"),
        OrderInputUnit(instance_key="silt1", formation_id="SILT", contact_id="cc-silt1-top"),
        OrderInputUnit(instance_key="zand2", formation_id="ZAND", contact_id="cc-zand2-top"),
        OrderInputUnit(instance_key="silt2", formation_id="SILT", contact_id="cc-silt2-top"),
        OrderInputUnit(instance_key="klei1", formation_id="KLEI", contact_id="cc-klei1-top"),
    )

    return [col_a, col_b, col_c]


# ---------------------------------------------------------------------------
# pinch_columns
# ---------------------------------------------------------------------------


def pinch_columns() -> list[tuple[OrderInputUnit, ...]]:
    """Return three columns where a SILT lens pinches out (absent in outer columns).

    Geological shape:
    - Left and right columns: ZAND → KLEI (no SILT)
    - Middle column: ZAND → SILT → KLEI (SILT lens present)

    The SILT instance appears in only one column but must still generate a
    horizon in the output ``StratColumn`` because the topo-sort sees a
    zand1 → silt_lens → klei1 edge chain from the middle column.

    Returns
    -------
    list of tuple of OrderInputUnit
        Three columns; outer two have two units, middle has three.
    """
    col_left: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="zand1", formation_id="ZAND", contact_id="pl-zand1-top"),
        OrderInputUnit(instance_key="klei1", formation_id="KLEI", contact_id="pl-klei1-top"),
    )

    col_middle: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="zand1", formation_id="ZAND", contact_id="pm-zand1-top"),
        OrderInputUnit(instance_key="silt_lens", formation_id="SILT", contact_id="pm-silt-top"),
        OrderInputUnit(instance_key="klei1", formation_id="KLEI", contact_id="pm-klei1-top"),
    )

    col_right: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="zand1", formation_id="ZAND", contact_id="pr-zand1-top"),
        OrderInputUnit(instance_key="klei1", formation_id="KLEI", contact_id="pr-klei1-top"),
    )

    return [col_left, col_middle, col_right]


# ---------------------------------------------------------------------------
# conflicting_columns
# ---------------------------------------------------------------------------


def conflicting_columns() -> list[tuple[OrderInputUnit, ...]]:
    """Return two columns whose stratigraphic order is mutually contradictory.

    Column A places SAND above CLAY (SAND is younger / shallower).
    Column B places CLAY above SAND (CLAY is younger / shallower).

    These two orderings create a directed cycle in the DAG:
        sand_body → clay_body   (from column A)
        clay_body → sand_body   (from column B)

    ``build_stratigraphic_order`` must detect this cycle and raise
    ``NonConformableError`` naming both "SAND" and "CLAY" in its message.
    This fixture models a real non-conformable boundary (e.g. a fault or
    angular unconformity) that the algorithm cannot silently resolve.

    Returns
    -------
    list of tuple of OrderInputUnit
        Two columns with reversed instance order.
    """
    col_a: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="sand_body", formation_id="SAND", contact_id="ca-sand-top"),
        OrderInputUnit(instance_key="clay_body", formation_id="CLAY", contact_id="ca-clay-top"),
    )

    col_b: tuple[OrderInputUnit, ...] = (
        OrderInputUnit(instance_key="clay_body", formation_id="CLAY", contact_id="cb-clay-top"),
        OrderInputUnit(instance_key="sand_body", formation_id="SAND", contact_id="cb-sand-top"),
    )

    return [col_a, col_b]
