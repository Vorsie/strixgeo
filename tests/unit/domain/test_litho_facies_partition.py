"""Unit tests for the litho facies-partition (no DB, no I/O)."""

from __future__ import annotations

from groundmodel.domain.services.litho_contact_surfaces import build_columns
from groundmodel.domain.services.litho_facies_partition import (
    competitor_labels_above,
    competitor_labels_below,
)
from tests.unit.domain.mesh_test_helpers import make_pick as _pick


def test_labels_above_are_the_body_directly_over_the_shared_body():
    """Each shared-body hole is labelled by the body directly above it there."""
    # B = CLAY everywhere; SAND above CLAY on A,B; PEAT above CLAY on C,D.
    coords = {"A": (0, 0), "B": (0, 10), "C": (10, 0), "D": (10, 10)}
    picks = []
    for inv, (x, y) in coords.items():
        upper = "SAND" if inv in ("A", "B") else "PEAT"
        ub = 4.0 if upper == "SAND" else 3.0
        picks.append(_pick(inv, x, y, upper, 0.0, ub))
        picks.append(_pick(inv, x, y, "CLAY", ub, 14.0))
    columns, _ = build_columns(picks)
    labels = competitor_labels_above("CLAY", columns)
    assert labels == {"A": "SAND", "B": "SAND", "C": "PEAT", "D": "PEAT"}
    # below CLAY there is nothing -> empty labels
    assert competitor_labels_below("CLAY", columns) == {}


def test_labels_below_are_the_body_directly_under_the_shared_body():
    """Each shared-body hole is labelled by the body directly below it there.

    Column stack (shallowest → deepest): SAND / CLAY / GRAVEL.
    competitor_labels_above("CLAY") must return SAND for every hole.
    competitor_labels_below("CLAY") must return GRAVEL for every hole.
    """
    coords = {"A": (0, 0), "B": (0, 10), "C": (10, 0), "D": (10, 10)}
    picks = []
    for inv, (x, y) in coords.items():
        picks.append(_pick(inv, x, y, "SAND", 0.0, 3.0))
        picks.append(_pick(inv, x, y, "CLAY", 3.0, 8.0))
        picks.append(_pick(inv, x, y, "GRAVEL", 8.0, 14.0))
    columns, _ = build_columns(picks)
    assert competitor_labels_above("CLAY", columns) == {
        "A": "SAND",
        "B": "SAND",
        "C": "SAND",
        "D": "SAND",
    }
    assert competitor_labels_below("CLAY", columns) == {
        "A": "GRAVEL",
        "B": "GRAVEL",
        "C": "GRAVEL",
        "D": "GRAVEL",
    }


def test_circumcenter_is_equidistant_and_clamps_when_obtuse():
    """Right triangle -> equidistant circumcenter; obtuse -> clamped inside."""
    import math

    from groundmodel.domain.services.litho_facies_partition import circumcenter

    # Right triangle (circumcenter on the hypotenuse midpoint).
    a, b, c = (0.0, 0.0), (4.0, 0.0), (0.0, 4.0)
    cx, cy = circumcenter(a, b, c)
    assert abs(math.dist((cx, cy), a) - math.dist((cx, cy), b)) < 1e-9
    assert abs(math.dist((cx, cy), a) - math.dist((cx, cy), c)) < 1e-9  # equidistant

    # Strongly obtuse: true circumcenter is far outside; clamp keeps it inside.
    a, b, c = (0.0, 0.0), (10.0, 0.0), (5.0, 0.3)
    px, py = circumcenter(a, b, c)
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
    l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
    l3 = 1 - l1 - l2
    assert min(l1, l2, l3) >= -1e-9 and max(l1, l2, l3) <= 1 + 1e-9


def test_circumcenter_equilateral_triangle_is_strictly_interior():
    """Strictly-acute triangle: circumcenter is strictly inside, equidistant from all vertices.

    Uses an equilateral triangle where the circumcenter coincides with the centroid.
    All three barycentric coordinates are strictly positive, exercising the
    unclamped interior-return branch of circumcenter().
    """
    import math

    from groundmodel.domain.services.litho_facies_partition import circumcenter

    s = math.sqrt(3)
    a, b, c = (0.0, 0.0), (2.0, 0.0), (1.0, s)
    px, py = circumcenter(a, b, c)

    # Circumcenter of equilateral triangle == centroid.
    expected_x = (0.0 + 2.0 + 1.0) / 3.0
    expected_y = (0.0 + 0.0 + s) / 3.0
    assert abs(px - expected_x) < 1e-9
    assert abs(py - expected_y) < 1e-9

    # Equidistant from all three vertices.
    r = math.dist((px, py), a)
    assert abs(math.dist((px, py), b) - r) < 1e-9
    assert abs(math.dist((px, py), c) - r) < 1e-9

    # Strictly inside: all barycentric coordinates > 0.
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
    l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
    l3 = 1.0 - l1 - l2
    assert l1 > 0.0 and l2 > 0.0 and l3 > 0.0


def test_subdivide_two_label_and_three_label():
    """A 2-label triangle splits into the two cells; a 3-label into three at the junction."""
    from groundmodel.domain.services.litho_facies_partition import _PartitionAccumulator

    acc = _PartitionAccumulator([(0.0, 0.0), (10.0, 0.0), (0.0, 10.0)])
    acc.subdivide((0, 1, 2), ("SAND", "SAND", "PEAT"))  # v2 odd
    assert set(acc.regions) == {"SAND", "PEAT"}
    peat_pts = {p for t in acc.regions["PEAT"] for p in t}
    assert 2 in peat_pts and 0 not in peat_pts

    acc2 = _PartitionAccumulator([(0.0, 0.0), (10.0, 0.0), (5.0, 9.0)])
    acc2.subdivide((0, 1, 2), ("CLAY", "SILT", "PEAT"))
    assert set(acc2.regions) == {"CLAY", "SILT", "PEAT"}
    junction = len(acc2.vertices) - 1  # circumcenter is the last-added vertex
    assert all(any(junction in t for t in acc2.regions[k]) for k in ("CLAY", "SILT", "PEAT"))
