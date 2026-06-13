"""Unit tests for Stage 4: shared isosurface extraction via marching cubes.

These tests pin the behaviours that make the extracted surfaces usable by
Stage 5's watertight body assembly:

* every interior contact yields exactly one triangulated surface,
* nested contacts do not cross (a shallower-rank contact is never below a
  deeper-rank one at the same map position),
* a contact present in only part of the model terminates laterally (pinches
  out) instead of spanning the whole domain,
* the marching-cubes grid-to-world mapping (origin + axis order) is correct,
* a contact that is absent everywhere is skipped without crashing,
* a surface is clipped to the model's footprint polygon.

The fixtures live in ``fixtures.py``; the interbedded nesting/grid tests run on
a genuine RBF fit over a small block, and the pinch/clip tests run on a tiny
analytic field whose lens contact is reached only in a central band.
"""

from __future__ import annotations

from groundmodel.domain.services.strat_field.iso_surface import extract_isosurfaces
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    ContactSurface,
    Horizon,
    StratColumn,
)
from tests.unit.domain.services.strat_field.fixtures import (
    interbedded_field_and_domain,
    nested_field_and_domain,
    pinch_domain_width_m,
    pinch_field_and_domain,
    pinch_lens_rank,
)

# A grid spacing fine enough to resolve the fixtures' contacts but coarse enough
# that the small blocks evaluate in well under a second.
_GRID_SPACING_M = 1.0


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _grid_samples(domain: Block, n: int) -> list[tuple[float, float]]:
    """Return ``n×n`` interior (x, y) sample positions across the domain footprint.

    Samples on an inset grid (10 % margin in from the bounding box) so the
    sample points sit comfortably inside the footprint where every nested
    surface is defined.
    """
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    mx = (x_max - x_min) * 0.1
    my = (y_max - y_min) * 0.1
    samples: list[tuple[float, float]] = []
    for i in range(n):
        fx = (i + 0.5) / n
        for j in range(n):
            fy = (j + 0.5) / n
            samples.append(
                (
                    x_min + mx + fx * (x_max - x_min - 2 * mx),
                    y_min + my + fy * (y_max - y_min - 2 * my),
                )
            )
    return samples


def _surface_z_at(surface: ContactSurface, x: float, y: float) -> float | None:
    """Return the surface elevation at plan position ``(x, y)``, or ``None`` if off it.

    Averages the z of all vertices within half a grid step of ``(x, y)`` in plan
    view.  Simple but adequate for the nesting assertion: it samples the actual
    surface elevation near the query point and returns ``None`` when the surface
    has no geometry there (so the assertion only compares ranks that both cover
    the point).
    """
    radius = _GRID_SPACING_M * 0.75
    zs = [
        vz for (vx, vy, vz) in surface.vertices if abs(vx - x) <= radius and abs(vy - y) <= radius
    ]
    if not zs:
        return None
    return sum(zs) / len(zs)


# ---------------------------------------------------------------------------
# Core behaviours
# ---------------------------------------------------------------------------


def test_each_interior_horizon_yields_one_surface() -> None:
    """Every interior contact extracts as exactly one surface, each with triangles."""
    field, column, domain = nested_field_and_domain()

    surfaces = extract_isosurfaces(field, column, grid_spacing_m=_GRID_SPACING_M, domain=domain)

    ranks = {s.horizon_rank for s in surfaces}
    # The column has interior contacts at ranks 1, 2, 3 (rank 0 is the surface
    # cap, rank 4 the floor cap); all should produce a surface here.
    assert ranks == {1, 2, 3}
    # No two surfaces share a rank — each contact is extracted exactly once.
    assert len(ranks) == len(surfaces)
    for s in surfaces:
        assert len(s.triangles) > 0


def test_extraction_runs_on_the_real_rbf_field() -> None:
    """The genuine RBF interbedded field extracts its interior contacts without error.

    A coverage smoke over the real Stage-3 fit (not an analytic field): the
    nesting invariant is pinned separately on a clean monotone field because a
    single-borehole sub-block of the RBF bubbles off-axis (a documented Stage-3
    limitation), but extraction itself must still run and emit the interior
    contacts that the field does span.
    """
    field, order, domain = interbedded_field_and_domain()

    surfaces = extract_isosurfaces(field, order, grid_spacing_m=_GRID_SPACING_M, domain=domain)

    # Some interior contacts (ranks 1..4) come back, each with geometry, and the
    # caps (rank 0 surface, rank 5 floor) are never emitted.
    assert surfaces, "the real RBF field produced no interior surfaces"
    for s in surfaces:
        assert 1 <= s.horizon_rank <= 4
        assert len(s.triangles) > 0


