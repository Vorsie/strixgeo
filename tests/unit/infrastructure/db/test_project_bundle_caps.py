"""Unit tests for the bundle restore child-array cap helper (debt #112, F2).

``_cap`` is the defence that stops a crafted .strix bundle from nesting an
unbounded observation/sample tree inside one borehole. It truncates an
oversized child array and warns what was dropped; arrays within the cap pass
through untouched.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from groundmodel.infrastructure.db.repositories.project_bundle import _cap
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_drops import (
    BundleRestoreDrops,
)
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_row_builders import (
    _build_borehole,
)
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_serialization import (
    _MAX_BOREHOLE_DRILL_SEGMENTS,
)


def test_cap_truncates_oversized_array_and_warns() -> None:
    """An array longer than the cap is truncated to the cap and a warning fires."""
    logger = MagicMock()
    out = _cap(list(range(100)), 10, "things on borehole X", logger)
    assert out == list(range(10))
    logger.warning.assert_called_once()


def test_cap_passes_through_array_within_limit() -> None:
    """An array within the cap is returned unchanged with no warning."""
    logger = MagicMock()
    out = _cap([1, 2, 3], 10, "things on borehole X", logger)
    assert out == [1, 2, 3]
    logger.warning.assert_not_called()


def test_cap_at_exactly_the_limit_does_not_truncate() -> None:
    """An array of exactly cap length is kept whole (cap is inclusive)."""
    logger = MagicMock()
    out = _cap([1, 2, 3], 3, "things on borehole X", logger)
    assert out == [1, 2, 3]
    logger.warning.assert_not_called()


# ---------------------------------------------------------------------------
# L6 — the caps report HOW MANY rows they dropped, not just a log line.
# ---------------------------------------------------------------------------


def test_cap_records_the_number_of_rows_it_dropped_into_the_tally() -> None:
    """A truncated array adds ``len - cap`` to the tally so the caller can toast it."""
    drops = BundleRestoreDrops()
    _cap(list(range(100)), 10, "things on borehole X", MagicMock(), drops=drops)
    assert drops.borehole_child_rows_dropped == 90


def test_cap_within_limit_records_no_drop() -> None:
    """An array within the cap leaves the tally at zero."""
    drops = BundleRestoreDrops()
    _cap([1, 2, 3], 10, "x", MagicMock(), drops=drops)
    assert drops.borehole_child_rows_dropped == 0


def test_cap_without_a_tally_still_truncates() -> None:
    """``drops`` is optional — existing callers that pass none still get truncation."""
    out = _cap(list(range(5)), 2, "x", MagicMock())
    assert out == [0, 1]


def test_build_borehole_aggregates_child_drops_into_the_tally() -> None:
    """A borehole with an over-cap child array threads its drop count up to the tally."""
    extra = 3
    payload = {
        "id": str(uuid4()),
        "name": "B1",
        "location_x": 150000.0,
        "location_y": 200000.0,
        "epsg": 31370,
        # One over-cap child array; the rest default to empty.
        "drill_segments": [{} for _ in range(_MAX_BOREHOLE_DRILL_SEGMENTS + extra)],
    }
    drops = BundleRestoreDrops()

    _build_borehole(payload, uuid4(), logger=MagicMock(), drops=drops)

    assert drops.borehole_child_rows_dropped == extra
