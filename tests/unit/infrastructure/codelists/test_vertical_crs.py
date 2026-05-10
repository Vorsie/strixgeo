"""Unit tests for the horizontal-EPSG → vertical-EPSG default lookup."""

from __future__ import annotations

from groundmodel.infrastructure.codelists.vertical_crs import (
    DEFAULT_VERTICAL_EPSG,
    FALLBACK_VERTICAL_EPSG,
    default_vertical_epsg,
)


def test_belgium_lambert72_maps_to_mtaw() -> None:
    """Belgian DOV imports use 31370 horizontal → 5710 (mTAW) vertical."""
    assert default_vertical_epsg(31370) == 5710


def test_netherlands_rd_new_maps_to_nap() -> None:
    """Dutch BRO imports use 28992 horizontal → 5709 (NAP) vertical."""
    assert default_vertical_epsg(28992) == 5709


def test_unknown_horizontal_epsg_falls_back() -> None:
    """An unmapped horizontal EPSG returns the platform fallback (mTAW today)."""
    assert default_vertical_epsg(2154) == FALLBACK_VERTICAL_EPSG


def test_none_horizontal_epsg_falls_back() -> None:
    """A row without a horizontal EPSG still gets a usable default."""
    assert default_vertical_epsg(None) == FALLBACK_VERTICAL_EPSG


def test_table_only_contains_known_pairs() -> None:
    """Guard against accidentally pre-populating countries we haven't shipped."""
    assert set(DEFAULT_VERTICAL_EPSG.keys()) == {31370, 28992}
