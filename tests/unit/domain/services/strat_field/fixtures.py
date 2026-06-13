"""Shared real-data-shaped fixture builders for the implicit stratigraphic builder tests.

Each factory returns a sequence of columns (one per investigation location) suitable
for passing directly to ``build_stratigraphic_order`` and later stages.  The shapes
are deliberately modelled after the kinds of sequences that appear in real BE/NL
projects (interbedding, pinching lenses, conflicting dips from a non-conformable
boundary) rather than idealized layer-cake stacks — the lesson from the loft builder
is that test data that doesn't look like the real data misses the real bugs.

Stage-1 builders return ``list[tuple[OrderInputUnit, ...]]``.
Stage-2 builders return ``list[InvestigationColumn]`` — these carry real map
coordinates and surface elevations so that contact elevations (z = surface_elev −
top_depth) can be verified.  The same instance_key / contact_id values used by the
Stage-1 builders are deliberately reused in the Stage-2 builders so that
``build_stratigraphic_order(interbedded_columns())`` produces a StratColumn whose
``rank_by_contact_id`` correctly resolves the Stage-2 contact_ids.

Fixture catalogue
-----------------
Stage 1 (order-only)
~~~~~~~~~~~~~~~~~~~~
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

Stage 2 (order + xyz)
~~~~~~~~~~~~~~~~~~~~~
interbedded_columns_with_xyz
    Three ``InvestigationColumn`` objects corresponding to the three columns in
    ``interbedded_columns``.  Each column carries Lambert-72-style x/y positions,
    a surface elevation in metres TAW, and per-unit top depths.  The contact_ids
    match ``interbedded_columns`` exactly so the two fixtures compose correctly.

dipping_columns_with_xyz
    Three ``InvestigationColumn`` objects that carry a KLEI/ZAND/VEEN sequence
    (3 instances → 4 horizons) with clearly dipping contacts: the ZAND/VEEN
    interface descends from west to east, and the KLEI/ZAND interface is flat.
    Used to verify that orientation constraints have gz > 0.5.

dipping_order_columns
    The Stage-1 counterpart of ``dipping_columns_with_xyz`` (just OrderInputUnit
    tuples, no xyz) so the tests can call ``build_stratigraphic_order`` for the
    dipping fixture without constructing a StratColumn from scratch.

two_columns_with_xyz
    Two ``InvestigationColumn`` objects using the same instance_keys as
    ``interbedded_columns``.  Smaller than the full three-column fixture; used
    by the section-contact additive test (CP-5) as the borehole-only baseline
    before section contacts are added.
"""

from __future__ import annotations

from groundmodel.domain.services.strat_field.control_data import (
    ContactObservation,
    InvestigationColumn,
)
from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

# ---------------------------------------------------------------------------
# Stage 1 — interbedded_columns
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
# Stage 1 — pinch_columns
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
# Stage 1 — conflicting_columns
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


# ---------------------------------------------------------------------------
# Stage 2 — interbedded_columns_with_xyz
# ---------------------------------------------------------------------------

# Lambert-72 grid positions used for the three interbedded columns.
# Placed 200 m apart on a roughly east-west line, typical of a BE site.
_INTER_COL_A_X = 200_000.0
_INTER_COL_A_Y = 200_000.0
_INTER_COL_B_X = 200_200.0
_INTER_COL_B_Y = 200_000.0
_INTER_COL_C_X = 200_400.0
_INTER_COL_C_Y = 200_000.0


