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


# ----------------------------------------------------------------------
# Observation — WFS feature property names (Phase C3)
# ----------------------------------------------------------------------

# Parent-sample linkage. Verified live 2026-05-08:
#   gekoppeld_aan_link = "https://www.dov.vlaanderen.be/data/monster/<permkey>"
# The orchestrator extracts the permkey via last-path-segment and resolves
# it against the sample-permkey → sample-UUID map built during phase C3
# sample persist.
DOV_OBSERVATIE_WFS_PARENT_LINK_PROP = "gekoppeld_aan_link"

# URL of the per-observation XML detail page (302-redirects to the proxy).
DOV_OBSERVATIE_WFS_FICHE_PROP = "fiche"

# Parametergroep filter property — the WFS column this maps to. We use it
# inside CQL_FILTER for server-side filtering (DOV has 7.5M observation
# rows, so client-side filtering would download an unworkable amount).
DOV_OBSERVATIE_WFS_PARAMETERGROEP_PROP = "parametergroep"

# More WFS-row property names — the scalar lab tests (Phase C4) read every
# value-bearing field straight off the WFS row, so we don't need an XML
# fetch like the grain-size series case. Verified live 2026-05-09 against
# real DOV observations (e.g. CaCO3 permkey 2019-790783).
DOV_OBSERVATIE_WFS_PARAMETER_PROP = "parameter"
DOV_OBSERVATIE_WFS_RESULTAAT_PROP = "resultaat"  # scalar value as a string
DOV_OBSERVATIE_WFS_EENHEID_PROP = "eenheid"  # unit (% / g/100g / etc.)
DOV_OBSERVATIE_WFS_METHODE_PROP = "methode"  # source-vocabulary method name
DOV_OBSERVATIE_WFS_FENOMEENTIJD_PROP = "fenomeentijd"  # ISO date when test was run
DOV_OBSERVATIE_WFS_DETECTIECONDITIE_PROP = "detectieconditie"
# observation_link kept for diagnostics — the per-observation XML body is
# only fetched for series tests (grain-size); scalar tests don't need it.
DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP = "observatie_link"


# ----------------------------------------------------------------------
# Phase C4 — scalar lab-test parameter strings
# ----------------------------------------------------------------------
# DOV duplicates the parameter token in parens at the end of every string
# (verified live 2026-05-09). The codelist memory file's older entries that
# omitted the doubled-token form returned 0 features; do NOT use a shorter
# form when adding new parameters here.

DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT = (
    "Consistentiegrenzen - Vloeigrens (Consistentiegrenzen - Vloeigrens)"
)
DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT = (
    "Consistentiegrenzen - Uitrolgrens (Consistentiegrenzen - Uitrolgrens)"
)
DOV_PARAMETER_CACO3 = "Calciumcarbonaatgehalte (caco3_gehalte)"
DOV_PARAMETER_ORGANIC_CARBON = "Organische C - percentage (organische_c_perc)"
DOV_PARAMETER_WATER_CONTENT = "Vochtgehalte luchtdroge grond (vocht_luchtdroge_grond)"


# ----------------------------------------------------------------------
# Phase C4 — detectieconditie tokens
# ----------------------------------------------------------------------
# When DOV's ``detectieconditie`` is populated, ``resultaat`` is null and
# the condition explains WHY. We map only "NM" (Niet Meetbaar = not
# measurable) to ``AtterbergLimits.non_plastic = True`` because only the
# plastic-limit test has a "soil cannot be rolled" non-plastic semantic;
# other tests with NM stay as plain "value not measured".
# Other observed tokens (e.g. ``"<"`` = below detection limit) are not
# semantically meaningful for any of our ORMs yet — pass through and the
# scalar mapper records value=None.
DOV_DETECTIECONDITIE_NOT_MEASURABLE = "NM"


# ----------------------------------------------------------------------
# Phase C5 — generic scalar lab-test parameters (ScalarLabTest catch-all)
# ----------------------------------------------------------------------
# Parameters that don't fit one of the 5 typed families above. Each entry
# is (parametergroep, parameter) pair — the orchestrator queries the
# observation WFS once per pair and persists matching rows into the
# ``scalar_lab_test`` table. Add new entries here without a migration.
#
# Strings copied verbatim from live DOV WFS — including the trailing
# space on parametergroep where DOV ships one (CQL is strict about
# exact match).

