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
from groundmodel.domain.services.strat_field.potential_field import (
    PotentialField,
    fit_potential_field,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    Horizon,
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


# ---------------------------------------------------------------------------
# Stage 4 — isosurface-extraction fixtures (small grids for fast marching cubes)
# ---------------------------------------------------------------------------

# The Stage-3 ``interbedded_block`` spans ~500 m × ~100 m × ~20 m, which at a
# 1 m grid is ~1 M points — too slow for a unit test.  Stage 4's nesting / shape
# tests only need a small block over the SAME interbedded field, so we fit the
# field on the real (wide-apart) control points but extract over a compact block
# centred on the western column.  The field is still the genuine RBF fit through
# the benign, monotone interbedded control, so the nesting invariant holds.

# A compact extraction block centred on the western interbedded column.  Small
# enough that a 1 m grid is ~10×10×16 ≈ 1.6 k points (sub-second marching cubes),
# while still bracketing the interior iso-values 1..4 vertically (those contacts
# sit between z ≈ +3 and z ≈ -3 at this column, see interbedded_columns_with_xyz).
_INTER_S4_HALF_WIDTH_M = 5.0
_INTER_S4_Z_MIN = -6.0
_INTER_S4_Z_MAX = 6.0


def interbedded_extraction_block() -> Block:
    """A small block over the interbedded field for fast Stage-4 extraction.

    A compact prism centred on the western interbedded column (``bh-A`` at
    ``(200_000, 200_000)``), spanning ``±5 m`` horizontally and ``[-6, +6] m``
    vertically.  At a 1 m grid this is a few thousand points — fast enough for a
    unit test — while still bracketing the interior contacts (iso-values 1..4),
    which sit between roughly ``+3 m`` and ``-3 m`` at this column.

    Returns
    -------
    Block
        The compact extraction block.
    """
    cx, cy = _INTER_COL_A_X, _INTER_COL_A_Y
    h = _INTER_S4_HALF_WIDTH_M
    polygon = (
        (cx - h, cy - h),
        (cx + h, cy - h),
        (cx + h, cy + h),
        (cx - h, cy + h),
    )
    return Block(polygon=polygon, z_min=_INTER_S4_Z_MIN, z_max=_INTER_S4_Z_MAX)


def interbedded_field_and_domain() -> tuple[PotentialField, StratColumn, Block]:
    """Fit the interbedded potential field and return it with a small extraction block.

    The field is fit on the FULL interbedded control (the real, wide-apart
    borehole picks — a benign, monotone configuration that passes the Stage-3
    gate, so the extracted isosurfaces nest without crossing).  The returned
    ``domain`` is the compact :func:`interbedded_extraction_block`, so the
    Stage-4 tests run a small, fast grid over a genuine fitted field.

    Returns
    -------
    (PotentialField, StratColumn, Block)
        The fitted field, the interbedded stratigraphic column, and the compact
        extraction block.
    """
    order = build_stratigraphic_order(interbedded_columns())
    xyz_columns = interbedded_columns_with_xyz()
    control = build_control_data(xyz_columns, [], order)
    domain = interbedded_extraction_block()
    field = fit_potential_field(control, [domain])
    return field, order, domain


# ---------------------------------------------------------------------------
# Stage 4 — analytic pinch field (a genuinely terminating lens surface)
# ---------------------------------------------------------------------------

# The pinch test needs an isosurface that is present in only PART of the domain.
# A scattered-data RBF through a single lens pick still extrapolates smoothly
# across the whole block (the lens iso would span everywhere), so it would not
# genuinely pinch.  Instead we build a small ANALYTIC field whose lens iso-value
# is reached only in a central x-band:
#
#   F(x, y, z) = base(z) + bump(x)
#       base(z) = 3 * (z_max - z) / (z_max - z_min)   -> 0 at top, 3 at bottom
#       bump(x) = 4 * exp(-((x - x_mid) / 4)^2)        -> peak 4 in the middle,
#                                                          ~0 at the edges
#
# The MATRIX iso-values (1, 2) lie within base's [0, 3] range, so those surfaces
# span the whole domain.  The LENS iso-value (5) exceeds base's max (3); it is
# reached only where bump(x) lifts F into range, i.e. where bump(x) ∈ [2, 5] —
# a central band.  Outside that band F never reaches 5, so marching cubes finds
# no lens surface there: a real, geometric pinch-out.

_PINCH_X_MIN = 0.0
_PINCH_X_MAX = 30.0
_PINCH_Y_MIN = 0.0
_PINCH_Y_MAX = 10.0
_PINCH_Z_MIN = 0.0
_PINCH_Z_MAX = 10.0
_PINCH_X_MID = 15.0  # centre of the lens band
_PINCH_LENS_RANK = 2  # the interior horizon whose iso is the lens iso-value
_PINCH_MATRIX_RANK = 1  # an interior horizon that spans the whole domain


class _AnalyticPinchField:
    """A tiny analytic potential field with one laterally-pinching isosurface.

    Mimics the :class:`PotentialField` ``evaluate`` interface (a vectorised
    ``(N, 3) -> (N,)`` field) so :func:`extract_isosurfaces` consumes it
    unchanged.  Constructed so that the matrix iso-values span the whole block
    while the lens iso-value is reached only in a central x-band.

    Parameters
    ----------
    z_min, z_max : float
        Vertical span used to normalise the depth-increasing ``base`` term.
    x_mid : float
        Centre of the Gaussian ``bump`` that creates the lens band.
    """

    def __init__(self, z_min: float, z_max: float, x_mid: float) -> None:
        self._z_min = z_min
        self._z_max = z_max
        self._x_mid = x_mid

    def evaluate(self, xyz: object) -> object:
        """Evaluate the analytic field at a batch of ``(x, y, z)`` points.

        Parameters
        ----------
        xyz : array-like of shape (N, 3)
            Query points; only the x and z columns affect the field.

        Returns
        -------
        numpy.ndarray
            The field value at each point.
        """
        import numpy as _np

        pts = _np.asarray(xyz, dtype=float).reshape(-1, 3)
        x = pts[:, 0]
        z = pts[:, 2]
        base = 3.0 * (self._z_max - z) / (self._z_max - self._z_min)
        bump = 4.0 * _np.exp(-(((x - self._x_mid) / 4.0) ** 2))
        return base + bump


# ---------------------------------------------------------------------------
# Stage 4 — analytic nested field (clean, monotone, gently-dipping contacts)
# ---------------------------------------------------------------------------

# The nesting / one-surface-per-horizon tests need a field whose contacts are
# guaranteed to nest (a shallower-rank contact always above a deeper-rank one).
# A scattered-data RBF only nests near its control points; a SMALL block around a
# single borehole is poorly constrained laterally and bubbles off-axis (the
# documented Stage-3 limitation), which is a property of the RBF, not of Stage 4.
# So the nesting invariant is pinned on a clean analytic field that is monotone
# in z by construction with a gentle x-dip, exactly the "benign nested surfaces"
# shape the invariant is supposed to hold on.

_NEST_X_MIN = 0.0
_NEST_X_MAX = 20.0
_NEST_Y_MIN = 0.0
_NEST_Y_MAX = 20.0
_NEST_Z_MIN = -6.0
_NEST_Z_MAX = 6.0


class _AnalyticNestedField:
    """A monotone-in-depth analytic field with gently dipping, well-nested contacts.

    ``F(x, y, z) = (z_ref - z) + dip * (x - x_ref)`` increases strictly with
    depth everywhere (the ``-z`` term), so the iso-surfaces never cross: a higher
    iso-value is always reached deeper.  The ``dip`` term tilts every contact
    gently in +x without ever reversing the depth monotonicity, so the surfaces
    are non-trivial (not perfectly flat) yet provably nested.

    Mimics :class:`PotentialField`'s ``evaluate`` so :func:`extract_isosurfaces`
    consumes it unchanged.

    Parameters
    ----------
    z_ref : float
        Elevation at which the un-dipped field equals zero.
    x_ref : float
        Easting at which the dip term contributes zero.
    dip : float
        Field change per metre of +x (a small value keeps the contacts gently
        dipping rather than steep).
    """

    def __init__(self, z_ref: float, x_ref: float, dip: float) -> None:
        self._z_ref = z_ref
        self._x_ref = x_ref
        self._dip = dip

    def evaluate(self, xyz: object) -> object:
        """Evaluate the analytic nested field at a batch of ``(x, y, z)`` points."""
        import numpy as _np

        pts = _np.asarray(xyz, dtype=float).reshape(-1, 3)
        x = pts[:, 0]
        z = pts[:, 2]
        return (self._z_ref - z) + self._dip * (x - self._x_ref)


def nested_field_and_domain() -> tuple[_AnalyticNestedField, StratColumn, Block]:
    """Build a clean analytic nested field, a matching column, and its block.

    The column has interior contacts at ranks 1, 2, 3 with iso-values 1.0, 2.0,
    3.0; the analytic field reaches each of those deeper than the previous, so
    the surfaces nest without crossing.  Rank 0 (surface) and rank 4 (floor) are
    caps that Stage 4 skips.

    Returns
    -------
    (_AnalyticNestedField, StratColumn, Block)
        The analytic field, a 5-horizon column whose interior iso-values it
        spans, and the block.
    """
    x_ref = (_NEST_X_MIN + _NEST_X_MAX) / 2.0
    # z_ref at mid-height, small dip so contacts tilt gently across the 20 m span.
    field = _AnalyticNestedField(z_ref=0.0, x_ref=x_ref, dip=0.05)

    # Interior iso-values 1, 2, 3 all sit within the field's z-range at the block
    # so all three contacts extract; ranks 0 and 4 are caps (skipped).
    column = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "ZAND", ("surf",)),
            Horizon(1, 1.0, "ZAND", "SILT", ("c1",)),
            Horizon(2, 2.0, "SILT", "ZAND", ("c2",)),
            Horizon(3, 3.0, "ZAND", "KLEI", ("c3",)),
            Horizon(4, 4.0, "KLEI", None, ()),
        )
    )
    polygon = (
        (_NEST_X_MIN, _NEST_Y_MIN),
        (_NEST_X_MAX, _NEST_Y_MIN),
        (_NEST_X_MAX, _NEST_Y_MAX),
        (_NEST_X_MIN, _NEST_Y_MAX),
    )
    domain = Block(polygon=polygon, z_min=_NEST_Z_MIN, z_max=_NEST_Z_MAX)
    return field, column, domain


