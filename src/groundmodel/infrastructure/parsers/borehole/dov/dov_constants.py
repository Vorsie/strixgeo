"""DOV borehole parser constants.

Shared DOV-domain constants (WFS URL, namespaces, coordinate transformer,
permkey regex, parallelism) live in ``infrastructure/parsers/dov/dov_common.py``
and are re-exported below so importers can pull everything they need from this
single module without crossing into the CPT side of the tree.

Borehole-specific constants (Boringen WFS layer, interpretation layer name
map, boring URL prefix for the cache trick) are defined locally below.

References:
* DOV WFS endpoint discovered at https://www.dov.vlaanderen.be/geoserver/ows
* Schema verified live 2026-05-08 — see the ``reference_dov_endpoints`` and
  ``reference_dov_codelists`` memory files for the cross-cutting layout.
"""

from __future__ import annotations

from groundmodel.domain.value_objects.field_log_kind import FieldLogKind
from groundmodel.domain.value_objects.observation_type import ObservationType

# Re-export shared DOV primitives for ergonomic single-module imports.
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
# Borehole — WFS layers
# ----------------------------------------------------------------------

# Boringen layer — verified via GetCapabilities. ``dov-pub:Boring`` (singular)
# is not advertised; the plural form is canonical.
DOV_WFS_BORINGEN_LAYER = "dov-pub:Boringen"

# Grondmonsters (soil samples) — used in Phase C for the sample WFS query.
# One row per sample with depth interval, sample type, instrument, and a link
# to the per-sample monster XML.
DOV_WFS_GRONDMONSTERS_LAYER = "boringen:grondmonsters"

# All eight DOV interpretation layers, keyed by the matching ObservationType
# enum value so an orchestrator that has the type can fetch the right layer
# without a separate lookup. Each layer has its own per-feature XML at
# ``/data/interpretatie/{permkey}.xml``; the WFS row only carries the
# borehole reference and quality metadata.
DOV_WFS_INTERPRETATION_LAYERS: dict[ObservationType, str] = {
    ObservationType.CODED_LITHOLOGY: "interpretaties:gecodeerde_lithologie",
    ObservationType.GEOTECHNICAL_CODING: "interpretaties:geotechnische_coderingen",
    ObservationType.LITHOLOGICAL_DESCRIPTION: "interpretaties:lithologische_beschrijvingen",
    ObservationType.INFORMAL_STRATIGRAPHY: "interpretaties:informele_stratigrafie",
    ObservationType.FORMAL_STRATIGRAPHY: "interpretaties:formele_stratigrafie",
    ObservationType.QUATERNARY_STRATIGRAPHY: "interpretaties:quartaire_stratigrafie",
    ObservationType.HYDROGEOLOGICAL_STRATIGRAPHY: ("interpretaties:hydrogeologische_stratigrafie"),
    ObservationType.INFORMAL_HYDROGEOLOGICAL_STRATIGRAPHY: (
        "interpretaties:informele_hydrogeologische_stratigrafie"
    ),
}


# ----------------------------------------------------------------------
# Borehole — XML download URL prefixes (Phase C orchestration uses these)
# ----------------------------------------------------------------------

# Per-borehole XML at ``/data/boring/{permkey}.xml``. Same proxy 302-redirect
# trick as for sonderings — hitting the proxy directly cuts every download
# from 2 round-trips to 1.
DOV_BORING_URL_PREFIX = "/data/boring/"
DOV_BORING_PROXY_URL_PREFIX = "/xdov/proxy/export/boring/"

# Per-interpretation XML.
DOV_INTERPRETATION_URL_PREFIX = "/data/interpretatie/"
DOV_INTERPRETATION_PROXY_URL_PREFIX = "/xdov/proxy/export/interpretatie/"


# ----------------------------------------------------------------------
# Boring XML — element names and field-log discriminators
# ----------------------------------------------------------------------

# Top-level <boring> child elements we extract directly.
DOV_BORING_NAME_TAG = "identificatie"  # human-readable bore number
DOV_BORING_PERMKEY_TAG = "permkey"  # under <dataidentifier>
DOV_BORING_LOCATION_TAG = "ligging"  # contains <gml:Point>
DOV_BORING_MUNICIPALITY_TAG = "gemeente"  # NIS code OR name
DOV_BORING_TOTAL_DEPTH_TAG = "diepte_tot"
DOV_BORING_START_DATE_TAG = "datum_aanvang"
DOV_BORING_PURPOSE_TAG = "doel"
DOV_BORING_TYPE_TAG = "boringtype"
DOV_BORING_EXECUTOR_PARENT_TAG = "uitvoerder"  # nested <naam>
DOV_BORING_DETAILS_TAG = "details"  # parent of drill segments + field log
DOV_BORING_GROUNDWATER_TAG = "grondwaterstand"  # nested <diepte_grondwater>
DOV_BORING_GROUNDWATER_DEPTH_TAG = "diepte_grondwater"