DOV_PARAMETER_GROUP_VOLUMEMASSA = "Volumemassa-watergehalte "  # trailing space intentional
DOV_PARAMETER_GROUP_ASTM_CLASSIFICATION = "Onderkenning-grondsoort"
DOV_PARAMETER_GROUP_ONDERKENNING_PROEVEN = "Onderkenning - proeven"

DOV_PARAMETER_GRAIN_DENSITY = "Korrelvolumemassa (korrelvolumemassa)"
DOV_PARAMETER_ASTM_CODE = "Grondsoort volgens ASTM, de code (ASTM_code)"
DOV_PARAMETER_CALCAREOUS_CONTENT = "Gehalte Kalkachtige stoffen (Gehalte Kalkachtige stoffen)"
# Additional parameters added 2026-05-09 after probing real samples
# (e.g. monster 2024-401424) showed that DOV publishes several scalar
# tests we weren't catching. ``Watergehalte`` is DISTINCT from our
# typed-family ``Vochtgehalte luchtdroge grond`` — both are water-
# content measurements but DOV treats them as different parameters,
# and our typed filter only matches the latter. Same story for
# organic-matter (``Gehalte Organische stoffen``) vs. our typed
# organic-carbon (``Organische C - percentage``).
# Strings copied verbatim from a live WFS probe of monster 2024-401424.
# DOV's doubled-tail format is INCONSISTENT — sometimes lowercase,
# sometimes a slug, sometimes identical, sometimes a different name
# entirely. We can't guess; every parameter has to be probed. The
# clay-content row is even nastier: the parameter name itself contains
# a "(MB)" suffix (methylene blue method indicator) so the full string
# has TWO sets of parens.
DOV_PARAMETER_WATER_CONTENT_ALT = "Watergehalte (watergehalte)"
DOV_PARAMETER_WET_DENSITY = "Volumemassa nat (volumemassa nat)"
DOV_PARAMETER_ORGANIC_MATTER = "Gehalte Organische stoffen (Gehalte Organische stoffen)"
DOV_PARAMETER_CLAY_CONTENT_MB = (
    "Bepaling kleihoudendheid in fractie 0-2 mm (MB) (Bepaling kleihoudendheid in fractie 0-2 mm)"
)
DOV_PARAMETER_ASTM_DESCRIPTION = "Grondsoort volgens ASTM, de beschrijving (ASTM_naam)"
DOV_PARAMETER_BGGG_NORM = "Grondsoort volgens BGGG norm (Grondsoort BGGG)"

# Registry: each (parameter_group, parameter) the orchestrator will fetch
# and persist into ``scalar_lab_test``. Append-only — adding a new tuple
# captures a new test type without code changes anywhere else.
#
# ⚠️  Don't add parameters that overlap with the 5 typed families
# (``DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT`` /
# ``DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT`` / ``DOV_PARAMETER_CACO3`` /
# ``DOV_PARAMETER_ORGANIC_CARBON`` / ``DOV_PARAMETER_WATER_CONTENT`` and
# the grain-size parametergroep). The orchestrator runs both queries in
# parallel and persists each separately — overlap = double storage.
# The entries below are disjoint by construction.
DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS: tuple[tuple[str, str], ...] = (
    (DOV_PARAMETER_GROUP_VOLUMEMASSA, DOV_PARAMETER_GRAIN_DENSITY),
    (DOV_PARAMETER_GROUP_VOLUMEMASSA, DOV_PARAMETER_WET_DENSITY),
    (DOV_PARAMETER_GROUP_VOLUMEMASSA, DOV_PARAMETER_WATER_CONTENT_ALT),
    (DOV_PARAMETER_GROUP_ASTM_CLASSIFICATION, DOV_PARAMETER_ASTM_CODE),
    (DOV_PARAMETER_GROUP_ASTM_CLASSIFICATION, DOV_PARAMETER_ASTM_DESCRIPTION),
    (DOV_PARAMETER_GROUP_ASTM_CLASSIFICATION, DOV_PARAMETER_BGGG_NORM),
    (DOV_PARAMETER_GROUP_ONDERKENNING_PROEVEN, DOV_PARAMETER_CALCAREOUS_CONTENT),
    (DOV_PARAMETER_GROUP_ONDERKENNING_PROEVEN, DOV_PARAMETER_ORGANIC_MATTER),
    (DOV_PARAMETER_GROUP_ONDERKENNING_PROEVEN, DOV_PARAMETER_CLAY_CONTENT_MB),
)