def pinch_field_and_domain() -> tuple[_AnalyticPinchField, StratColumn, Block]:
    """Build the analytic pinch field, a matching column, and its block.

    The returned :class:`StratColumn` is hand-built so that its interior
    horizons carry the iso-values the analytic field uses: rank
    ``_PINCH_MATRIX_RANK`` (iso 1.0, a matrix contact spanning the whole domain)
    and rank ``_PINCH_LENS_RANK`` (iso 5.0, the lens contact present only in the
    central x-band).  Rank 0 (surface) and rank 3 (floor) are caps, skipped by
    Stage 4.

    Returns
    -------
    (_AnalyticPinchField, StratColumn, Block)
        The analytic field, a column whose interior iso-values match it, and the
        block spanning the analytic domain.
    """
    field = _AnalyticPinchField(_PINCH_Z_MIN, _PINCH_Z_MAX, _PINCH_X_MID)

    # A 4-horizon column (3 instances): surface (rank 0), matrix contact (rank 1,
    # iso 1.0), lens contact (rank 2, iso 5.0), floor (rank 3).  Only the interior
    # ranks 1 and 2 are extracted by Stage 4.  iso-values are chosen to match the
    # analytic field's matrix-vs-lens ranges, NOT the rank-as-iso Stage-1 default.
    column = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "SAND", ("surf",)),
            Horizon(_PINCH_MATRIX_RANK, 1.0, "SAND", "SILT", ("matrix",)),
            Horizon(_PINCH_LENS_RANK, 5.0, "SILT", "KLEI", ("lens",)),
            Horizon(3, 9.0, "KLEI", None, ()),
        )
    )

    polygon = (
        (_PINCH_X_MIN, _PINCH_Y_MIN),
        (_PINCH_X_MAX, _PINCH_Y_MIN),
        (_PINCH_X_MAX, _PINCH_Y_MAX),
        (_PINCH_X_MIN, _PINCH_Y_MAX),
    )
    domain = Block(polygon=polygon, z_min=_PINCH_Z_MIN, z_max=_PINCH_Z_MAX)
    return field, column, domain


def pinch_lens_rank() -> int:
    """Return the rank of the laterally-pinching lens horizon in the pinch fixture."""
    return _PINCH_LENS_RANK


def pinch_domain_width_m() -> float:
    """Return the full x-extent (metres) of the analytic pinch domain."""
    return _PINCH_X_MAX - _PINCH_X_MIN