def interbedded_columns_with_xyz() -> list[InvestigationColumn]:
    """Three ``InvestigationColumn`` objects for the interbedded ZAND/SILT/ZAND/SILT/KLEI fixture.

    The contact_ids exactly mirror ``interbedded_columns()`` so the two fixtures
    compose correctly: calling ``build_stratigraphic_order(interbedded_columns())``
    gives a StratColumn whose contact_id→rank map resolves every contact_id used here.

    Surface elevations and top-depths are chosen to produce clearly non-degenerate
    elevations (z = surface_elev − top_depth) while keeping the numbers easy to
    verify mentally.

    Spatial layout (Lambert-72 approximate):
    - Column A at (200_000, 200_000) — surface 5.0 m TAW
    - Column B at (200_200, 200_000) — surface 4.5 m TAW (slight dip west→east)
    - Column C at (200_400, 200_000) — surface 4.0 m TAW

    Returns
    -------
    list of InvestigationColumn
        Three columns, each with five units ordered top → bottom.
    """
    col_a = InvestigationColumn(
        investigation_id="bh-A",
        x=_INTER_COL_A_X,
        y=_INTER_COL_A_Y,
        surface_elev_m=5.0,
        units=(
            # rank 0 (surface) — top of zand1 at ground level → SKIP in control data
            ContactObservation("zand1", "ZAND", "ca-zand1-top", top_depth_m=0.0),
            # rank 1 (internal) — top of silt1 at 2.0 m depth → z = 3.0 m
            ContactObservation("silt1", "SILT", "ca-silt1-top", top_depth_m=2.0),
            # rank 2 (internal) — top of zand2 at 4.0 m depth → z = 1.0 m
            ContactObservation("zand2", "ZAND", "ca-zand2-top", top_depth_m=4.0),
            # rank 3 (internal) — top of silt2 at 6.0 m depth → z = -1.0 m
            ContactObservation("silt2", "SILT", "ca-silt2-top", top_depth_m=6.0),
            # rank 4 (internal) — top of klei1 at 8.0 m depth → z = -3.0 m
            ContactObservation("klei1", "KLEI", "ca-klei1-top", top_depth_m=8.0),
        ),
    )

    col_b = InvestigationColumn(
        investigation_id="bh-B",
        x=_INTER_COL_B_X,
        y=_INTER_COL_B_Y,
        surface_elev_m=4.5,
        units=(
            ContactObservation("zand1", "ZAND", "cb-zand1-top", top_depth_m=0.0),
            ContactObservation("silt1", "SILT", "cb-silt1-top", top_depth_m=2.5),
            ContactObservation("zand2", "ZAND", "cb-zand2-top", top_depth_m=4.5),
            ContactObservation("silt2", "SILT", "cb-silt2-top", top_depth_m=6.5),
            ContactObservation("klei1", "KLEI", "cb-klei1-top", top_depth_m=8.5),
        ),
    )

    col_c = InvestigationColumn(
        investigation_id="bh-C",
        x=_INTER_COL_C_X,
        y=_INTER_COL_C_Y,
        surface_elev_m=4.0,
        units=(
            ContactObservation("zand1", "ZAND", "cc-zand1-top", top_depth_m=0.0),
            ContactObservation("silt1", "SILT", "cc-silt1-top", top_depth_m=3.0),
            ContactObservation("zand2", "ZAND", "cc-zand2-top", top_depth_m=5.0),
            ContactObservation("silt2", "SILT", "cc-silt2-top", top_depth_m=7.0),
            ContactObservation("klei1", "KLEI", "cc-klei1-top", top_depth_m=9.0),
        ),
    )

    return [col_a, col_b, col_c]


# ---------------------------------------------------------------------------
# Stage 2 — dipping fixture (3 instances, 4 horizons)
# ---------------------------------------------------------------------------

# Three columns on a north-south line; the ZAND/VEEN boundary dips 2 m over 400 m
# (a gentle but clearly non-zero dip).  NOTE: Stage-2 v1 always emits a pure
# (0, 0, -1) orientation regardless of this dip — the dip data is here so the
# future v2 in-plane dip refinement can be tested against a non-flat horizon on
# the same fixture.
_DIP_COL_W_X = 201_000.0
_DIP_COL_W_Y = 201_000.0
_DIP_COL_M_X = 201_000.0
_DIP_COL_M_Y = 201_200.0
_DIP_COL_E_X = 201_000.0
_DIP_COL_E_Y = 201_400.0


def dipping_order_columns() -> list[tuple[OrderInputUnit, ...]]:
    """Stage-1 counterpart of ``dipping_columns_with_xyz``: order-only, no xyz.

    Three instances in stratigraphic order (top → bottom):
    - ``klei_top``  — surface KLEI unit
    - ``zand_mid``  — middle ZAND body
    - ``veen_base`` — basal VEEN unit

    Returns
    -------
    list of tuple of OrderInputUnit
        Three columns, each with three units.
    """
    col_w: tuple[OrderInputUnit, ...] = (
        OrderInputUnit("klei_top", "KLEI", "dw-klei-top"),
        OrderInputUnit("zand_mid", "ZAND", "dw-zand-top"),
        OrderInputUnit("veen_base", "VEEN", "dw-veen-top"),
    )
    col_m: tuple[OrderInputUnit, ...] = (
        OrderInputUnit("klei_top", "KLEI", "dm-klei-top"),
        OrderInputUnit("zand_mid", "ZAND", "dm-zand-top"),
        OrderInputUnit("veen_base", "VEEN", "dm-veen-top"),
    )
    col_e: tuple[OrderInputUnit, ...] = (
        OrderInputUnit("klei_top", "KLEI", "de-klei-top"),
        OrderInputUnit("zand_mid", "ZAND", "de-zand-top"),
        OrderInputUnit("veen_base", "VEEN", "de-veen-top"),
    )
    return [col_w, col_m, col_e]


