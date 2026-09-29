"""Constants for the LOCAL DOV borehole XML file import (``DovBoringFileParser``).

A file saved from DOV (``dov-schema`` root) can carry one or several
``<boring>`` elements plus an ``<interpretaties>`` block holding EVERY
interpretation of every boring in it. The bbox import never sees that shape —
it fetches one boring and one interpretation per request — so the tags and
flag codes the file import needs live here, next to ``dov_constants.py``.
"""

from __future__ import annotations

from groundmodel.domain.value_objects.observation_type import ObservationType

# ----------------------------------------------------------------------
# Element names — verified on the owner's five files (2026-09-28)
# ----------------------------------------------------------------------

# <alternatieve_naam><naam>GEO-25/110-B1</naam><type>VO - Afdeling Geotechniek</type>
# The engineer knows the boring by this name (the VO survey number), not by the
# DOV identificatie ("1411-BORGEO2600011-21-04-2026-B1").
DOV_FILE_ALT_NAME_TAG = "alternatieve_naam"
DOV_FILE_ALT_NAME_NAME_TAG = "naam"
DOV_FILE_ALT_NAME_TYPE_TAG = "type"

# <dataidentifier><permkey>2026-244773</permkey> — on the boring AND on each
# interpretation stream element.
DOV_FILE_DATAIDENTIFIER_TAG = "dataidentifier"
DOV_FILE_PERMKEY_TAG = "permkey"

# <ligging><metadata_hoogtebepaling><methode>…</methode><betrouwbaarheid>…
# (elevation method + reliability) and <metadata_locatiebepaling> (position).
DOV_FILE_LOCATION_TAG = "ligging"
DOV_FILE_ELEVATION_META_TAG = "metadata_hoogtebepaling"
DOV_FILE_POSITION_META_TAG = "metadata_locatiebepaling"
DOV_FILE_METHOD_TAG = "methode"
DOV_FILE_RELIABILITY_TAG = "betrouwbaarheid"

# <boormeester><naam>Onbekend</naam> (drill master, surname).
DOV_FILE_DRILLMASTER_TAG = "boormeester"
DOV_FILE_NAME_TAG = "naam"

# <opmerking><tekst>…</tekst> (remark) and <bijlage><titel>…<url>…
# (attachment); both repeatable.
DOV_FILE_REMARK_TAG = "opmerking"
DOV_FILE_REMARK_TEXT_TAG = "tekst"
DOV_FILE_ATTACHMENT_TAG = "bijlage"
DOV_FILE_ATTACHMENT_TITLE_TAG = "titel"
DOV_FILE_ATTACHMENT_URL_TAG = "url"

# <details><aangenomengrondwaterstand><diepte_grondwater>7.00 — an ASSUMED
# groundwater depth. The boring parser reads only the measured
# <grondwaterstand>, so an assumed level is reported, never imported as the
# water table (it is an assumption, not a reading).
DOV_FILE_ASSUMED_GROUNDWATER_TAG = "aangenomengrondwaterstand"

# <diepte_van> — start depth of the boring; anything but 0 is worth a look.
DOV_FILE_START_DEPTH_TAG = "diepte_van"

# Each interpretation stream element names its boring by identificatie.
DOV_FILE_INTERP_BORING_TAG = "boring"

# Stream element tag → ObservationType. DOV derives the tag from the WFS layer
# name (underscores stripped, a trailing plural "en" dropped — see
# ``DOV_INTERP_WRAPPER_TAG`` in dov_constants). VERIFIED on real XML:
# lithologischebeschrijving, informelestratigrafie, formelestratigrafie (the
# owner's files) and gecodeerdelithologie (live 2026-05-08). The other four
# follow the same rule but no real file has shown them yet — an unmapped tag
# is reported as UNKNOWN_INTERPRETATION_STREAM, never silently dropped.
DOV_FILE_STREAM_TAGS: dict[str, ObservationType] = {
    "gecodeerdelithologie": ObservationType.CODED_LITHOLOGY,
    "geotechnischecodering": ObservationType.GEOTECHNICAL_CODING,
    "lithologischebeschrijving": ObservationType.LITHOLOGICAL_DESCRIPTION,
    "informelestratigrafie": ObservationType.INFORMAL_STRATIGRAPHY,
    "formelestratigrafie": ObservationType.FORMAL_STRATIGRAPHY,
    "quartairestratigrafie": ObservationType.QUATERNARY_STRATIGRAPHY,
    "hydrogeologischestratigrafie": ObservationType.HYDROGEOLOGICAL_STRATIGRAPHY,
    "informelehydrogeologischestratigrafie": (
        ObservationType.INFORMAL_HYDROGEOLOGICAL_STRATIGRAPHY
    ),
}

