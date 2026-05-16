"""Unit tests for the supported-section-CRS allowlist (debt #31).

Pure lookups — no DB, no I/O. Also exercises the router-level guard
``_require_supported_section_crs`` because it is a pure function that
raises ``HTTPException`` (importable without a DB session).
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from groundmodel.api.routers.cross_section import _require_supported_section_crs
from groundmodel.infrastructure.codelists.horizontal_crs import (
    SUPPORTED_SECTION_HORIZONTAL_EPSG,
    horizontal_crs_label,
    is_supported_section_crs,
)


@pytest.mark.parametrize("epsg", sorted(SUPPORTED_SECTION_HORIZONTAL_EPSG))
def test_supported_metric_crs_accepted(epsg: int) -> None:
    """Every allowlisted projected metric CRS is accepted."""
    assert is_supported_section_crs(epsg) is True


@pytest.mark.parametrize(
    "epsg",
    [
        4326,  # WGS 84 geographic (degrees) — the exact failure mode
        4258,  # ETRS89 geographic
        0,
        -1,
        None,  # a section with no CRS
    ],
)
def test_geographic_or_missing_crs_rejected(epsg: int | None) -> None:
    """Geographic / unknown / missing CRS are rejected — degrees would
    silently produce ~1e-4-scale section geometry."""
    assert is_supported_section_crs(epsg) is False


def test_belgium_and_netherlands_national_crs_supported() -> None:
    """The two debt-#31-named national datums are explicitly covered."""
    assert is_supported_section_crs(31370) is True  # Belgian Lambert 72
    assert is_supported_section_crs(28992) is True  # Amersfoort / RD New


def test_label_is_honest_for_unknown_codes() -> None:
    assert "31370" in horizontal_crs_label(31370)
    assert horizontal_crs_label(99999) == "EPSG:99999"
    assert horizontal_crs_label(None) == "unknown CRS"


def test_guard_passes_for_supported_crs() -> None:
    """The router guard is a no-op for a metric CRS."""
    _require_supported_section_crs(31370, context="create a cross-section")


@pytest.mark.parametrize("bad", [4326, None, 0])
def test_guard_raises_400_for_unsupported_crs(bad: int | None) -> None:
    """The router guard raises a 400 (not 500) with an actionable detail."""
    with pytest.raises(HTTPException) as exc:
        _require_supported_section_crs(bad, context="export this section")
    assert exc.value.status_code == 400
    assert "metric" in exc.value.detail
    assert "export this section" in exc.value.detail
