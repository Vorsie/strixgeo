"""Negative-case coverage for the loft-mesher invariant helpers.

The watertightness contract of the loft mesher is *proved* by the assertions in
``loft_invariants.py`` — but an assertion that never fires proves nothing.  These
tests feed each helper a deliberately-BROKEN input and assert it raises, so a
future refactor that silently disarms an invariant (e.g. an even-odd pairing bug
that makes ``vertical_ray_intervals`` always return ``[]``) is caught here rather
than letting every watertightness test pass vacuously.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.loft_field import StackEntry
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

from .loft_invariants import (
    assert_closed_manifold,
    assert_no_overlap_sampled,
    assert_tiles_domain,
    vertical_ray_intervals,
)

# ---------------------------------------------------------------------------
# A standard outward-wound axis-aligned box (closed 2-manifold).
# ---------------------------------------------------------------------------


def _box_verts(x0, x1, y0, y1, z0, z1):
    return [
        (x0, y0, z0),  # 0
        (x1, y0, z0),  # 1
        (x1, y1, z0),  # 2
        (x0, y1, z0),  # 3
        (x0, y0, z1),  # 4
        (x1, y0, z1),  # 5
        (x1, y1, z1),  # 6
        (x0, y1, z1),  # 7
    ]


# Outward winding (CCW seen from outside) for each of the 6 faces.
_BOX_TRIS = [
    (0, 2, 1),
    (0, 3, 2),  # bottom (-z)
    (4, 5, 6),
    (4, 6, 7),  # top (+z)
    (0, 1, 5),
    (0, 5, 4),  # front (-y)
    (3, 7, 6),
    (3, 6, 2),  # back (+y)
    (0, 4, 7),
    (0, 7, 3),  # left (-x)
    (1, 2, 6),
    (1, 6, 5),  # right (+x)
]


def _box_mesh(body_id, z0, z1, x0=0.0, x1=10.0, y0=0.0, y1=10.0):
    return LithoBodyMesh(
        body_id=body_id,
        formation_id="F",
        vertices=_box_verts(x0, x1, y0, y1, z0, z1),
        triangles=list(_BOX_TRIS),
        is_flagged=False,
    )


class _StubDomain:
    def contains(self, x, y):  # noqa: ARG002 — always in-domain for the test
        return True


class _StubField:
    """Minimal field for the tiling oracle: one full-height stack everywhere."""

    def __init__(self, top, base):
        self.domain = _StubDomain()
        self._top = top
        self._base = base

    def stack_at(self, x, y):  # noqa: ARG002
        return [StackEntry("b", "F", self._top, self._base)]


# ---------------------------------------------------------------------------
# assert_closed_manifold
# ---------------------------------------------------------------------------


def test_closed_manifold_passes_on_a_well_formed_box():
    """A correctly-wound closed box satisfies the manifold contract."""
    verts = _box_verts(0, 1, 0, 1, 0, 1)
    assert_closed_manifold(verts, _BOX_TRIS)  # must NOT raise


def test_open_box_with_a_missing_face_fails_closed_manifold():
    """Removing one triangle leaves boundary edges shared by only 1 triangle —
    no longer a closed manifold."""
    verts = _box_verts(0, 1, 0, 1, 0, 1)
    open_box = _BOX_TRIS[:-1]  # drop one of the right-face triangles
    with pytest.raises(AssertionError, match="closed manifold"):
        assert_closed_manifold(verts, open_box)


def test_inconsistent_winding_fails_closed_manifold():
    """Flipping one triangle's winding makes a directed edge appear twice."""
    verts = _box_verts(0, 1, 0, 1, 0, 1)
    bad = list(_BOX_TRIS)
    a, b, c = bad[0]
    bad[0] = (a, c, b)  # reverse just the first triangle
    with pytest.raises(AssertionError, match="winding"):
        assert_closed_manifold(verts, bad)


# ---------------------------------------------------------------------------
# vertical_ray_intervals
# ---------------------------------------------------------------------------


def test_vertical_ray_returns_the_box_interval():
    """A vertical ray through a box returns its single [base, top] interval."""
    mesh = _box_mesh("b", z0=-5.0, z1=-1.0)
    intervals = vertical_ray_intervals(mesh.vertices, mesh.triangles, 5.0, 5.0)
    assert len(intervals) == 1
    base, top = intervals[0]
    assert base == pytest.approx(-5.0)
    assert top == pytest.approx(-1.0)


def test_vertical_ray_misses_outside_the_footprint():
    """A ray outside the box footprint returns no intervals."""
    mesh = _box_mesh("b", z0=-5.0, z1=-1.0)
    assert vertical_ray_intervals(mesh.vertices, mesh.triangles, 50.0, 50.0) == []


# ---------------------------------------------------------------------------
# assert_no_overlap_sampled
# ---------------------------------------------------------------------------


def test_no_overlap_passes_for_stacked_disjoint_bodies():
    """Two vertically-disjoint bodies do not interpenetrate."""
    upper = _box_mesh("b-up", z0=-5.0, z1=0.0)
    lower = _box_mesh("b-lo", z0=-10.0, z1=-5.0)
    assert_no_overlap_sampled([upper, lower], [(5.0, 5.0)])  # must NOT raise


def test_no_overlap_fires_on_interpenetrating_bodies():
    """Two different bodies sharing a vertical interval must trip the assert."""
    a = _box_mesh("b-a", z0=-6.0, z1=0.0)
    b = _box_mesh("b-b", z0=-10.0, z1=-3.0)  # overlaps a on [-6, -3]
    with pytest.raises(AssertionError, match="overlap"):
        assert_no_overlap_sampled([a, b], [(5.0, 5.0)])


# ---------------------------------------------------------------------------
# assert_tiles_domain — the strict interior-hole branch
# ---------------------------------------------------------------------------


def test_tiles_domain_fires_on_an_interior_hole_even_with_loose_extent_tol():
    """A gap BETWEEN two bodies is a watertightness defect — the interior-hole
    check stays strict no matter how loose ``extent_tol`` is."""
    field = _StubField(top=0.0, base=-10.0)
    upper = _box_mesh("b-up", z0=-2.0, z1=0.0)
    lower = _box_mesh("b-lo", z0=-10.0, z1=-5.0)  # hole [-5, -2]
    with pytest.raises(AssertionError):
        assert_tiles_domain([upper, lower], field, [(5.0, 5.0)], extent_tol=1000.0)


def test_tiles_domain_passes_for_a_contiguous_union():
    """A gap-free union spanning the field extent satisfies the oracle."""
    field = _StubField(top=0.0, base=-10.0)
    upper = _box_mesh("b-up", z0=-4.0, z1=0.0)
    lower = _box_mesh("b-lo", z0=-10.0, z1=-4.0)  # contiguous at -4
    assert_tiles_domain([upper, lower], field, [(5.0, 5.0)])  # must NOT raise
