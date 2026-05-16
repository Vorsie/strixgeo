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

# Network timeout for tile-area requests (dem providers: a few km²).
# Both providers can return multi-MB tiles over a slow link; 30 s
# accommodates that without hanging a Build call indefinitely.
WCS_TIMEOUT_SECONDS: Final = 30.0

# Network timeout for line-profile requests (dhmvii_sampler: 1D section
# bbox only — typically a narrow strip of a few hundred metres).  A tighter
# limit is appropriate; the bbox and TIFF payload are much smaller.
WCS_SAMPLER_TIMEOUT_SECONDS: Final = 15.0

# Padding (metres) added around every requested bbox before sending to the
# WCS.  Ensures edge pixels have a bilinear neighbour; 2 m is sufficient at
# 1 m native resolution (DHMVII) and 0.5 m resolution (AHN4).
WCS_BBOX_PADDING_M: Final = 2.0

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