def test_nested_surfaces_do_not_cross() -> None:
    """At any map position, a shallower-rank contact is never below a deeper-rank one."""
    field, column, domain = nested_field_and_domain()

    surfaces = extract_isosurfaces(field, column, grid_spacing_m=_GRID_SPACING_M, domain=domain)

    for x, y in _grid_samples(domain, n=20):
        depth_by_rank = {s.horizon_rank: _surface_z_at(s, x, y) for s in surfaces}
        ranks = sorted(r for r in depth_by_rank if depth_by_rank[r] is not None)
        zs = [depth_by_rank[r] for r in ranks]
        # Shallower rank ⇒ higher (or equal) elevation: a contact never dips below
        # the one beneath it in the stratigraphic order.
        assert all(a >= b - 1e-6 for a, b in zip(zs, zs[1:])), (
            f"surfaces cross at ({x}, {y}): ranks {ranks} -> z {zs}"
        )


def test_pinched_contact_terminates_laterally() -> None:
    """A contact present only in the model's middle does not span the whole domain."""
    field, column, domain = pinch_field_and_domain()

    surfaces = extract_isosurfaces(field, column, grid_spacing_m=_GRID_SPACING_M, domain=domain)

    lens = next(s for s in surfaces if s.horizon_rank == pinch_lens_rank())
    xs = [vx for (vx, _vy, _vz) in lens.vertices]
    # The lens surface is reached only in a central x-band, so its x-extent is
    # well short of the full domain width — it pinches out before the edges.
    assert max(xs) - min(xs) < pinch_domain_width_m() - 1.0


def test_matrix_contact_spans_whole_domain() -> None:
    """A through-going contact (matrix) DOES span the full domain width — the pinch contrast."""
    field, column, domain = pinch_field_and_domain()

    surfaces = extract_isosurfaces(field, column, grid_spacing_m=_GRID_SPACING_M, domain=domain)

    # rank 1 is the matrix contact (iso within the background range -> present
    # everywhere); contrast against the rank-2 lens of the pinch test.
    matrix = next(s for s in surfaces if s.horizon_rank == 1)
    xs = [vx for (vx, _vy, _vz) in matrix.vertices]
    # Spans nearly the full width — marching cubes' outermost verts sit a half-cell
    # in from each edge, so allow a 2 m (2 cells) shortfall and still call it
    # "through-going", in clear contrast to the lens's ~7 m extent above.
    assert max(xs) - min(xs) > pinch_domain_width_m() - 2.0


# ---------------------------------------------------------------------------
# Grid → world mapping, absent contact, clipping
# ---------------------------------------------------------------------------


def test_grid_to_world_axis_and_origin_mapping() -> None:
    """A flat-by-construction contact lands at its analytic world elevation.

    Builds a trivial analytic field ``F = z_floor - z`` (increasing with depth)
    on a known block; the iso-value ``L`` then defines a perfectly flat horizontal
    contact at world elevation ``z = z_floor - L``.  Extracting it and reading
    back the vertex elevations pins the grid origin + axis-order affine: a
    transposed volume or a dropped origin offset would put the surface at the
    wrong z (or in x/y).
    """

    class _FlatField:
        def evaluate(self, xyz: object) -> object:
            import numpy as np

            pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
            z = pts[:, 2]
            # F increases with depth; floor reference 10.0 so F = 10 - z.
            return 10.0 - z

    # A 3-horizon column: surface (rank 0), one interior contact (rank 1, iso 4.0
    # -> flat surface at z = 10 - 4 = 6.0), floor (rank 2).
    column = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "A", ("s",)),
            Horizon(1, 4.0, "A", "B", ("c",)),
            Horizon(2, 9.0, "B", None, ()),
        )
    )
    domain = Block(
        polygon=((0.0, 0.0), (5.0, 0.0), (5.0, 5.0), (0.0, 5.0)),
        z_min=0.0,
        z_max=10.0,
    )

    surfaces = extract_isosurfaces(
        _FlatField(), column, grid_spacing_m=_GRID_SPACING_M, domain=domain
    )

    contact = next(s for s in surfaces if s.horizon_rank == 1)
    zs = [vz for (_vx, _vy, vz) in contact.vertices]
    # Flat contact at z = 6.0 everywhere (smoothing leaves a flat sheet flat).
    assert all(abs(vz - 6.0) < 1e-6 for vz in zs)
    # And its x/y vertices fall inside the domain footprint (origin not dropped).
    xs = [vx for (vx, _vy, _vz) in contact.vertices]
    ys = [vy for (_vx, vy, _vz) in contact.vertices]
    assert 0.0 <= min(xs) and max(xs) <= 5.0
    assert 0.0 <= min(ys) and max(ys) <= 5.0


