"""Unit tests for the shared DOV import bounding-box validator.

Rules under test (Codex row 4 — DOV bbox bounds):

* "a reversed or degenerate bbox is a 422 with a message that says which
  corner is wrong" — east must be strictly greater than west, north strictly
  greater than south; the error names the offending corner.
* "a bbox larger than the product limit (25 km x 25 km) is a 422 naming the
  limit" — the projected area is checked against
  ``DOV_MAX_BBOX_AREA_KM2`` and the message names that limit.
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_MAX_BBOX_AREA_KM2,
    validate_wgs84_import_bbox,
)


def test_small_belgian_bbox_is_accepted() -> None:
    """A ~14 km x 14 km box over Belgium is well under the limit — no raise."""
    # 0.2 deg square near Brussels ≈ 14 km (lat) x 14 km (lon) ≈ 196 km².
    validate_wgs84_import_bbox(west=4.30, south=50.80, east=4.50, north=51.00)


def test_reversed_east_west_names_the_corner() -> None:
    """east <= west is rejected and the message names east / west."""
    with pytest.raises(ValueError) as excinfo:
        validate_wgs84_import_bbox(west=4.50, south=50.80, east=4.30, north=51.00)
    msg = str(excinfo.value).lower()
    assert "east" in msg and "west" in msg


def test_reversed_north_south_names_the_corner() -> None:
    """north <= south is rejected and the message names north / south."""
    with pytest.raises(ValueError) as excinfo:
        validate_wgs84_import_bbox(west=4.30, south=51.00, east=4.50, north=50.80)
    msg = str(excinfo.value).lower()
    assert "north" in msg and "south" in msg


def test_degenerate_zero_width_is_rejected() -> None:
    """west == east is a degenerate (zero-width) box — rejected."""
    with pytest.raises(ValueError):
        validate_wgs84_import_bbox(west=4.30, south=50.80, east=4.30, north=51.00)


def test_degenerate_zero_height_is_rejected() -> None:
    """south == north is a degenerate (zero-height) box — rejected."""
    with pytest.raises(ValueError):
        validate_wgs84_import_bbox(west=4.30, south=50.80, east=4.50, north=50.80)


def test_oversized_bbox_names_the_limit() -> None:
    """A ~0.5 deg box (>1900 km²) exceeds the product limit and names it."""
    with pytest.raises(ValueError) as excinfo:
        validate_wgs84_import_bbox(west=3.0, south=50.0, east=5.0, north=51.5)
    msg = str(excinfo.value)
    # The limit value (625) must appear in the message so the caller knows it.
    assert str(int(DOV_MAX_BBOX_AREA_KM2)) in msg


def test_area_limit_constant_is_625_km2() -> None:
    """The named product limit is 25 km x 25 km = 625 km² (owner may change)."""
    assert DOV_MAX_BBOX_AREA_KM2 == 625.0