def dipping_columns_with_xyz() -> list[InvestigationColumn]:
    """Three ``InvestigationColumn`` objects with a dipping KLEI/ZAND/VEEN sequence.

    The KLEI/ZAND contact is flat at −3.0 m TAW across all columns.
    The ZAND/VEEN contact dips from −5.0 m (west) to −7.0 m (east) —
    a 2 m dip over 400 m (slope ≈ 1:200).

    These are the same contact_ids used in ``dipping_order_columns`` so that
    ``build_stratigraphic_order(dipping_order_columns())`` resolves all ranks.

    Returns
    -------
    list of InvestigationColumn
        Three columns ordered west → east (north-south line, increasing y).
    """
    col_w = InvestigationColumn(
        investigation_id="cpt-W",
        x=_DIP_COL_W_X,
        y=_DIP_COL_W_Y,
        surface_elev_m=1.0,
        units=(
            # rank 0 (surface) — top of klei_top at ground → z = 1.0 m → SKIP
            ContactObservation("klei_top", "KLEI", "dw-klei-top", top_depth_m=0.0),
            # rank 1 (internal) — top of zand_mid at 4.0 m → z = -3.0 m
            ContactObservation("zand_mid", "ZAND", "dw-zand-top", top_depth_m=4.0),
            # rank 2 (internal) — top of veen_base at 6.0 m → z = -5.0 m
            ContactObservation("veen_base", "VEEN", "dw-veen-top", top_depth_m=6.0),
        ),
    )

    col_m = InvestigationColumn(
        investigation_id="cpt-M",
        x=_DIP_COL_M_X,
        y=_DIP_COL_M_Y,
        surface_elev_m=1.0,
        units=(
            ContactObservation("klei_top", "KLEI", "dm-klei-top", top_depth_m=0.0),
            # flat klei/zand contact — same z as col_w
            ContactObservation("zand_mid", "ZAND", "dm-zand-top", top_depth_m=4.0),
            # zand/veen dips: 1 m deeper than col_w
            ContactObservation("veen_base", "VEEN", "dm-veen-top", top_depth_m=7.0),
        ),
    )

    col_e = InvestigationColumn(
        investigation_id="cpt-E",
        x=_DIP_COL_E_X,
        y=_DIP_COL_E_Y,
        surface_elev_m=1.0,
        units=(
            ContactObservation("klei_top", "KLEI", "de-klei-top", top_depth_m=0.0),
            # flat klei/zand contact
            ContactObservation("zand_mid", "ZAND", "de-zand-top", top_depth_m=4.0),
            # zand/veen dips: 2 m deeper than col_w
            ContactObservation("veen_base", "VEEN", "de-veen-top", top_depth_m=8.0),
        ),
    )

    return [col_w, col_m, col_e]


# ---------------------------------------------------------------------------
# Stage 2 — two_columns_with_xyz (minimal borehole baseline for CP-5)
# ---------------------------------------------------------------------------


def two_columns_with_xyz() -> list[InvestigationColumn]:
    """Two ``InvestigationColumn`` objects using the interbedded instance_keys.

    Smaller than the full three-column fixture; used as the borehole-only
    baseline in CP-5 (section contacts add control points) so that adding a
    section contact produces a count > the two-column baseline.

    Uses the same contact_ids as columns A and B from ``interbedded_columns``
    so the interbedded StratColumn resolves all ranks correctly.

    Returns
    -------
    list of InvestigationColumn
        Two columns.
    """
    col_a = InvestigationColumn(
        investigation_id="bh-A-small",
        x=_INTER_COL_A_X,
        y=_INTER_COL_A_Y,
        surface_elev_m=5.0,
        units=(
            ContactObservation("zand1", "ZAND", "ca-zand1-top", top_depth_m=0.0),
            ContactObservation("silt1", "SILT", "ca-silt1-top", top_depth_m=2.0),
            ContactObservation("zand2", "ZAND", "ca-zand2-top", top_depth_m=4.0),
            ContactObservation("silt2", "SILT", "ca-silt2-top", top_depth_m=6.0),
            ContactObservation("klei1", "KLEI", "ca-klei1-top", top_depth_m=8.0),
        ),
    )

    col_b = InvestigationColumn(
        investigation_id="bh-B-small",
        x=_INTER_COL_B_X,
        y=_INTER_COL_B_Y,
        surface_elev_m=4.5,
        units=(
            ContactObservation("zand1", "ZAND", "cb-zand1-top", top_depth_m=0.0),
            ContactObservation("silt1", "SILT", "cb-silt1-top", top_depth_m=2.5),
            ContactObservation("zand2", "ZAND", "cb-zand2-top", top_depth_m=4.5),
            ContactObservation("silt2", "SILT", "cb-silt2-top", top_depth_m=6.5),
            ContactObservation("klei1", "KLEI", "cb-klei1-top", top_depth_m=8.5),
        ),
    )

    return [col_a, col_b]
