"""Tests for Stage 2 of the implicit stratigraphic builder: control data extraction.

Each test is written in the vocabulary of the spec (contact, horizon, rank,
elevation, investigation column, section line) — NOT in impl terms — so a
failing test's comment tells you which behavioural rule is broken, not which
variable is wrong.

The tests validate:
- Accepted contacts at investigation locations → 3D control points tagged with
  the correct horizon rank (depth → elevation conversion, rank linkage).
- Only INTERNAL horizons (1 ≤ rank ≤ N-1) produce control points; the surface
  (rank 0) and floor (rank N) are excluded.
- User-drawn section contacts → additional control points projected along the
  section line.
- Orientation constraints are emitted for every investigation and point DOWNWARD
  (gz < 0), encoding the "field increases WITH DEPTH (deeper = higher iso-value)"
  convention that the Stage-4 monotonicity gate requires.
- A contact_id that is absent from the stratigraphic order is silently skipped
  (defensive miss — no crash).
- Two ZAND instances in the interbedded fixture produce control points at BOTH
  of their distinct horizon ranks, confirming that the rank linkage goes through
  contact_id (not formation_id).
"""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.services.strat_field.control_data import (
    ContactObservation,
    InvestigationColumn,
    SectionContact,
    build_control_data,
)
from groundmodel.domain.services.strat_field.stratigraphic_order import (
    build_stratigraphic_order,
)
from tests.unit.domain.services.strat_field.fixtures import (
    dipping_columns_with_xyz,
    interbedded_columns,
    interbedded_columns_with_xyz,
    two_columns_with_xyz,
)

# ---------------------------------------------------------------------------
# Internal helpers — build the StratColumn from the existing Stage-1 fixtures
# so the Stage-2 tests are driven by the same data.
# ---------------------------------------------------------------------------


def _order_interbedded():
    """StratColumn derived from the 3-column interbedded fixture (5 instances → 6 horizons)."""
    return build_stratigraphic_order(interbedded_columns())


def _order_dipping():
    """StratColumn derived from the dipping fixture (3 instances → 4 horizons)."""
    from tests.unit.domain.services.strat_field.fixtures import dipping_order_columns

    return build_stratigraphic_order(dipping_order_columns())


def _n_instances_interbedded() -> int:
    """5 instances in the interbedded fixture → internal ranks {1, 2, 3, 4}."""
    return 5


# ---------------------------------------------------------------------------
# CP-1: borehole contacts become tagged 3D control points at internal horizons
# ---------------------------------------------------------------------------


def test_borehole_contacts_become_tagged_points():
    """Every accepted contact from an investigation column becomes one control point.

    Each contact's horizon rank is resolved via its contact_id → rank linkage.
    Only INTERNAL horizons (1 ≤ rank ≤ N-1) produce control points; the surface
    contact at rank 0 (top of the shallowest unit) is excluded because it is
    constrained by the DEM, not by an observed subsurface contact.
    """
    columns = interbedded_columns_with_xyz()
    order = _order_interbedded()
    data = build_control_data(columns, section_contacts=[], order=order)

    # 5 units per column but the top unit's contact maps to rank 0 → 4 internal
    # contacts per column; 3 columns = 12 control points total.
    expected_count = (_n_instances_interbedded() - 1) * len(columns)  # 4 × 3 = 12
    assert len(data.points) == expected_count

    # The set of horizon ranks present must be exactly the internal ranks {1, 2, 3, 4}.
    n = _n_instances_interbedded()
    assert {p.horizon_rank for p in data.points} == set(range(1, n))


# ---------------------------------------------------------------------------
# CP-2: depth → elevation conversion is correct
# ---------------------------------------------------------------------------


def test_contact_z_equals_surface_minus_top_depth():
    """A contact's elevation = investigation surface_elev_m − top_depth_m.

    This is the fundamental depth-to-elevation conversion.  A wrong sign or
    reference datum would shift every control point up or down by the depth,
    breaking the field solve completely.
    """
    from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

    # Minimal single-column fixture: one internal contact at known depth.
    # surface_elev = 5.0 m TAW, silt top-depth = 3.0 m → z = 2.0 m
    order = build_stratigraphic_order(
        [
            (
                OrderInputUnit("zand1", "ZAND", "c1-zand1-top"),
                OrderInputUnit("silt1", "SILT", "c1-silt1-top"),
            )
        ]
    )
    col = InvestigationColumn(
        investigation_id="bh-01",
        x=100.0,
        y=200.0,
        surface_elev_m=5.0,
        units=(
            # rank 0 (surface) — top of zand1 — SKIP
            ContactObservation(
                instance_key="zand1",
                formation_id="ZAND",
                contact_id="c1-zand1-top",
                top_depth_m=0.0,
            ),
            # rank 1 (internal) — top of silt1 at 3 m depth → z = 2.0 m
            ContactObservation(
                instance_key="silt1",
                formation_id="SILT",
                contact_id="c1-silt1-top",
                top_depth_m=3.0,
            ),
        ),
    )
    data = build_control_data([col], section_contacts=[], order=order)

    assert len(data.points) == 1
    pt = data.points[0]
    assert pt.z == pytest.approx(2.0)  # 5.0 - 3.0
    assert pt.x == 100.0
    assert pt.y == 200.0
    assert pt.horizon_rank == 1