# Streams reported as STRATIGRAPHY_PRESENT (an interpretation the engineer may
# want to compare with his own geological picks).
DOV_FILE_STRATIGRAPHY_TYPES: frozenset[ObservationType] = frozenset(
    {
        ObservationType.FORMAL_STRATIGRAPHY,
        ObservationType.INFORMAL_STRATIGRAPHY,
        ObservationType.QUATERNARY_STRATIGRAPHY,
        ObservationType.HYDROGEOLOGICAL_STRATIGRAPHY,
        ObservationType.INFORMAL_HYDROGEOLOGICAL_STRATIGRAPHY,
    }
)

# ----------------------------------------------------------------------
# Source-vocabulary values the flags compare against (raw DOV tokens)
# ----------------------------------------------------------------------

# ``doel`` (purpose) of a boring made for a geotechnical investigation. Any
# other purpose (Geochemisch onderzoek, Grondwaterwinning, …) means the
# description was not written with geotechnical parameters in mind.
DOV_FILE_GEOTECHNICAL_PURPOSE = "Geotechnisch onderzoek"

# ``betrouwbaarheid`` (reliability) value that raises no flag; "onbekend"
# (unknown), "twijfelachtig" (doubtful), … all do.
DOV_FILE_GOOD_RELIABILITY = "goed"

# ``boormeester/naam`` DOV writes when the drill master is not known
# (compared case-insensitively).
DOV_FILE_UNKNOWN_DRILLMASTER = "onbekend"

# ----------------------------------------------------------------------
# Thresholds
# ----------------------------------------------------------------------

# Depth comparisons (diepte_tot vs deepest drill segment / description layer,
# layer-to-layer gaps). DOV writes depths with 2 decimals; 5 mm absorbs that
# rounding without hiding a real mismatch (the smallest real one seen, Smet,
# is 3 m).
DOV_FILE_DEPTH_TOLERANCE_M = 0.005

# A remark is quoted in its flag, whitespace collapsed, cut at this length so
# a long dossier note does not flood the flags panel.
DOV_FILE_REMARK_MAX_CHARS = 200

# At most this many gap / overlap intervals are listed in one
# LITHOLOGY_GAPS_OR_OVERLAPS message (the count is always given in full).
DOV_FILE_MAX_LISTED_GAPS = 5

# ----------------------------------------------------------------------
# Flag codes (ValidationIssue.code) — the "flag everything that is weird" set
# ----------------------------------------------------------------------

FLAG_FILE_HOLDS_MANY_BORINGS = "FILE_HOLDS_MANY_BORINGS"
FLAG_NAME_FROM_ALTERNATIVE = "NAME_FROM_ALTERNATIVE"
FLAG_NO_LITHOLOGICAL_DESCRIPTION = "NO_LITHOLOGICAL_DESCRIPTION"
FLAG_MULTIPLE_LITHOLOGICAL_DESCRIPTIONS = "MULTIPLE_LITHOLOGICAL_DESCRIPTIONS"
FLAG_STRATIGRAPHY_PRESENT = "STRATIGRAPHY_PRESENT"
FLAG_RELIABILITY_NOT_GOOD = "RELIABILITY_NOT_GOOD"
FLAG_ELEVATION_ZERO = "ELEVATION_ZERO"
FLAG_NO_FIELD_LOG = "NO_FIELD_LOG"
FLAG_DRILLMASTER_UNKNOWN = "DRILLMASTER_UNKNOWN"
FLAG_PURPOSE_NOT_GEOTECHNICAL = "PURPOSE_NOT_GEOTECHNICAL"
FLAG_REMARK_PRESENT = "REMARK_PRESENT"
FLAG_ATTACHMENT_PRESENT = "ATTACHMENT_PRESENT"
FLAG_DEPTH_MISMATCH = "DEPTH_MISMATCH"
FLAG_DATE_IN_FUTURE = "DATE_IN_FUTURE"
FLAG_GROUNDWATER_ASSUMED = "GROUNDWATER_ASSUMED"
FLAG_START_DEPTH_NOT_ZERO = "START_DEPTH_NOT_ZERO"
FLAG_LITHOLOGY_GAPS_OR_OVERLAPS = "LITHOLOGY_GAPS_OR_OVERLAPS"
FLAG_UNKNOWN_INTERPRETATION_STREAM = "UNKNOWN_INTERPRETATION_STREAM"
FLAG_INTERPRETATION_WITHOUT_BORING = "INTERPRETATION_WITHOUT_BORING"
