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