# ---------------------------------------------------------------------------
# CP-3: the two ZAND instances produce control points at BOTH distinct ranks
# ---------------------------------------------------------------------------


def test_two_zand_instances_produce_points_at_both_ranks():
    """A repeated lithology (ZAND appearing twice in stratigraphy) must produce
    control points at two different horizon ranks.

    The rank linkage goes through contact_id, NOT formation_id.  Without a
    contact_id→rank map the builder would confuse zand1 (rank 0→skip) with
    zand2 (rank 2→emit), losing half the ZAND control points.
    """
    columns = interbedded_columns_with_xyz()
    order = _order_interbedded()
    data = build_control_data(columns, section_contacts=[], order=order)

    # zand2 maps to rank 2 (the second ZAND instance's internal horizon).
    # All three columns contribute one point there.
    zand2_points = [p for p in data.points if p.horizon_rank == 2]
    assert len(zand2_points) == 3, (
        "All three columns must contribute a control point at the zand2 horizon rank"
    )


# ---------------------------------------------------------------------------
# CP-4: a contact_id absent from the stratigraphic order is silently skipped
# ---------------------------------------------------------------------------


def test_unknown_contact_id_is_skipped_not_crashed():
    """A contact whose contact_id does not appear in the order is skipped cleanly.

    This is a defensive miss — it can happen when a contact was deleted from
    the model after the order was built, or when a column carries a contact
    that was seeded but not accepted.  The build must not crash.
    """
    order = _order_interbedded()
    # One column with only ONE valid contact_id and one orphan.
    col = InvestigationColumn(
        investigation_id="bh-orphan",
        x=0.0,
        y=0.0,
        surface_elev_m=10.0,
        units=(
            ContactObservation(
                instance_key="zand1",
                formation_id="ZAND",
                contact_id="ca-zand1-top",  # valid — rank 0, will be skipped as surface
                top_depth_m=0.0,
            ),
            ContactObservation(
                instance_key="silt1",
                formation_id="SILT",
                contact_id="ORPHAN-DOES-NOT-EXIST",  # absent from the order
                top_depth_m=2.0,
            ),
        ),
    )
    # Should not raise; the orphan is silently skipped.
    data = build_control_data([col], section_contacts=[], order=order)
    # rank 0 skipped (surface) + ORPHAN skipped → 0 control points from this column.
    assert len(data.points) == 0
    # ...but the column still contributes its one orientation constraint: a
    # column with all-orphan/surface contacts must not lose its gradient prior.
    assert len(data.orientations) == 1


# ---------------------------------------------------------------------------
# CP-5: section contacts add control points projected along the section line
# ---------------------------------------------------------------------------


def test_section_contacts_add_along_line_points():
    """User-drawn section contacts produce additional control points along the section line.

    The points are projected from (along_m, elevation_m) in section space to
    (x, y, z) in map CRS using the section endpoints.  The count must exceed
    the borehole-only baseline.
    """
    columns = two_columns_with_xyz()
    order = _order_interbedded()

    borehole_only = build_control_data(columns, section_contacts=[], order=order)
    borehole_count = len(borehole_only.points)

    section_contact = _one_section_contact(order)
    with_section = build_control_data(columns, section_contacts=[section_contact], order=order)

    assert len(with_section.points) > borehole_count


# ---------------------------------------------------------------------------
# CP-6: section-contact map-coord projection lands on the section line
# ---------------------------------------------------------------------------


def test_section_contact_sample_projects_onto_section_line():
    """A section contact sample at (along_m, elevation_m) must produce a control
    point whose (x, y) lies on the section line between ax,ay and bx,by.

    The projection formula: x = ax + (bx-ax)*(along/length), y = ay + (by-ay)*(along/length).
    A wrong formula (e.g. using bx-ax as numerator for y) would land the point
    off the line, corrupting the spatial distribution of constraints.
    """
    order = _order_interbedded()

    ax, ay, bx, by = 0.0, 0.0, 100.0, 0.0  # east-west section, 100 m long
    along_m = 40.0
    elevation_m = 3.0
    # Use silt1's contact_id (rank 1 — an internal horizon).
    sec = SectionContact(
        section_ax=ax,
        section_ay=ay,
        section_bx=bx,
        section_by=by,
        samples=((along_m, elevation_m),),
        contact_id="ca-silt1-top",
    )

    data = build_control_data([], section_contacts=[sec], order=order)
    assert len(data.points) == 1
    pt = data.points[0]

    # Expected map coords for along=40 on a 100 m east-west line from (0,0) to (100,0)
    assert pt.x == pytest.approx(40.0)
    assert pt.y == pytest.approx(0.0)
    assert pt.z == pytest.approx(3.0)
    assert pt.horizon_rank == 1  # silt1 → rank 1


