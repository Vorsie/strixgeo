"""Stage-5 body-assembly tests — the watertight gate (Task 6 against the Task-7 oracle).

These tests are the objective definition of "done" for Stage 5: every emitted
:class:`LithoBodyMesh` must pass the Task-7 invariant helpers
(``assert_closed_manifold`` / ``assert_no_overlap_sampled`` /
``assert_model_matches_columns``) on REAL-DATA-SHAPED fixtures — interbedded,
dipping, and pinch — never a layer-cake-only stack (layer-cake-only testing is
exactly what hid the old loft builder's metre-scale overlap bug).

The fixtures are built from the analytic nested / pinch fields already in
``fixtures.py`` (monotone-by-construction so the body stack is well-defined) plus
the matching authored columns derived from the SAME field so the column-diff is
meaningful.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.strat_field.body_assembly import assemble_bodies
from tests.unit.domain.services.strat_field.fixtures import (
    nested_field_and_domain,
    pinch_field_and_domain,
    pinch_lens_rank,
)
from tests.unit.domain.services.strat_field.strat_invariants import (
    AuthoredColumn,
    AuthoredUnit,
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# A coarse grid keeps marching-cubes-free body assembly fast (<1 s) while still
# exercising pinch + dipping geometry: the analytic blocks are 20 m / 30 m wide,
# so a 2.5 m spacing gives ~8-12 cells per axis — plenty of taper resolution.
_NESTED_SPACING_M = 2.5
_PINCH_SPACING_M = 2.5


# ---------------------------------------------------------------------------
# Fixture helpers — build bodies + the matching authored columns
# ---------------------------------------------------------------------------


def _nested_bodies() -> list:
    """Assemble bodies for the analytic nested (gently dipping) fixture."""
    field, order, domain = nested_field_and_domain()
    return assemble_bodies(field, order, domain, _NESTED_SPACING_M)


def _pinch_bodies() -> list:
    """Assemble bodies for the analytic pinch fixture (a lens present mid-domain)."""
    field, order, domain = pinch_field_and_domain()
    return assemble_bodies(field, order, domain, _PINCH_SPACING_M)


def _grid_samples(domain, n: int) -> list[tuple[float, float]]:
    """Return ``n × n`` interior ``(x, y)`` samples of the domain's bounding box.

    Samples are pulled inward from the polygon edges so a ray never grazes the
    perimeter wall exactly (which would make the even-odd crossing count
    ambiguous); this is the same convention the loft invariant tests used.
    """
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    # Inset by 5% of the extent so samples land strictly inside.
    ix = 0.05 * (x_max - x_min)
    iy = 0.05 * (y_max - y_min)
    sx = np.linspace(x_min + ix, x_max - ix, n)
    sy = np.linspace(y_min + iy, y_max - iy, n)
    return [(float(x), float(y)) for x in sx for y in sy]


def _analytic_nested_authored_columns() -> list[AuthoredColumn]:
    """Author the expected litho stack at three columns of the nested field.

    The nested field is ``F = (z_ref - z) + dip*(x - x_ref)`` with z_ref=0,
    x_ref=10, dip=0.05; interior horizons at iso 1, 2, 3 (ZAND/SILT/ZAND/KLEI).
    At a given x the horizon-k elevation solves ``iso_k = -z + 0.05*(x - 10)`` →
    ``z = 0.05*(x-10) - iso_k``.  The authored bases come from the SAME formula
    so the column-diff checks the model reproduces the field, not a re-derivation.
    """
    field, order, domain = nested_field_and_domain()
    interior_ranks = [
        h.rank for h in order.horizons if 1 <= h.rank < max(hh.rank for hh in order.horizons)
    ]
    columns: list[AuthoredColumn] = []
    for x in (5.0, 10.0, 15.0):
        y = 10.0
        # Build the iso → elevation map at this x via the analytic formula.
        elev_by_rank = {r: 0.05 * (x - 10.0) - order.iso_value(r) for r in interior_ranks}
        z_max = domain.z_max
        z_min = domain.z_min
        units: list[AuthoredUnit] = []
        # Top body: from z_max down to horizon[interior_ranks[0]].
        prev_top = z_max
        for r in interior_ranks:
            base = elev_by_rank[r]
            fid = next(h.above_formation for h in order.horizons if h.rank == r)
            units.append(AuthoredUnit(formation_id=fid, top_elev_m=prev_top, base_elev_m=base))
            prev_top = base
        # Bottom body: from the last interior horizon down to z_min.
        last_below = next(h.below_formation for h in order.horizons if h.rank == interior_ranks[-1])
        units.append(AuthoredUnit(formation_id=last_below, top_elev_m=prev_top, base_elev_m=z_min))
        columns.append(AuthoredColumn(x=x, y=y, units=tuple(units)))
    return columns


# ---------------------------------------------------------------------------
# Gate tests
# ---------------------------------------------------------------------------


def test_each_nested_body_is_a_closed_manifold() -> None:
    """Every dipping-fixture body is a closed 2-manifold with consistent winding."""
    bodies = _nested_bodies()
    assert bodies, "nested fixture produced no bodies"
    # The nested column is ZAND/SILT/ZAND/KLEI — at least these lithologies present.
    assert {b.formation_id for b in bodies} >= {"ZAND", "SILT", "KLEI"}
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)


def test_nested_bodies_do_not_overlap() -> None:
    """No two different dipping-fixture bodies interpenetrate (STRICT, TOL=1e-6)."""
    _, _, domain = nested_field_and_domain()
    bodies = _nested_bodies()
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=12))


def test_model_tiles_the_authored_columns() -> None:
    """The model stack reproduces the authored litho stack at every test column.

    This is the anti-loft test on real-data-shaped (dipping, interbedded ZAND/SILT)
    geometry — the exact assertion the old loft builder failed at 50-metre scale.
    """
    bodies = _nested_bodies()
    columns = _analytic_nested_authored_columns()
    # Grid spacing 2.5 m → the prism's stepped lateral cells reproduce the dipping
    # base to within roughly one cell of slope; 0.5 m tolerance covers that.
    assert_model_matches_columns(bodies, columns, tol_m=0.5)


def test_each_pinch_body_is_a_closed_manifold() -> None:
    """Every pinch-fixture body (incl. the laterally-terminating lens) is closed."""
    bodies = _pinch_bodies()
    assert bodies, "pinch fixture produced no bodies"
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)


def test_pinch_bodies_do_not_overlap() -> None:
    """No two different pinch-fixture bodies interpenetrate (STRICT)."""
    _, _, domain = pinch_field_and_domain()
    bodies = _pinch_bodies()
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=12))


def test_pinched_body_closes_to_a_tip() -> None:
    """The laterally-terminating lens body closes into a watertight solid.

    In the analytic pinch fixture the lens iso (rank ``pinch_lens_rank`` = 2) is
    reached only in a central x-band, so the band BELOW it (KLEI, between the lens
    contact and the floor cap) exists only mid-domain and terminates laterally on
    both sides.  That body must still be a closed manifold — where the lens
    pinches out the body's bounding height becomes absent, the cells there are
    omitted, and the prism closes with a watertight wall at the taper.
    """
    bodies = _pinch_bodies()
    lens_rank = pinch_lens_rank()
    assert lens_rank == 2
    # KLEI is the laterally-terminating body (present only in the central lens band).
    klei_bodies = [b for b in bodies if b.formation_id == "KLEI"]
    assert klei_bodies, "no KLEI (lens) body emitted"
    for b in klei_bodies:
        assert_closed_manifold(b.vertices, b.triangles)
    # It must terminate laterally: a ray at the domain edge (x near 2 m) misses
    # the lens body, while a ray at the centre (x = 15 m) hits it.
    klei = klei_bodies[0]
    centre_hit = vertical_ray_intervals(klei.vertices, klei.triangles, 15.0, 5.0)
    edge_hit = vertical_ray_intervals(klei.vertices, klei.triangles, 2.0, 5.0)
    assert centre_hit, "lens body should be present at the domain centre"
    assert not edge_hit, "lens body should pinch out before the domain edge"


def test_body_assembly_is_deterministic() -> None:
    """Re-running assembly on the same input yields identical vertices + triangles."""
    a = _nested_bodies()
    b = _nested_bodies()
    assert len(a) == len(b)
    for ba, bb in zip(a, b, strict=True):
        assert ba.body_id == bb.body_id
        assert ba.formation_id == bb.formation_id
        assert ba.vertices == bb.vertices
        assert ba.triangles == bb.triangles
