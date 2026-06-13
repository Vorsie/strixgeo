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

from dataclasses import dataclass

from groundmodel.domain.services.strat_field.control_data import (
    ContactObservation,
    InvestigationColumn,
    build_control_data,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    StratColumn,
    StratControlData,
)
from groundmodel.domain.services.strat_field.stratigraphic_order import (
    OrderInputUnit,
    build_stratigraphic_order,
)

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


# ---------------------------------------------------------------------------
# Stage 3 — control + holes builders (the potential-field gate fixtures)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BoreholeProbe:
    """A vertical probe down one investigation, for the monotonicity gate.

    Carries the map position and surface elevation of a borehole/CPT together
    with a dense descending sample of (x, y, z) points and the observed
    internal contacts.  The Stage-3 tests evaluate the fitted potential field
    at ``xyz_descending`` (which must be non-decreasing down the hole) and at
    each contact elevation (where ``F`` must cross that horizon's iso-value).

    Parameters
    ----------
    investigation_id : str
        Identifier of the source investigation (for assertion messages).
    x : float
        Easting in metres (project CRS).
    y : float
        Northing in metres (project CRS).
    surface : float
        Ground surface elevation in metres (positive upward, TAW/NAP datum).
    xyz_descending : tuple of (float, float, float)
        Vertical samples from the surface DOWN to the deepest contact (a few
        metres apart), at this hole's (x, y).  Strictly descending in z.
    observed_contacts : tuple of (int, float)
        ``(horizon_rank, depth_m)`` for each INTERNAL contact in this hole.
        The contact elevation is ``surface - depth_m``; the field must cross
        that horizon's iso-value there.
    """

    investigation_id: str
    x: float
    y: float
    surface: float
    xyz_descending: tuple[tuple[float, float, float], ...]
    observed_contacts: tuple[tuple[int, float], ...]


def _probes_from_columns(
    columns: list[InvestigationColumn],
    order: StratColumn,
    *,
    extra_margin_m: float = 1.0,
    sample_step_m: float = 1.0,
) -> list[BoreholeProbe]:
    """Build descending probes from investigation columns + the stratigraphic order.

    The observed depths come straight from the same columns that produced the
    control data, so the contact elevations the gate checks are exactly the
    elevations the field was constrained to — no independent numbers to drift.

    Parameters
    ----------
    columns : list of InvestigationColumn
        The same columns passed to ``build_control_data``.
    order : StratColumn
        The stratigraphic column, used to resolve each contact_id to its rank
        and to skip the surface (rank 0) + floor (rank N) horizons (which carry
        no internal control points).
    extra_margin_m : float, optional
        Extra depth sampled below the deepest internal contact, so the probe
        spans past the last constraint.  Default 1.0 m.
    sample_step_m : float, optional
        Vertical spacing of the descending samples.  Default 1.0 m.

    Returns
    -------
    list of BoreholeProbe
        One probe per investigation column.
    """
    rank_by_contact_id: dict[str, int] = {}
    n_horizons = len(order.horizons)
    floor_rank = n_horizons - 1
    for horizon in order.horizons:
        for cid in horizon.contact_ids:
            rank_by_contact_id[cid] = horizon.rank

    probes: list[BoreholeProbe] = []
    for col in columns:
        observed: list[tuple[int, float]] = []
        deepest_depth = 0.0
        for unit in col.units:
            rank = rank_by_contact_id.get(unit.contact_id)
            if rank is None or not (1 <= rank < floor_rank):
                continue
            observed.append((rank, unit.top_depth_m))
            deepest_depth = max(deepest_depth, unit.top_depth_m)

        # Dense descending samples from the surface down past the deepest contact.
        z_top = col.surface_elev_m
        z_bottom = col.surface_elev_m - (deepest_depth + extra_margin_m)
        samples: list[tuple[float, float, float]] = []
        z = z_top
        while z >= z_bottom - 1e-9:
            samples.append((col.x, col.y, z))
            z -= sample_step_m

        probes.append(
            BoreholeProbe(
                investigation_id=col.investigation_id,
                x=col.x,
                y=col.y,
                surface=col.surface_elev_m,
                xyz_descending=tuple(samples),
                observed_contacts=tuple(observed),
            )
        )
    return probes


