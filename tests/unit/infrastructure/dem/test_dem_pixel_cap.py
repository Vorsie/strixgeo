"""A DEM GeoTIFF that declares an absurd pixel count is refused, not decoded.

The DEM providers decode the WCS response by looping over the server-declared
``width × height`` and reading every pixel into a Python list. Those dimensions
come from the (untrusted) response header: a hostile or broken DEM server can
declare a billion-pixel image in a tiny response and drive the decode loop into
an unbounded allocation that hangs and OOMs the backend. Because the DEM is a
fallback, the guard degrades to "no DEM here" (a ``DemExtentRefusedError`` the
routers already turn into a clean 422) rather than crashing the request.
"""

from __future__ import annotations

import pathlib
import tempfile

import pytest

from groundmodel.infrastructure.dem import wcs_dem_provider
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dhmvii_dem_provider import DhmviiDemProvider
from groundmodel.shared.exceptions import DemExtentRefusedError


class _FakeImage:
    """Stand-in for a decoded ``PIL.Image`` with an attacker-declared size."""

    def __init__(self, size: tuple[int, int]) -> None:
        self.size = size
        self.getpixel_calls = 0

    def getpixel(self, _xy: tuple[int, int]) -> float:
        self.getpixel_calls += 1
        return 1.0


class _FakeImageModule:
    """Replaces the module-level ``Image`` so ``Image.open`` yields our fake."""

    def __init__(self, img: _FakeImage) -> None:
        self._img = img

    def open(self, _bio: object) -> _FakeImage:
        return self._img


def _provider() -> DhmviiDemProvider:
    return DhmviiDemProvider(DemTileCache(pathlib.Path(tempfile.mkdtemp()), "dhmvii"))


def test_billion_pixel_tiff_is_refused_without_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    """A response declaring 1e10 pixels is refused before the decode loop runs."""
    # A ~200-byte response header can claim 100_000 × 100_000 = 1e10 pixels.
    fake = _FakeImage((100_000, 100_000))
    monkeypatch.setattr(wcs_dem_provider, "Image", _FakeImageModule(fake))

    provider = _provider()
    with pytest.raises(DemExtentRefusedError):
        provider._decode_tiff(b"hostile", 0.0, 0.0, 1000.0, 1000.0, from_cache=False)

    # Proof nothing was allocated: the decode loop never ran a single getpixel.
    assert fake.getpixel_calls == 0


def test_normal_tiff_still_decodes(monkeypatch: pytest.MonkeyPatch) -> None:
    """A legitimate small tile decodes fully — the cap only bites the absurd case."""
    # A legitimate small tile decodes byte-identically — the cap only bites the
    # absurd declaration, never a real DEM tile.
    fake = _FakeImage((3, 2))
    monkeypatch.setattr(wcs_dem_provider, "Image", _FakeImageModule(fake))

    provider = _provider()
    grid = provider._decode_tiff(b"real", 0.0, 0.0, 3.0, 2.0, from_cache=False)

    assert grid.n_cols == 3
    assert grid.n_rows == 2
    assert fake.getpixel_calls == 6  # every pixel read, no refusal
    assert grid.values == (1.0,) * 6
