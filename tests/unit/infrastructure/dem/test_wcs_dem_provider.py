"""Tests for the shared WCS DEM provider base + the two providers' hooks.

Covers the decode pipeline (``_decode_tiff``) once on the base and pins the two
genuine per-source divergences that the extraction parameterised:

* ``_is_nodata`` — DHMVII sentinel equality (``-9999``) vs AHN4 ``float32``-max
  threshold (``>=``).
* ``_extract_tiff`` — DHMVII multipart/related vs AHN4 plain-body-with-magic-
  byte-validation.

Before this base existed both providers carried a near-verbatim copy of the
decode + lifecycle code and neither had a unit test (audit gap, 2026-06-04).
"""

from __future__ import annotations

import pathlib
import tempfile
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from groundmodel.infrastructure.dem.ahn4_dem_provider import Ahn4DemProvider
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dem_wcs_constants import AHN4_NODATA_THRESHOLD, DHMVII_NODATA
from groundmodel.infrastructure.dem.dhmvii_dem_provider import DhmviiDemProvider

_MULTIPART_FIXTURE = (
    pathlib.Path(__file__).parents[3]
    / "fixtures"
    / "dem"
    / "dhmvii_10x10_at_150000_200000.multipart"
)


def _float_tiff(rows: list[list[float]]) -> bytes:
    """Encode a 2D float grid as a 32-bit-float GeoTIFF blob (Pillow mode 'F')."""
    arr = np.array(rows, dtype=np.float32)
    buf = BytesIO()
    Image.fromarray(arr, mode="F").save(buf, format="TIFF")
    return buf.getvalue()


def _dhmvii() -> DhmviiDemProvider:
    return DhmviiDemProvider(DemTileCache(pathlib.Path(tempfile.mkdtemp()), "dhmvii"))


def _ahn4() -> Ahn4DemProvider:
    return Ahn4DemProvider(DemTileCache(pathlib.Path(tempfile.mkdtemp()), "ahn4"))


# ---------------------------------------------------------------------------
# Shared decode pipeline + per-source NoData hook
# ---------------------------------------------------------------------------


def test_decode_maps_dhmvii_sentinel_to_none_and_derives_resolution() -> None:
    """The −9999 sentinel becomes None; resolution is bbox-width ÷ n_cols; row 0 is top."""
    tiff = _float_tiff([[1.0, 2.0], [DHMVII_NODATA, 4.0]])
    grid = _dhmvii()._decode_tiff(tiff, 0.0, 0.0, 2.0, 2.0, from_cache=False)
    assert (grid.n_cols, grid.n_rows) == (2, 2)
    assert grid.resolution_m == 1.0  # (2 - 0) / 2 cols
    assert grid.values == (1.0, 2.0, None, 4.0)  # row-major, the sentinel → None
    assert grid.from_cache is False


def test_decode_maps_ahn4_threshold_to_none() -> None:
    """AHN4 maps the float32-max NoData sentinel to None; a real elevation stays."""
    # The PDOK sentinel (~3.4e38) sits well above the 1e37 threshold and
    # round-trips cleanly through float32; a realistic elevation stays a value.
    tiff = _float_tiff([[5.0, 3.4e38]])
    grid = _ahn4()._decode_tiff(tiff, 0.0, 0.0, 1.0, 0.5, from_cache=True)
    assert (grid.n_cols, grid.n_rows) == (2, 1)
    assert grid.values == (5.0, None)
    assert grid.from_cache is True


def test_is_nodata_diverges_per_provider() -> None:
    """DHMVII uses sentinel equality; AHN4 uses a >= threshold."""
    d, a = _dhmvii(), _ahn4()
    assert d._is_nodata(DHMVII_NODATA) is True
    assert d._is_nodata(-9998.0) is False  # close to but not the sentinel → kept
    assert a._is_nodata(3.4e38) is True  # the real float32-max sentinel
    assert a._is_nodata(AHN4_NODATA_THRESHOLD) is True  # exactly at the threshold
    assert a._is_nodata(100.0) is False  # a realistic elevation is far below


# ---------------------------------------------------------------------------
# Per-source TIFF extraction hook
# ---------------------------------------------------------------------------


def test_ahn4_extract_passes_plain_tiff_and_rejects_non_tiff() -> None:
    """AHN4 passes a magic-byte-valid TIFF and raises on an OWS ExceptionReport."""
    a = _ahn4()
    tiff = _float_tiff([[1.0]])
    assert a._extract_tiff(tiff) == tiff
    with pytest.raises(ValueError, match="not a GeoTIFF"):
        a._extract_tiff(b"<?xml version='1.0'?><ExceptionReport/>")


def test_dhmvii_extract_pulls_tiff_from_multipart_fixture() -> None:
    """DHMVII extracts the image/tiff part out of the recorded multipart response."""
    if not _MULTIPART_FIXTURE.exists():
        pytest.skip("multipart fixture not present")
    tiff = _dhmvii()._extract_tiff(_MULTIPART_FIXTURE.read_bytes())
    assert tiff[:2] in (b"II", b"MM")  # GeoTIFF magic