# ---------------------------------------------------------------------------
# CP-7: orientation constraints point downward (gz ≈ -1, field increases with depth)
# ---------------------------------------------------------------------------


def test_orientation_points_with_increasing_field():
    """Orientation constraints encode "field increases WITH DEPTH".

    Stage 1 assigns iso_value = rank with rank 0 = shallowest, so F is larger at
    depth.  The gradient of F (direction of increasing F) therefore points DOWN:
    gz must be negative.  A positive gz would invert the field and fight every
    value constraint, bubbling the solve.  (The dipping fixture is used here so
    the v2 dip-refinement can later assert a non-zero gx/gy on the same data; v1
    emits a pure (0, 0, -1) regardless of the fixture's dip.)
    """
    columns = dipping_columns_with_xyz()
    order = _order_dipping()
    data = build_control_data(columns, section_contacts=[], order=order)

    assert len(data.orientations) > 0, "At least one orientation constraint must be emitted"
    # v1 ships a pure downward unit vector — pin it exactly so a half-normalised
    # or sign-flipped regression cannot pass vacuously.
    for o in data.orientations:
        assert o.gz == pytest.approx(-1.0)
        assert o.gx == pytest.approx(0.0)
        assert o.gy == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# CP-8: orientation constraints are unit vectors
# ---------------------------------------------------------------------------


def test_orientation_constraints_are_unit_vectors():
    """Each orientation constraint must carry a unit-length gradient vector.

    The implicit-field solver relies on the gradient being normalised to
    distinguish direction from magnitude.  A non-unit vector would bias the
    penalty weighting.
    """
    columns = interbedded_columns_with_xyz()
    order = _order_interbedded()
    data = build_control_data(columns, section_contacts=[], order=order)

    for o in data.orientations:
        length = math.sqrt(o.gx**2 + o.gy**2 + o.gz**2)
        assert length == pytest.approx(1.0, abs=1e-9), (
            f"Orientation at ({o.x},{o.y},{o.z}) has non-unit length {length}"
        )


# ---------------------------------------------------------------------------
# CP-9: the output StratColumn is propagated unchanged
# ---------------------------------------------------------------------------


def test_output_column_matches_input_order():
    """build_control_data must carry the input StratColumn through to the output
    StratControlData unchanged — it is consumed unchanged by Stage 3.
    """
    columns = interbedded_columns_with_xyz()
    order = _order_interbedded()
    data = build_control_data(columns, section_contacts=[], order=order)

    assert data.column is order


# ---------------------------------------------------------------------------
# CP-10: single-instance model — the internal-rank guard at its lower boundary
# ---------------------------------------------------------------------------


def test_single_instance_model_emits_no_control_points():
    """A one-instance model (2 horizons: surface + floor) has NO internal horizon.

    With floor_rank = 1 the guard ``1 <= rank < floor_rank`` is empty, so even a
    fully-observed column yields zero control points (its only contact maps to
    the surface rank 0).  The orientation prior is still emitted.  This pins the
    guard arithmetic at its lower boundary — the case the interbedded fixtures
    never exercise.
    """
    from groundmodel.domain.services.strat_field.stratigraphic_order import OrderInputUnit

    order = build_stratigraphic_order([(OrderInputUnit("zand1", "ZAND", "only-top"),)])
    assert len(order.horizons) == 2  # surface + floor only, no internal horizon

    col = InvestigationColumn(
        investigation_id="bh-solo",
        x=10.0,
        y=20.0,
        surface_elev_m=4.0,
        units=(ContactObservation("zand1", "ZAND", "only-top", top_depth_m=0.0),),
    )
    data = build_control_data([col], section_contacts=[], order=order)

    assert len(data.points) == 0
    assert len(data.orientations) == 1


# ---------------------------------------------------------------------------
# Helpers used by CP-5
# ---------------------------------------------------------------------------


def _one_section_contact(order):
    """A section contact for silt1 along a simple east-west section line.

    Three samples at different positions along the line so CP-5 gets
    multiple added points.
    """
    return SectionContact(
        section_ax=0.0,
        section_ay=0.0,
        section_bx=200.0,
        section_by=0.0,
        samples=(
            (30.0, 4.5),
            (100.0, 4.0),
            (170.0, 3.5),
        ),
        contact_id="ca-silt1-top",  # rank 1 — internal horizon
    )
