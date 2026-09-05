"""DOV CPT (sondering) parser constants.

Shared DOV-domain constants (WFS URL, namespaces, coordinate transformer,
permkey regex, parallelism) live in ``infrastructure/parsers/dov/dov_common.py``
and are re-exported from this module so existing imports
``from groundmodel.infrastructure.parsers.cpt.dov.dov_constants import …``
continue to work unchanged.

CPT-specific constants (sondering WFS layer name, sondering URL prefixes for
the cache trick) are defined locally below.
"""

from __future__ import annotations

# Re-export shared DOV primitives for back-compat. Importers of this module
# (gef_parser, dov_parser, dov_client, dov_xml_cache, ...) keep working as-is.
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_DOWNLOAD_PARALLELISM as DOV_DOWNLOAD_PARALLELISM,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_GML_NAMESPACE as DOV_GML_NAMESPACE,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_GML_TAG_PREFIX as DOV_GML_TAG_PREFIX,
)

# DOV_HORIZONTAL_EPSG and the DOV_WGS84_TO_LAMBERT72 transformer are DEFINED in
# dov_common.py; see the "Watch (Lambert 2008)" note there before changing the
# DOV horizontal CRS (EPSG:31370 -> EPSG:3812).
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_HORIZONTAL_EPSG as DOV_HORIZONTAL_EPSG,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_VALID_PERMKEY_RE as DOV_VALID_PERMKEY_RE,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_VERTICAL_EPSG as DOV_VERTICAL_EPSG,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WFS_FEATURE_LIMIT as DOV_WFS_FEATURE_LIMIT,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WFS_MAX_SPLIT_DEPTH as DOV_WFS_MAX_SPLIT_DEPTH,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WFS_NUMBER_MATCHED_RE as DOV_WFS_NUMBER_MATCHED_RE,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WFS_URL as DOV_WFS_URL,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WGS84_TO_LAMBERT72 as DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_XML_NAMESPACE as DOV_XML_NAMESPACE,
)

# ----------------------------------------------------------------------
# CPT (sondering) — WFS layer
# ----------------------------------------------------------------------

# Plural — verified via GetCapabilities. Singular `dov-pub:Sondering` is rejected
# by the server with "Feature type ... unknown".
DOV_WFS_LAYER = "dov-pub:Sonderingen"


# ----------------------------------------------------------------------
# CPT (sondering) — XML download URL prefixes
# ----------------------------------------------------------------------

# DOV's /data/sondering/{id}.xml endpoint always 302-redirects to /xdov/proxy/...
# Hitting the proxy directly cuts every download from 2 round-trips to 1.
# Verified live 2026-05-07: redirect target is deterministic for every sondering.
DOV_FICHE_URL_PREFIX = "/data/sondering/"
DOV_PROXY_URL_PREFIX = "/xdov/proxy/export/sondering/"

# ----------------------------------------------------------------------
# Parse offload threshold
# ----------------------------------------------------------------------

# Minimum uncompressed XML size (bytes) before a parse task is offloaded
# to the ProcessPoolExecutor.  Below this threshold, the ~0.1 ms IPC
# overhead + pool task-scheduling cost exceeds the ~1–3 ms parse time.
# 50 kB is well below a typical DOV sondering (~500 kB) so effectively
# every network download gets offloaded; cache hits for very small XMLs
# run inline on the event loop without pool overhead.
# Tune by measuring ``phase 2 (download + parse)`` log lines in CLAUDE.local.md.
PARSE_OFFLOAD_MIN_BYTES = 50_000
