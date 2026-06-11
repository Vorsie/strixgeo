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
    """Acute triangle -> true circumcenter (equidistant); obtuse -> clamped inside."""
    import math

    from groundmodel.domain.services.litho_facies_partition import circumcenter

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
