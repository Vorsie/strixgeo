"""The ``DemProvider.fetch_grid`` contract is one signature, honoured or reported.

An external audit (2026-09-05) flagged that the ``DemProvider`` ABC and its WCS
implementation disagreed on the ``resolution_m`` parameter: the ABC declared it
required (``float``) while the implementation made it optional
(``float | None = None``) and then quietly ignored any value, because the WCS
coverage serves only its native grid.

This pins the resolved contract, in its own words:

* every provider's ``fetch_grid`` accepts ``resolution_m`` with the SAME
  signature (``inspect.signature``), and its default is ``None``;
* a provider that CANNOT honour an explicit resolution (the WCS providers serve
  a single native grid) does not silently ignore it: it logs a WARNING naming
  the requested and the native value, and the returned grid carries the cell
  size actually delivered.
"""

from __future__ import annotations

import inspect
import logging
import pathlib
import tempfile
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from groundmodel.infrastructure.dem.ahn4_dem_provider import Ahn4DemProvider
from groundmodel.infrastructure.dem.dem_provider import DemProvider
from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dem_wcs_constants import WCS_BBOX_PADDING_M
from groundmodel.infrastructure.dem.dhmvii_dem_provider import DhmviiDemProvider
from groundmodel.infrastructure.dem.wcs_dem_provider import WcsDemProvider

# The concrete provider surface whose ``fetch_grid`` must match the ABC's.
_CONCRETE_PROVIDERS = (WcsDemProvider, DhmviiDemProvider, Ahn4DemProvider)

# A real Flanders extent (Lambert 72) so a cache-miss path would pass the
# extent guard; the reporting tests seed the cache and never reach it.
_IN_DOMAIN = (88_000.0, 164_000.0, 88_600.0, 164_600.0)


def _float_tiff(rows: list[list[float]]) -> bytes:
    """Encode a 2D float grid as a 32-bit-float GeoTIFF blob (Pillow mode 'F')."""
    arr = np.array(rows, dtype=np.float32)
    buf = BytesIO()
    Image.fromarray(arr, mode="F").save(buf, format="TIFF")
    return buf.getvalue()


def _dhmvii() -> DhmviiDemProvider:
    """A DHMVII provider over a throwaway (empty) tile cache."""
    return DhmviiDemProvider(DemTileCache(pathlib.Path(tempfile.mkdtemp()), "dhmvii"))


def _seed_native_tile(provider: DhmviiDemProvider, requested_res: float) -> None:
    """Seed the tile cache for ``_IN_DOMAIN`` at ``requested_res`` so fetch is offline.

    The cache key includes the requested resolution, so it is seeded under the
    value the test passes to ``fetch_grid``; the tile itself is a small
    synthetic grid whose derived cell size is the native one, not the request.
    """
    pad = WCS_BBOX_PADDING_M
    provider._cache.put(
        _IN_DOMAIN[0] - pad,
        _IN_DOMAIN[1] - pad,
        _IN_DOMAIN[2] + pad,
        _IN_DOMAIN[3] + pad,
        requested_res,
        _float_tiff([[1.0, 2.0], [3.0, 4.0]]),
    )


# ---------------------------------------------------------------------------
# One signature across the ABC and every concrete provider
# ---------------------------------------------------------------------------


def test_fetch_grid_signature_is_consistent_across_providers() -> None:
    """Every provider's ``fetch_grid`` has the ABC's exact parameter list."""
    abc_params = list(inspect.signature(DemProvider.fetch_grid).parameters)
    assert "resolution_m" in abc_params
    for provider_cls in _CONCRETE_PROVIDERS:
        params = list(inspect.signature(provider_cls.fetch_grid).parameters)
        assert params == abc_params, (
            f"{provider_cls.__name__}.fetch_grid signature {params} diverges from "
            f"the DemProvider contract {abc_params}"
        )


def test_resolution_m_is_optional_and_defaults_to_none() -> None:
    """``resolution_m`` is optional with default ``None`` on the ABC and every provider."""
    abc_default = inspect.signature(DemProvider.fetch_grid).parameters["resolution_m"].default
    assert abc_default is None
    for provider_cls in (*_CONCRETE_PROVIDERS,):
        default = inspect.signature(provider_cls.fetch_grid).parameters["resolution_m"].default
        assert default is None, (
            f"{provider_cls.__name__}.fetch_grid resolution_m default is {default!r}, not None"
        )


# ---------------------------------------------------------------------------
# A resolution it cannot honour is reported, never silently ignored
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unhonourable_resolution_is_reported_at_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An explicit non-native resolution logs a WARNING and returns the native grid."""
    provider = _dhmvii()  # native DEFAULT_RESOLUTION_M is 1.0 m
    requested = 5.0
    _seed_native_tile(provider, requested)

    with caplog.at_level(logging.WARNING):
        grid = await provider.fetch_grid(*_IN_DOMAIN, resolution_m=requested)

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("cannot honour requested resolution" in m for m in warnings), (
        f"expected a 'cannot honour' WARNING, got: {warnings}"
    )
    # The delivered cell size is the tile's own, NOT the requested 5.0 m — proof
    # the request was reported rather than obeyed.
    assert grid.resolution_m != pytest.approx(requested)


@pytest.mark.asyncio
async def test_native_resolution_request_is_silent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Asking for the native resolution (or omitting it) does NOT warn."""
    provider = _dhmvii()  # native 1.0 m
    _seed_native_tile(provider, provider.DEFAULT_RESOLUTION_M)

    with caplog.at_level(logging.WARNING):
        await provider.fetch_grid(*_IN_DOMAIN, resolution_m=provider.DEFAULT_RESOLUTION_M)

    unhonourable = [
        r.getMessage()
        for r in caplog.records
        if r.levelno == logging.WARNING and "cannot honour requested resolution" in r.getMessage()
    ]
    assert unhonourable == [], f"a native-resolution request must not warn, but got: {unhonourable}"