def test_absent_contact_is_skipped_without_crashing() -> None:
    """A contact whose iso-value is outside the sampled field range produces no surface."""

    class _FlatField:
        def evaluate(self, xyz: object) -> object:
            import numpy as np

            pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
            z = pts[:, 2]
            return 10.0 - z  # range over z in [0,10] is [0,10]

    # Interior contact iso-value 99.0 is far outside the field's [0, 10] range:
    # the contact is absent everywhere and marching cubes cannot extract it.
    column = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "A", ("s",)),
            Horizon(1, 99.0, "A", "B", ("c",)),  # absent
            Horizon(2, 200.0, "B", None, ()),
        )
    )
    domain = Block(
        polygon=((0.0, 0.0), (5.0, 0.0), (5.0, 5.0), (0.0, 5.0)),
        z_min=0.0,
        z_max=10.0,
    )

    surfaces = extract_isosurfaces(
        _FlatField(), column, grid_spacing_m=_GRID_SPACING_M, domain=domain
    )

    # No crash, and the absent contact is simply omitted.
    assert all(s.horizon_rank != 1 for s in surfaces)
    assert surfaces == []


def test_surfaces_are_clipped_to_the_footprint_polygon() -> None:
    """Triangles outside the domain polygon are dropped; survivors' centroids are inside.

    Uses a triangular footprint that is a strict sub-region of its own bounding
    box, so the grid (built over the bounding box) over-covers the polygon and
    the clip must drop the out-of-polygon triangles.
    """
    from groundmodel.domain.services.strat_field.potential_field import _point_in_polygon

    class _FlatField:
        def evaluate(self, xyz: object) -> object:
            import numpy as np

            pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
            z = pts[:, 2]
            return 10.0 - z

    column = StratColumn(
        horizons=(
            Horizon(0, 0.0, None, "A", ("s",)),
            Horizon(1, 4.0, "A", "B", ("c",)),  # flat contact at z = 6.0
            Horizon(2, 9.0, "B", None, ()),
        )
    )
    # A right triangle covering only the lower-left half of a 10×10 bounding box.
    triangle = ((0.0, 0.0), (10.0, 0.0), (0.0, 10.0))
    domain = Block(polygon=triangle, z_min=0.0, z_max=10.0)

    surfaces = extract_isosurfaces(
        _FlatField(), column, grid_spacing_m=_GRID_SPACING_M, domain=domain
    )

    contact = next(s for s in surfaces if s.horizon_rank == 1)
    # Every surviving triangle's plan-view centroid lies inside the footprint.
    for i0, i1, i2 in contact.triangles:
        v0, v1, v2 = contact.vertices[i0], contact.vertices[i1], contact.vertices[i2]
        cx = (v0[0] + v1[0] + v2[0]) / 3.0
        cy = (v0[1] + v1[1] + v2[1]) / 3.0
        assert _point_in_polygon(cx, cy, triangle), (
            f"kept a triangle whose centroid ({cx}, {cy}) is outside the polygon"
        )
    # And the clip actually removed something: the upper-right corner of the
    # bounding box (well outside the triangle) has no surviving vertex near it.
    assert not any(vx > 9.0 and vy > 9.0 for (vx, vy, _vz) in contact.vertices)
