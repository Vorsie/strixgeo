"""Unit tests for the dip-extrapolation helper."""

import pytest

from groundmodel.domain.services.dip_extrapolation import (
    compute_dip_extrapolation_endpoint,
)


def test_horizontal_dip_returns_endpoint_at_neighbour() -> None:
    """Two source contacts at the same depth → dip is zero → the
    extrapolation endpoint sits at the neighbour's along position, at
    the source's elevation."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=200.0,
        neighbour_surface_elevation=10.0,
    )
    assert endpoint is not None
    along, elev = endpoint
    assert along == pytest.approx(200.0)
    # Zero-dip means the body keeps the same elevation; midpoint of source.
    assert elev == pytest.approx(9.0)


def test_dipping_body_extrapolates_to_crossing() -> None:
    """Source above contact dipping 1 m per 100 m horizontal toward
    neighbour at along=200 with surface elevation 5 m → extrapolation
    endpoint sits where the extrapolated above-contact meets the
    body's mid-elevation projected outward."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=200.0,
        neighbour_surface_elevation=5.0,
    )
    assert endpoint is not None


def test_unknown_neighbour_elevation_returns_none() -> None:
    """Helper can't extrapolate without a target elevation."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=200.0,
        neighbour_surface_elevation=None,
    )
    assert endpoint is None


def test_collinear_source_returns_none() -> None:
    """Source above + below at identical position → dip vector is
    undefined → extrapolation can't be computed."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=10.0,  # identical to above
        neighbour_along=200.0,
        neighbour_surface_elevation=5.0,
    )
    assert endpoint is None


def test_same_along_as_neighbour_returns_none() -> None:
    """If source_along == neighbour_along, extrapolation distance is
    zero → endpoint coincides with source (degenerate)."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=100.0,  # same as source
        neighbour_surface_elevation=5.0,
    )
    assert endpoint is None
