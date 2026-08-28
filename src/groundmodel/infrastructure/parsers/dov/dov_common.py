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
DOV_ALLOWED_HOSTS: frozenset[str] = frozenset({urlsplit(DOV_WFS_URL).hostname or ""})


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

# Match `numberMatched="123"` from the WFS hits XML response. DOV returns XML for
# resultType=hits even when outputFormat=application/json is requested.
DOV_WFS_NUMBER_MATCHED_RE = re.compile(r'numberMatched="(\d+)"')


# ----------------------------------------------------------------------
# XML download
# ----------------------------------------------------------------------

# Max concurrent XML downloads. Higher (100) sometimes triggers DOV's per-IP rate
# limit during peak hours; 50 is the sweet spot we've measured.
DOV_DOWNLOAD_PARALLELISM = 50


# ----------------------------------------------------------------------
# CRS — DOV's primary horizontal CRS is Belgian Lambert 72 (EPSG:31370).
# Incoming WGS84 bboxes are transformed to Lambert 72 for the WFS BBOX filter.
# ----------------------------------------------------------------------

DOV_HORIZONTAL_EPSG = 31370  # Belgian Lambert 72
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


def cql_bbox_predicate(x1: float, y1: float, x2: float, y2: float) -> str:
    """Return a CQL ``BBOX(geom, ...)`` spatial predicate for a Lambert-72 bbox.

    Combine with attribute predicates via ``AND`` to build a single
    ``CQL_FILTER=`` value. DOV rejects requests that mix the WFS ``BBOX=``
    query parameter with a ``CQL_FILTER=`` — they're mutually exclusive
    on the server side, so the bbox MUST live inside the CQL string when
    we also need attribute filtering (parametergroep / parameter / …).
    """
    return f"BBOX({DOV_OBSERVATIE_GEOM_COLUMN},{x1},{y1},{x2},{y2},'EPSG:{DOV_HORIZONTAL_EPSG}')"


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
