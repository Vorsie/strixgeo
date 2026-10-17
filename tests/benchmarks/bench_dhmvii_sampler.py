"""Performance benchmarks for the DHMVII DEM sampler.

Two cost layers matter:

* **Pure computation** — parse multipart, decode the GeoTIFF, run N
  bilinear lookups. Measured from a recorded fixture so it's network-
  independent and runs in CI.
* **Live round-trip** — add a real WCS GetCoverage to the path. Run
  manually via ``--bench-live`` because it depends on a public
  service being reachable.

Numbers are recorded in ``CLAUDE.local.md`` under "Performance
baseline" alongside the other parsers' figures.
"""

from __future__ import annotations

import asyncio
import os
import pathlib

import pytest

from groundmodel.infrastructure.dem.dem_tile_cache import DemTileCache
from groundmodel.infrastructure.dem.dhmvii_dem_provider import DhmviiDemProvider
from groundmodel.infrastructure.dem.dhmvii_sampler import (
    parse_wcs_multipart,
    sample_geotiff_along_line,
)

FIXTURE = (
    pathlib.Path(__file__).parents[1]
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
LINE = {
    "start_x": 150001.0,
    "start_y": 200005.0,
    "end_x": 150009.0,
    "end_y": 200005.0,
}


# ---------------------------------------------------------------------------
# Pure-computation benchmarks (no network)
# ---------------------------------------------------------------------------


def test_bench_parse_multipart(benchmark) -> None:
    """Cost of pulling the TIFF blob out of the multipart envelope."""
    raw = FIXTURE.read_bytes()
    benchmark(parse_wcs_multipart, raw)


def test_bench_sample_50_points(benchmark) -> None:
    """50-sample profile (visual density for a sub-100m section)."""
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    benchmark(
        sample_geotiff_along_line,
        tiff,
        **BBOX,
        **LINE,
        n_samples=50,
    )


def test_bench_sample_200_points(benchmark) -> None:
    """200-sample profile (typical default for a section panel)."""
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    benchmark(
        sample_geotiff_along_line,
        tiff,
        **BBOX,
        **LINE,
        n_samples=200,
    )


def test_bench_sample_1000_points(benchmark) -> None:
    """1000-sample profile (pixel-density on a wide monitor)."""
    raw = FIXTURE.read_bytes()
    tiff = parse_wcs_multipart(raw)
    benchmark(
        sample_geotiff_along_line,
        tiff,
        **BBOX,
        **LINE,
        n_samples=1000,
    )


def test_bench_full_pure_pipeline_200_points(benchmark) -> None:
    """End-to-end pure work: parse + decode + 200 lookups."""
    raw = FIXTURE.read_bytes()

    def run() -> int:
        tiff = parse_wcs_multipart(raw)
        return len(sample_geotiff_along_line(tiff, **BBOX, **LINE, n_samples=200))

    benchmark(run)


# ---------------------------------------------------------------------------
# Live round-trip — opt-in via ``DEM_LIVE_BENCH=1``
# ---------------------------------------------------------------------------
#
# Plugin-style ``--bench-live`` flags need to live in conftest.py to
# register with pytest at startup; an env var avoids that ceremony
# and reads identically to the other "external network" opt-ins in
# the codebase.


@pytest.mark.skipif(
    os.environ.get("DEM_LIVE_BENCH") != "1",
    reason="Live network benchmark — opt in with DEM_LIVE_BENCH=1",
)
def test_bench_live_round_trip_200_points(benchmark) -> None:
    """End-to-end including the WCS GetCoverage HTTP call.

    Runs the async provider synchronously inside the benchmark loop
    (#234: the line profile now rides WcsDemProvider + the tile cache;
    a per-iteration temp cache keeps the network in the measured path).
    Numbers vary with DHMVII server load; we capture wall-clock plus
    the breakdown via the unit-test benchmarks above.
    """
    import tempfile

    def run() -> int:
        async def _go() -> int:
            cache = DemTileCache(pathlib.Path(tempfile.mkdtemp()), "dhmvii")
            async with DhmviiDemProvider(cache) as s:
                pts = await s.sample_along_line(
                    start_x=150000,
                    start_y=200000,
                    end_x=150100,
                    end_y=200100,
                    n_samples=200,
                )
                return len(pts)

        return asyncio.run(_go())

    benchmark(run)
