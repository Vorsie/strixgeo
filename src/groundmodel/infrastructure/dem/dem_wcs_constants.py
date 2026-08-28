"""WCS client constants for the DEM providers (DHMVII and AHN4).

These constants are importable by all DEM-related modules so a URL change or
nodata-value correction touches one place.  The split into per-provider
sections (DHMVII / AHN4) mirrors the split in ``dem_provider.py`` but keeps
the values here rather than inline in the provider classes.

Verified live:
  - DHMVII endpoint: 2026-05-11 (geopunt WCS — see ``dhmvii_sampler.py``)
  - AHN4 endpoint:   2026-05-11 (PDOK WCS GetCapabilities)
"""

from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Shared — identical for both providers
# ---------------------------------------------------------------------------

# OGC WCS version used in all GetCoverage requests.
# 2.0.1 is the current stable revision; 1.1.x is the legacy fallback.
WCS_VERSION: Final = "2.0.1"

# Network timeout for WCS GetCoverage requests. Tile-area requests (a few
# km²) can return multi-MB tiles over a slow link; 30 s accommodates that
# without hanging a Build call indefinitely. Line-profile requests (narrow
# section strips) share the same client + ceiling since #234 routed them
# through the provider stack.
WCS_TIMEOUT_SECONDS: Final = 30.0

# Padding (metres) added around every requested bbox before sending to the
# WCS.  Ensures edge pixels have a bilinear neighbour; 2 m is sufficient at
# 1 m native resolution (DHMVII) and 0.5 m resolution (AHN4).
WCS_BBOX_PADDING_M: Final = 2.0

# Largest span (metres) accepted on either axis of a tile request. A real
# project hull is a few km across; anything beyond 25 km is a caller bug
# (bad CRS, a stray 0 coordinate dragging the bbox to the origin) and at
# 1 m native resolution would ask the WCS for a >600 Mpixel tile.
WCS_MAX_EXTENT_SPAN_M: Final = 25_000.0

# Hard cap on the pixel count (width × height) the decoder will materialise
# from a WCS response. The response header's declared dimensions are untrusted:
# a hostile or broken DEM server can claim a billion-pixel image in a tiny
# payload and drive the per-pixel decode loop into an unbounded allocation that
# hangs and OOMs the backend. This bounds it. 100 Mpixel is generous — it covers
# a ~5 km × 5 km project tile at the finest native resolution we consume (AHN4's
# 0.5 m → 10_000² px); the extent guard (WCS_MAX_EXTENT_SPAN_M) already refuses
# spans larger than a real project hull upstream, and this is the second line
# for the RESPONSE the server controls independently of the request. It is
# deliberately tighter than the extent guard's theoretical maximum because the
# 2-D decode materialises every pixel as a Python object; a tile beyond it
# degrades to "no DEM here" (DEM is a fallback), never a crash.
WCS_MAX_DECODE_PIXELS: Final = 100_000_000

# How long an upstream failure for one exact tile key is remembered before
# the network is tried again. Born from the dogfeed 2026-08-02 flood: a
# section at (0,0)→(1000,0) re-requested the same 404ing strip dozens of
# times in one session because nothing remembered the previous answer.
# 5 minutes is long enough to kill a UI-driven retry storm and short enough
# that a transient outage self-heals within one working pause.
WCS_NEGATIVE_CACHE_TTL_SECONDS: Final = 300.0

# ---------------------------------------------------------------------------
# DHMVII — Flanders / EPSG:31370 (BD72 / Belgian Lambert 1972)
# ---------------------------------------------------------------------------

# Geopunt WCS endpoint for the DHMVII DTM.  Subset axes are ``X`` and ``Y``
# (not E/N) for EPSG:31370.
DHMVII_WCS_URL: Final = "https://geo.api.vlaanderen.be/DHMV/wcs"

# Coverage identifier — 1 m native LiDAR DTM for Flanders.
DHMVII_COVERAGE_ID: Final = "DHMVII_DTM_1m"

# NoData sentinel embedded in the GML metadata as
# ``<swe:nilValue>-9999</swe:nilValue>``.  Appears at water bodies, hill
# shadows, and outside-coverage pixels.
DHMVII_NODATA: Final = -9999.0

# Plausible domain of EPSG:31370 (Belgian Lambert 72), as
# (min_x, min_y, max_x, max_y) in metres. This is the CRS's own area of use
# (all of Belgium, with margin) — NOT the DHMVII coverage footprint: a
# Wallonia bbox is a legitimate request that simply returns NoData, and must
# not be refused. What this rejects is coordinates that cannot be Lambert 72
# at all — the (0,0)-anchored extents a section drawn in section space (or a
# stale/zeroed section row) produces. Such a request can only 404, forever.
DHMVII_VALID_EXTENT: Final = (14_000.0, 20_000.0, 300_000.0, 250_000.0)

# ---------------------------------------------------------------------------
# AHN4 — Netherlands / EPSG:28992 (Amersfoort / RD New)
# ---------------------------------------------------------------------------

# PDOK WCS endpoint for AHN4 DTM.  Subset axes are ``E`` and ``N`` per the
# CRS axis definition in EPSG:28992 — a quirk of OGC WCS 2.0 (axis names
# come from the CRS definition, not the conventional "X first" order).
AHN4_WCS_URL: Final = "https://service.pdok.nl/rws/ahn/wcs/v1_0"

# Coverage identifier — 0.5 m native LiDAR DTM for the Netherlands.
AHN4_COVERAGE_ID: Final = "dtm_05m"

# AHN4 NoData sentinel: IEEE 754 float32 maximum (~3.403×10³⁸).  PDOK
# uses this value for cells outside AHN4 coverage or over permanent water.
# We compare with a threshold rather than exact equality to guard against
# float32→float64 precision expansion when Pillow decodes the TIFF.
AHN4_NODATA_THRESHOLD: Final = 1e37

# Plausible domain of EPSG:28992 (Amersfoort / RD New), as
# (min_x, min_y, max_x, max_y) in metres — the CRS's area of use (the
# Netherlands, with margin). Same purpose as ``DHMVII_VALID_EXTENT``: reject
# coordinates that are not RD New at all. Note RD New's false origin puts
# every real Y above ~276 km, so an origin-anchored extent fails on Y.
AHN4_VALID_EXTENT: Final = (0.0, 270_000.0, 310_000.0, 640_000.0)