# Inside <details>: drill segments — one element per interval drilled with one
# technique. Repeated. The inner <methode> string is the source-vocabulary
# token (DOV: "spade", "edelmanboring", "kerboor", ...).
DOV_BORING_DRILL_SEGMENT_TAG = "boormethode"
DOV_BORING_DRILL_METHOD_TAG = "methode"

# Inside <details>: field-log interval elements. Each is a depth-keyed
# observation made by the driller; we map the XML tag to the corresponding
# FieldLogKind enum value. The inner element holding the value carries the
# same name as the wrapper — DOV's schema is repetitive — so the value tag
# matches the kind tag (e.g. <kleur><kleur>groenbruin</kleur></kleur>).
DOV_BORING_FIELD_LOG_TAGS: dict[str, FieldLogKind] = {
    "kleur": FieldLogKind.COLOR,
    "vochtgehalte": FieldLogKind.MOISTURE,
    "consistentie": FieldLogKind.CONSISTENCY,
}

# Common interval-element child tags — top, base, name (used by drill segments
# and every field-log kind in DOV's schema).
DOV_BORING_VAN_TAG = "van"
DOV_BORING_TOT_TAG = "tot"


# ----------------------------------------------------------------------
# Interpretation XML — element names (Phase B2)
# ----------------------------------------------------------------------

# The interpretation XML's outer wrapper. Inside it sits exactly one element
# whose tag matches the WFS layer (with underscores stripped and trailing
# 'en' dropped — e.g. ``gecodeerdelithologie``, ``formelestratigrafie``,
# ``lithologischebeschrijving``). The parser doesn't depend on knowing that
# inner tag — it grabs the first element child.
DOV_INTERP_WRAPPER_TAG = "interpretaties"

# Interpretation header children — same names across all eight stream types.
DOV_INTERP_BORING_TAG = "boring"  # source-side identificatie of the parent borehole
DOV_INTERP_PERMKEY_PARENT_TAG = "dataidentifier"
DOV_INTERP_AUTHOR_PARENT_TAG = (
    "auteur"  # nested <persoon><naam>+<voornaam> + <bedrijf-dienst><naam>
)
DOV_INTERP_DATE_TAG = "datum"
DOV_INTERP_RELIABILITY_TAG = "betrouwbaarheid"
DOV_INTERP_QUALITY_PARENT_TAG = "kwaliteit"  # nested <categorie> + <geschiktheid_boormethode>
DOV_INTERP_QUALITY_CATEGORY_TAG = "categorie"
DOV_INTERP_QUALITY_DRILL_METHOD_TAG = "geschiktheid_boormethode"

# Layer (laag) element name — same across all stream types.
DOV_INTERP_LAYER_TAG = "laag"

# Layer child elements — three sub-shapes share the row.
# Lithology shape (gecodeerde_lithologie, geotechnische_codering):
DOV_INTERP_LAYER_COLOR_TAG = "kleur"
DOV_INTERP_LAYER_MAIN_SOIL_PARENT_TAG = "hoofdnaam"  # repeats for equally-dominant soils
DOV_INTERP_LAYER_MAIN_SOIL_CODE_TAG = "grondsoort"  # inside <hoofdnaam>
DOV_INTERP_LAYER_ADMIXTURE_TAG = "bijmenging"  # repeats; nested fields below
DOV_INTERP_ADMIXTURE_LOCALLY_TAG = "plaatselijk"
DOV_INTERP_ADMIXTURE_AMOUNT_TAG = "hoeveelheid"
DOV_INTERP_ADMIXTURE_SOIL_CODE_TAG = "grondsoort"

# Free-text shape (lithologische_beschrijving):
DOV_INTERP_LAYER_DESCRIPTION_TAG = "beschrijving"

# Stratigraphy shape (formele/informele/quartaire/hydrogeologische):
# Two formation-member codes plus an optional relation between them. The
# parser folds these into a single description string ("Q-T-Q" or just "Q")
# because the domain ObservationLayer has one description field; the codes
# also land in main_soil_codes for queryability.
DOV_INTERP_LAYER_LID1_TAG = "lid1"
DOV_INTERP_LAYER_LID2_TAG = "lid2"
DOV_INTERP_LAYER_LID_RELATION_TAG = "relatie_lid1_lid2"
