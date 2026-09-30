"""Constants shared by every DOV-derived parser/client.

Per the project convention (see CLAUDE.md "Code Conventions" → "Constants in a
dedicated file"), no constants live at the top of parser/client/cache modules —
they all live here.

Sections
--------
* Source-system tag (``DOV_PROJECT_ID``)
* WFS endpoint and global tuning (feature limit, split depth, hits regex)
* HTTP / download tuning (parallelism)
* CRS handling (Lambert 72 transformer)
* DOV XML schema namespaces and tag prefix
* Cache permkey validation regex

Test-type-specific constants (the ``dov-pub:Sonderingen`` layer name,
``/data/sondering/`` URL prefix, etc.) live in the test-type-specific
``dov_constants.py`` modules and re-export from here as needed.

Sibling DOV-shared modules — split by concern, imported directly by callers:

* ``dov_wfs_helpers.py`` — WFS GeoJSON-property helpers
  (``last_path_segment``, ``optional_float / int / date``)
* ``dov_xml_helpers.py`` — XML element helpers (``text``, ``float_value``,
  ``date_iso``)
* ``dov_http.py`` — ``make_dov_async_client()`` factory
* ``dov_wfs_bbox.py`` — recursive bbox-split + count + dedup helper
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from pyproj import Transformer

# ----------------------------------------------------------------------
# Source-system tag
# ----------------------------------------------------------------------

# Identifier we use as ``project_id`` on every record imported via DOV
# (CPT, borehole, future sample / observation). The dedup contract on the
# repositories (``find_existing_test_ids("DOV", ...)``) keys off this tag
# so a DOV record imports independently into different app projects but
# never duplicates within one.
DOV_PROJECT_ID = "DOV"


# ----------------------------------------------------------------------
# WFS endpoint
# ----------------------------------------------------------------------

DOV_WFS_URL = "https://www.dov.vlaanderen.be/geoserver/ows"

# Host allow-list for every URL we fetch from a DOV response. The WFS feature
# `fiche` property is untrusted (a colleague's .strix / a hostile or MITM'd
# response could name any host): left unchecked, it steers our next HTTP GET
# at an arbitrary URL — a blind SSRF that could reach a link-local metadata
# endpoint or an intranet host. Derived from DOV_WFS_URL so the DOV host is
# stated once; a URL whose host is not on this set is refused, never fetched.
# The Virtuele Boring (layer-model) API is served from a second DOV host,
# ``services.dov.vlaanderen.be`` (``virtuele_boring_constants.DOV_VIRTUELE_BORING_BASE_URL``,
# stated as a literal here because that module must not be imported by this base
# module). Without it every layer-model request was refused as off-host and the DOV
# panel on the CPT and borehole views sat greyed out (installer #17, 2026-09-05).
DOV_VIRTUELE_BORING_HOST = "services.dov.vlaanderen.be"
DOV_ALLOWED_HOSTS: frozenset[str] = frozenset(
    {urlsplit(DOV_WFS_URL).hostname or "", DOV_VIRTUELE_BORING_HOST}
)


def is_allowed_dov_url(url: str) -> bool:
    """Return whether *url* points at an allow-listed DOV host over http(s).

    Parameters
    ----------
    url : str
        A candidate URL built from a DOV WFS response (e.g. the `fiche`-derived
        XML download URL) or a redirect target.

    Returns
    -------
    bool
        ``True`` only when the scheme is http/https AND the host is in
        ``DOV_ALLOWED_HOSTS``. Everything else — another host, a bare path with
        no host, ``file://``/``gopher://`` and friends — is refused, which is
        the guard against a response steering the fetch off-host (SSRF).
    """
    parts = urlsplit(url)
    return parts.scheme in ("http", "https") and parts.hostname in DOV_ALLOWED_HOSTS


# Default server-side cap on features per WFS request — DOV's GeoServer truncates above this.
# Bbox queries beyond this count are recursively split into quadrants.
DOV_WFS_FEATURE_LIMIT = 500

# Recursive bbox-split depth limit. 5 → up to 32 subdivisions per axis (1024 quadrants).
# Above that, DOV's data is too dense to be a realistic project import scope anyway.
DOV_WFS_MAX_SPLIT_DEPTH = 5

# ----------------------------------------------------------------------
# Import-scope guards (owner may change these)
# ----------------------------------------------------------------------

# Longest bbox side we accept for one import, in kilometres. The area guard below
# is the product 25 km x 25 km; this constant records the intent ("25 km x 25 km")
# so the 422 message reads in the units the user drew the box in.
DOV_MAX_BBOX_SIDE_KM = 25.0

# Product (area) limit for one import bbox, in square kilometres. A user who drags
# a box larger than this is refused BEFORE any WFS discovery: the recursive split
# would otherwise fan out to 1024 quadrants and the download phase to thousands of
# XMLs (see DOV_MAX_IMPORT_FEATURES). 25 km x 25 km = 625 km² is a generous single
# project footprint while still bounding the fan-out. Owner may retune.
DOV_MAX_BBOX_AREA_KM2 = DOV_MAX_BBOX_SIDE_KM * DOV_MAX_BBOX_SIDE_KM

# Hard ceiling on the number of features one import may DISCOVER before it starts
# downloading. DOV discovery counts features cheaply (resultType=hits); once the
# recursive split resolves more than this many unique rows the import stops with a
# 422-class error naming the count and this limit, so a mis-drawn continent-sized
# box can never launch thousands of parallel XML downloads. Owner may retune.
DOV_MAX_IMPORT_FEATURES = 2000

# Match `numberMatched="123"` from the WFS hits XML response. DOV returns XML for
# resultType=hits even when outputFormat=application/json is requested.
DOV_WFS_NUMBER_MATCHED_RE = re.compile(r'numberMatched="(\d+)"')


# ----------------------------------------------------------------------
# XML download
# ----------------------------------------------------------------------

# Max concurrent XML downloads. Higher (100) sometimes triggers DOV's per-IP rate
# limit during peak hours; 50 is the sweet spot we've measured.
DOV_DOWNLOAD_PARALLELISM = 50

# HTTP statuses that mean "DOV is throttling / briefly unavailable" — retryable
# rather than a hard failure. 429 = per-IP rate limit; 503 = service unavailable
# (GeoServer restart / overload). Anything else (4xx/5xx) is a genuine error we
# surface immediately.
DOV_RETRY_STATUS_CODES = frozenset({429, 503})

# Total attempts (initial + retries) for a throttled DOV request before we give
# up and surface the error. 3 balances riding out a brief rate-limit blip against
# stalling an import behind a genuinely-down upstream.
DOV_MAX_HTTP_ATTEMPTS = 3

# Base delay (seconds) for the exponential back-off used when a throttled
# response carries no ``Retry-After`` header: attempt N waits base * 2**(N-1).
DOV_RETRY_BASE_DELAY_S = 0.5

# Hard cap (seconds) on any single back-off wait, whether from ``Retry-After`` or
# the exponential schedule — a hostile / mis-set ``Retry-After: 86400`` must not
# freeze an import for a day.
DOV_RETRY_MAX_DELAY_S = 30.0


# ----------------------------------------------------------------------
# CRS — DOV's primary horizontal CRS is Belgian Lambert 72 (EPSG:31370).
# Incoming WGS84 bboxes are transformed to Lambert 72 for the WFS BBOX filter.
#
# Watch (Lambert 2008): DOV may migrate its horizontal CRS from Lambert 72
# (EPSG:31370) to Lambert 2008 (EPSG:3812). The CRS is pinned here deliberately
# so the switch is a one-value change: set DOV_HORIZONTAL_EPSG to 3812 and the
# rest follows from it. DOV_WGS84_TO_LAMBERT72 is built from DOV_HORIZONTAL_EPSG
# (re-targets automatically; rename it if you flip the code), cql_bbox_predicate
# already interpolates DOV_HORIZONTAL_EPSG into its EPSG string, and the
# out-of-area coordinate check tracks it too: the DOV parsers pass
# DOV_HORIZONTAL_EPSG into make_crs_bounds_issue, whose classify_coordinates()
# reads that EPSG's own pyproj area_of_use, so the bounds box re-derives for the
# new system with no further edit. Before flipping the code, confirm the DOV WFS
# still accepts 'EPSG:3812' in the BBOX / CQL_FILTER predicate.
# ----------------------------------------------------------------------

DOV_HORIZONTAL_EPSG = 31370  # Belgian Lambert 72 (see the Lambert 2008 watch note above)
DOV_VERTICAL_EPSG = 5710  # Belgian mTAW (TAW/NGF)

# Geometry column on `monster:observaties` (and most other DOV WFS layers).
# Used inside CQL_FILTER's BBOX() spatial predicate when we need to combine
# bbox + attribute filtering — DOV rejects requests that pass BOTH a `BBOX=`
# query parameter AND a `CQL_FILTER=` (since 2026-05): "bbox and cql_filter
# both specified but are mutually exclusive". Verified via DescribeFeatureType.
DOV_OBSERVATIE_GEOM_COLUMN = "geom"

# Singleton transformer (always_xy=True forces lon,lat input order regardless of
# CRS authority axis order). pyproj.Transformer is thread-safe and stateless after init.
DOV_WGS84_TO_LAMBERT72: Transformer = Transformer.from_crs(
    "EPSG:4326", f"EPSG:{DOV_HORIZONTAL_EPSG}", always_xy=True
)

# The inverse (Lambert 72 metres -> WGS84 lon, lat): a borehole found by name
# carries Lambert 72 coordinates, the bbox-shaped child phases take WGS84.
DOV_LAMBERT72_TO_WGS84: Transformer = Transformer.from_crs(
    f"EPSG:{DOV_HORIZONTAL_EPSG}", "EPSG:4326", always_xy=True
)

# Half-width (m) of the box the interpretation / sample phases search around ONE
# borehole imported by name. Their WFS rows sit on the borehole's own point; 25 m
# absorbs rounding between layers without reaching far (rows of other boreholes in
# the box are ignored: those phases attach only to the boreholes they were given).
DOV_SINGLE_BOREHOLE_BOX_HALF_WIDTH_M = 25.0


def cql_bbox_predicate(x1: float, y1: float, x2: float, y2: float) -> str:
    """Return a CQL ``BBOX(geom, ...)`` spatial predicate for a Lambert-72 bbox.

    Combine with attribute predicates via ``AND`` to build a single
    ``CQL_FILTER=`` value. DOV rejects requests that mix the WFS ``BBOX=``
    query parameter with a ``CQL_FILTER=`` — they're mutually exclusive
    on the server side, so the bbox MUST live inside the CQL string when
    we also need attribute filtering (parametergroep / parameter / …).
    """
    return f"BBOX({DOV_OBSERVATIE_GEOM_COLUMN},{x1},{y1},{x2},{y2},'EPSG:{DOV_HORIZONTAL_EPSG}')"


def validate_wgs84_import_bbox(*, west: float, south: float, east: float, north: float) -> None:
    """Validate a WGS84 import bounding box against the ordering + area guards.

    The four corners arrive straight from the renderer's draw gesture and are
    otherwise passed on to a recursive WFS split that fans out to up to 1024
    quadrants at 50-way download parallelism. A reversed, degenerate, or
    continent-sized box would launch that fan-out for nothing, so every import
    request is checked here first.

    Parameters
    ----------
    west, south, east, north : float
        Bounding box corners in WGS84 decimal degrees. ``east`` must be strictly
        greater than ``west`` and ``north`` strictly greater than ``south`` (a
        reversed OR zero-extent box fails the same check).

    Raises
    ------
    ValueError
        When ``east <= west`` (message names east/west), when ``north <= south``
        (message names north/south), or when the projected area exceeds
        :data:`DOV_MAX_BBOX_AREA_KM2` (message names the limit and the computed
        area). Raised inside the two DOV request schemas' validators, where
        pydantic turns it into the request's ``422``.
    """
    # Ordering + degeneracy: a strict inequality rejects a reversed box (corners
    # swapped) and a degenerate box (a corner shared, so zero width/height) with
    # one check, and the message names exactly which pair is wrong.
    if east <= west:
        raise ValueError(
            f"bounding box east ({east}) must be greater than west ({west}); "
            "the eastern edge is at or west of the western edge"
        )
    if north <= south:
        raise ValueError(
            f"bounding box north ({north}) must be greater than south ({south}); "
            "the northern edge is at or below the southern edge"
        )

    # Area: project the two diagonal corners to Lambert 72 metres so the span is a
    # real ground distance (a degree of longitude is ~70 km at Belgian latitudes,
    # not 111 km — a degree-space check would be wrong by cos(lat)). Belgium is
    # near-conformal under Lambert 72 so the axis-aligned span of the two diagonal
    # corners is an accurate footprint for a project-sized box.
    x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
    x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
    area_km2 = (abs(x2 - x1) * abs(y2 - y1)) / 1_000_000.0
    if area_km2 > DOV_MAX_BBOX_AREA_KM2:
        raise ValueError(
            f"bounding box is too large: {area_km2:.0f} km² exceeds the "
            f"{DOV_MAX_BBOX_AREA_KM2:.0f} km² "
            f"({DOV_MAX_BBOX_SIDE_KM:.0f} km x {DOV_MAX_BBOX_SIDE_KM:.0f} km) import limit; "
            "draw a smaller area"
        )


# ----------------------------------------------------------------------
# DOV XML schema namespaces
# ----------------------------------------------------------------------

# The DOV schema namespace is set ONLY on the root <dov-schema> element.
# Its children (<sondering>, <boring>, <sondeernummer>, etc.) are unprefixed —
# they live in NO namespace at all. So bare tag strings work for the DOV element finds.
DOV_XML_NAMESPACE = "http://kern.schemas.dov.vlaanderen.be"

# GML elements (<gml:Point>, <gml:pos>) ARE namespaced.
DOV_GML_NAMESPACE = "http://www.opengis.net/gml/3.2"

# ElementTree-friendly tag prefix: '{namespace}tagname' is how ET represents
# namespaced elements. Used for find()/findall() of GML elements.
DOV_GML_TAG_PREFIX = f"{{{DOV_GML_NAMESPACE}}}"


# ----------------------------------------------------------------------
# XML cache — permkey validation
# ----------------------------------------------------------------------

# Permkey format: digits, letters, hyphens, dots, underscores only (e.g. "2009-000089").
# Anything else is rejected so a malformed key can't escape the cache directory
# via "../" path-traversal tricks.
# Debt #113: use \A/\Z (true string anchors) instead of ^/$ (line anchors) so a
# multi-line permkey string like "abc\n../evil" doesn't slip through.  This is
# consistent with virtuele_boring_client.py which already uses \A/\Z.
DOV_VALID_PERMKEY_RE = re.compile(r"\A[A-Za-z0-9._-]+\Z")
