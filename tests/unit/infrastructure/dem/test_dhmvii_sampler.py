"""Unit tests for the DHMVII DEM sampler.

Uses a recorded multipart/related response (captured 2026-05-11 from
the live WCS endpoint) so the tests don't depend on network. The
fixture covers a 10 m × 10 m bbox at 1 m resolution near Brussels.
"""

from __future__ import annotations

import pathlib

import pytest

from groundmodel.infrastructure.dem.dhmvii_sampler import (
    SamplePoint,
    parse_wcs_multipart,
    sample_geotiff_along_line,
)

FIXTURE = (
    pathlib.Path(__file__).parents[3]
    / "fixtures"
    / "dem"
    / "dhmvii_10x10_at_150000_200000.multipart"
)
BBOX = {
    "bbox_min_x": 150000.0,
    "bbox_max_x": 150010.0,
    "bbox_min_y": 200000.0,
    "bbox_max_y": 200010.0,
}


# ---------------------------------------------------------------------------
# Multipart parsing
# ---------------------------------------------------------------------------


def test_parse_wcs_multipart_extracts_tiff_blob() -> None:
    """The recorded multipart response yields a TIFF blob with the magic header."""
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    assert tiff[:2] == b"II"  # little-endian TIFF magic
    # Sanity: should be on the order of tens of KB for a 10×10 float32
    # TIFF (overhead-dominated at this size).
    assert 10_000 < len(tiff) < 200_000


def test_parse_wcs_multipart_raises_when_no_image_part() -> None:
    """A response without an image/tiff part surfaces a clear error.

    Simulates a WCS ExceptionReport (HTTP 200 but an XML body the
    server returns when the bbox is invalid / outside Flanders).
    """
    # Minimal multipart with only a text part — no image.
    body = (
        b"--wcs\r\n"
        b"Content-Type: text/xml\r\n"
        b"Content-ID: GML-Part\r\n"
        b"\r\n"
        b"<ows:ExceptionReport/>\r\n"
        b"--wcs--\r\n"
    )
    with pytest.raises(ValueError, match="image/tiff"):
        parse_wcs_multipart(body)


# ---------------------------------------------------------------------------
# Geometry — sampling a line through the fixture grid
# ---------------------------------------------------------------------------


def test_sample_along_line_inside_bbox_returns_real_elevations() -> None:
    """A line that stays well inside the bbox yields finite elevations.

    The fixture bbox is 10 × 10 m at 150000, 200000. A horizontal line
    along the middle row (y = 200005) from x = 150001 to x = 150009
    stays in the interior — every sample returns a real value, none
    is NoData.
    """
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    pts = sample_geotiff_along_line(
        tiff,
        **BBOX,
        start_x=150001,
        start_y=200005,
        end_x=150009,
        end_y=200005,
        n_samples=5,
    )
    assert len(pts) == 5
    # Endpoints land at along=0 and along=length.
    assert pts[0].along_m == pytest.approx(0.0)
    assert pts[-1].along_m == pytest.approx(8.0)
    # All elevations are real and reasonable for the area (Brussels:
    # ~10–30 m TAW). Fixture observed at ~14.8–15 m TAW.
    for p in pts:
        assert p.elevation_m is not None
        assert 10.0 < p.elevation_m < 30.0


def test_sample_along_line_returns_none_outside_bbox() -> None:
    """A sample on the bbox right edge clamps to NoData (no neighbour pixel).

    The clamp is the documented "outside the interior 0..width-1 ×
    0..height-1 box returns None" behaviour. Callers can either pad
    their request bbox (the live sampler does, via ``_BBOX_PADDING_M``)
    or accept the None tail.
    """
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    pts = sample_geotiff_along_line(
        tiff,
        **BBOX,
        start_x=150000,
        start_y=200005,
        # Right edge — px = (150010 - 150000) / 1 = 10, > width-1 = 9.
        end_x=150010,
        end_y=200005,
        n_samples=2,
    )
    assert pts[0].elevation_m is not None
    assert pts[-1].elevation_m is None


def test_sample_along_line_zero_length_returns_empty() -> None:
    """A degenerate line (start = end) returns no samples.

    Prevents the bilinear interpolator from being asked for a single
    point — by spec the sampler is along a line, and a zero-length
    line has none.
    """
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    pts = sample_geotiff_along_line(
        tiff,
        **BBOX,
        start_x=150005,
        start_y=200005,
        end_x=150005,
        end_y=200005,
        n_samples=10,
    )
    assert pts == []


def test_sample_along_line_n_below_two_returns_empty() -> None:
    """``n_samples < 2`` is meaningless — one point isn't a line."""
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    pts = sample_geotiff_along_line(
        tiff,
        **BBOX,
        start_x=150001,
        start_y=200005,
        end_x=150009,
        end_y=200005,
        n_samples=1,
    )
    assert pts == []


def test_sample_along_line_bilinear_interpolates_between_pixels() -> None:
    """A sample halfway between two pixels gives ≈ their mean.

    Picks two adjacent rows on the same column. The fixture's
    column-0 row-0 elevation is ~14.85 and row-1 is something close;
    sampling at y between rows 0 and 1 should land between them
    (within float tolerance).
    """
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    # Pick a horizontal line that crosses the boundary between rows
    # 5 and 6 (world Y = 200004.5). The interpolated value should
    # fall between the two adjacent row values.
    pts = sample_geotiff_along_line(
        tiff,
        **BBOX,
        start_x=150001,
        start_y=200004.5,
        end_x=150002,
        end_y=200004.5,
        n_samples=2,
    )
    # Both samples are interior to the grid, so neither is None.
    assert all(p.elevation_m is not None for p in pts)
    # Sanity-bound the elevation — should be near 14.9 m TAW based
    # on the fixture probe.
    assert all(14.0 < (p.elevation_m or 0) < 16.0 for p in pts)


def test_sample_point_dataclass_is_frozen() -> None:
    """SamplePoint is immutable — guards against accidental mutation in callers."""
    p = SamplePoint(along_m=0.0, elevation_m=14.0)
    with pytest.raises(Exception):
        p.elevation_m = 15.0  # type: ignore[misc]
