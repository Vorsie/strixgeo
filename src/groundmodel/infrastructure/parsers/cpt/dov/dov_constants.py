"""DOV (Databank Ondergrond Vlaanderen) parser constants.

Per the project convention (see CLAUDE.md "Code Conventions" → "Constants in a
dedicated file"), no constants live at the top of the parser/client/cache
modules — they all live here.

Sections:
    * WFS endpoint and query parameters
    * XML download tuning (parallelism, URL prefix transform)
    * CRS handling (Lambert 72 transformer)
    * DOV XML schema namespaces and tag prefix
    * Cache permkey validation regex
"""

from __future__ import annotations

import re

from pyproj import Transformer

# ----------------------------------------------------------------------
# WFS endpoint
# ----------------------------------------------------------------------

DOV_WFS_URL = "https://www.dov.vlaanderen.be/geoserver/ows"

# Plural — verified via GetCapabilities. Singular `dov-pub:Sondering` is rejected
# by the server with "Feature type ... unknown".
DOV_WFS_LAYER = "dov-pub:Sonderingen"

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

# DOV's /data/sondering/{id}.xml endpoint always 302-redirects to /xdov/proxy/...
# Hitting the proxy directly cuts every download from 2 round-trips to 1.
# Verified live 2026-05-07: redirect target is deterministic for every sondering.
DOV_FICHE_URL_PREFIX = "/data/sondering/"
DOV_PROXY_URL_PREFIX = "/xdov/proxy/export/sondering/"


# ----------------------------------------------------------------------
# CRS — DOV's primary horizontal CRS is Belgian Lambert 72 (EPSG:31370).
# Incoming WGS84 bboxes are transformed to Lambert 72 for the WFS BBOX filter.
# ----------------------------------------------------------------------

DOV_HORIZONTAL_EPSG = 31370  # Belgian Lambert 72
DOV_VERTICAL_EPSG = 5710  # Belgian mTAW (TAW/NGF)

# Singleton transformer (always_xy=True forces lon,lat input order regardless of
# CRS authority axis order). pyproj.Transformer is thread-safe and stateless after init.
DOV_WGS84_TO_LAMBERT72: Transformer = Transformer.from_crs(
    "EPSG:4326", f"EPSG:{DOV_HORIZONTAL_EPSG}", always_xy=True
)


# ----------------------------------------------------------------------
# DOV XML schema namespaces
# ----------------------------------------------------------------------

# The DOV schema namespace is set ONLY on the root <dov-schema> element.
# Its children (<sondering>, <sondeernummer>, etc.) are unprefixed — they live
# in NO namespace at all. So bare tag strings work for the DOV element finds.
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
DOV_VALID_PERMKEY_RE = re.compile(r"^[A-Za-z0-9._-]+$")
