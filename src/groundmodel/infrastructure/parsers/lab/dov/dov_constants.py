"""DOV lab-test parser constants.

Shared DOV-domain constants (WFS URL, namespaces, coordinate transformer,
permkey regex, parallelism) live in ``infrastructure/parsers/dov/dov_common.py``
and are re-exported below so importers can pull everything they need from this
single module without crossing into the borehole or CPT side of the tree.

Lab-specific constants (the ``monster:observaties`` WFS layer, the
parametergroep filter for grain-size tests, the observation XML element-name
constants, the pre-treatment vocabulary) are defined locally.

References:
* DOV WFS endpoint at https://www.dov.vlaanderen.be/geoserver/ows
* Schema verified live 2026-05-08 — see ``reference_dov_endpoints`` and
  ``reference_dov_codelists`` memory files.
"""

from __future__ import annotations

# Re-export shared DOV primitives.
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_DOWNLOAD_PARALLELISM as DOV_DOWNLOAD_PARALLELISM,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_GML_NAMESPACE as DOV_GML_NAMESPACE,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_GML_TAG_PREFIX as DOV_GML_TAG_PREFIX,
)
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_VALID_PERMKEY_RE as DOV_VALID_PERMKEY_RE,
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
    DOV_XML_NAMESPACE as DOV_XML_NAMESPACE,
)

# ----------------------------------------------------------------------
# Lab — WFS layer + parametergroep filter
# ----------------------------------------------------------------------

# Observations are stored under ``monster:observaties``. One row per
# (sample, parameter) combination — 7.5M rows in DOV (May 2026), so a
# bbox import always filters by parametergroep before fetching XMLs.
DOV_WFS_OBSERVATIES_LAYER = "monster:observaties"

# Parametergroep filter for grain-size analyses. NOTE the trailing space —
# DOV's source data really does have it; CQL_FILTER comparisons fail without it.
DOV_PARAMETERGROEP_GRAIN_SIZE = "Onderkenningsproeven-korrelverdeling "


# ----------------------------------------------------------------------
# Observation XML — URL prefixes for the cache short-circuit
# ----------------------------------------------------------------------

# Per-observation XML at ``/data/observatie/{permkey}.xml`` 302-redirects to
# ``/xdov/proxy/export/observatie/...``. Hitting the proxy directly cuts every
# download from 2 round-trips to 1 — same trick as for sondering and boring.
DOV_OBSERVATIE_URL_PREFIX = "/data/observatie/"
DOV_OBSERVATIE_PROXY_URL_PREFIX = "/xdov/proxy/export/observatie/"


# ----------------------------------------------------------------------
# Observation XML — element names
# ----------------------------------------------------------------------

# Top-level element under the dov-schema root.
DOV_OBSERVATIE_WRAPPER_TAG = "observatie"

# Header children inside <observatie>.
DOV_OBSERVATIE_DEPTH_TOP_TAG = "diepte_van"
DOV_OBSERVATIE_DEPTH_BOTTOM_TAG = "diepte_tot"
DOV_OBSERVATIE_PARAMETER_TAG = "parameter"
DOV_OBSERVATIE_PARAMETERGROEP_TAG = "parametergroep"
DOV_OBSERVATIE_METHODE_TAG = "methode"
DOV_OBSERVATIE_DATE_TAG = "fenomeentijd"  # ISO date — when the test was run

# The series wrapper for grain-size and other meetreeks-shape tests.
DOV_OBSERVATIE_SERIES_TAG = "waarde_meetreeks"
DOV_OBSERVATIE_SERIES_ROW_TAG = "meetreekswaarde"

# Inside each <meetreekswaarde>: the diameter and percentage values.
# DOV emits them in (meetwaarde, meetpunt) order even though logically the
# meetpunt (x = diameter) precedes the meetwaarde (y = % larger). We extract
# by tag name, so the source order doesn't matter.
DOV_OBSERVATIE_DIAMETER_TAG = "meetpunt_numeriek"
DOV_OBSERVATIE_PERCENTAGE_TAG = "meetwaarde_numeriek"


# ----------------------------------------------------------------------
# Pre-treatment vocabulary
# ----------------------------------------------------------------------

# Each <behandeling> wrapper holds an inner <behandeling> string identifying
# the pre-treatment plus a <behandeling_waarde> "ja"/"nee" flag. We map the
# two known pre-treatments to typed booleans on the GrainSize entity.
DOV_OBSERVATIE_BEHANDELING_TAG = "behandeling"  # outer wrapper
DOV_OBSERVATIE_BEHANDELING_INNER_TAG = "behandeling"  # nested same name
DOV_OBSERVATIE_BEHANDELING_VALUE_TAG = "behandeling_waarde"

# Source-vocabulary strings DOV uses to identify the two pre-treatments
# domain ``GrainSize`` cares about. Match exactly (DOV is consistent here).
DOV_BEHANDELING_LIME_REMOVED = "Kalk verwijderd"
DOV_BEHANDELING_ORGANICS_REMOVED = "Organisch materiaal verwijderd"

# DOV ja/nee flag values, matched case-insensitively for resilience.
DOV_BEHANDELING_YES_LOWER = "ja"
DOV_BEHANDELING_NO_LOWER = "nee"