def _block_from_columns(
    columns: list[InvestigationColumn],
    *,
    xy_margin_m: float = 50.0,
    z_margin_m: float = 5.0,
) -> Block:
    """Build the v1 single ``Block`` bounding all investigation columns.

    The polygon is the axis-aligned bounding rectangle of the column (x, y)
    positions inflated by ``xy_margin_m``; z_min/z_max bracket the deepest /
    shallowest contact elevation with ``z_margin_m`` of head-/foot-room.

    Parameters
    ----------
    columns : list of InvestigationColumn
        The investigation columns whose extent defines the block.
    xy_margin_m : float, optional
        Horizontal margin added on every side of the bounding rectangle.
    z_margin_m : float, optional
        Vertical margin added above the shallowest and below the deepest
        contact elevation.

    Returns
    -------
    Block
        A rectangular prism that brackets the control data with a margin.
    """
    xs = [c.x for c in columns]
    ys = [c.y for c in columns]
    elevs: list[float] = []
    for c in columns:
        for unit in c.units:
            elevs.append(c.surface_elev_m - unit.top_depth_m)
        elevs.append(c.surface_elev_m)

    x_min, x_max = min(xs) - xy_margin_m, max(xs) + xy_margin_m
    y_min, y_max = min(ys) - xy_margin_m, max(ys) + xy_margin_m
    polygon = (
        (x_min, y_min),
        (x_max, y_min),
        (x_max, y_max),
        (x_min, y_max),
    )
    return Block(
        polygon=polygon,
        z_min=min(elevs) - z_margin_m,
        z_max=max(elevs) + z_margin_m,
    )


def interbedded_control_with_holes() -> tuple[StratControlData, StratColumn, list[BoreholeProbe]]:
    """Stage-3 interbedded gate fixture: control data + order + descending probes.

    Composes ``interbedded_columns`` (order) with ``interbedded_columns_with_xyz``
    (xyz) into a :class:`StratControlData`, and derives one descending
    :class:`BoreholeProbe` per column from the SAME xyz data so the observed
    contact depths the monotonicity gate checks match the control points
    exactly.

    Returns
    -------
    (StratControlData, StratColumn, list of BoreholeProbe)
        The solver input, the stratigraphic column, and the per-hole probes.
    """
    order = build_stratigraphic_order(interbedded_columns())
    xyz_columns = interbedded_columns_with_xyz()
    control = build_control_data(xyz_columns, [], order)
    holes = _probes_from_columns(xyz_columns, order)
    return control, order, holes


def dipping_control_with_holes() -> tuple[StratControlData, StratColumn, list[BoreholeProbe]]:
    """Stage-3 dipping gate fixture: control data + order + descending probes.

    Composes ``dipping_order_columns`` with ``dipping_columns_with_xyz`` so the
    rank-1 (KLEI/ZAND) horizon is flat but the rank-2 (ZAND/VEEN) horizon dips —
    deeper on the east (down-dip) side than the west (up-dip) side.  The dip test
    samples the field at the west/east column x-positions and checks the rank-2
    isosurface is deeper down-dip.

    Returns
    -------
    (StratControlData, StratColumn, list of BoreholeProbe)
        The solver input, the stratigraphic column, and the per-hole probes.
    """
    order = build_stratigraphic_order(dipping_order_columns())
    xyz_columns = dipping_columns_with_xyz()
    control = build_control_data(xyz_columns, [], order)
    holes = _probes_from_columns(xyz_columns, order)
    return control, order, holes


def interbedded_block() -> Block:
    """The v1 single block bracketing the interbedded fixture's columns.

    Returns
    -------
    Block
        Rectangular prism covering ``interbedded_columns_with_xyz`` + margin.
    """
    return _block_from_columns(interbedded_columns_with_xyz())


def dipping_block() -> Block:
    """The v1 single block bracketing the dipping fixture's columns.

    Returns
    -------
    Block
        Rectangular prism covering ``dipping_columns_with_xyz`` + margin.
    """
    return _block_from_columns(dipping_columns_with_xyz())
