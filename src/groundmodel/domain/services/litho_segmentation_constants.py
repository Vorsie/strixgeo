"""Lookup dictionaries for the lithostratigraphic CPT + borehole segmenter.

Kept in a sibling module so Phase-5 tuning (adjusting Robertson zone →
lithology assignments, extending the DOV hoofdnaam codelist) does not
require opening the algorithm body. Both dicts are Phase-5 tuning
targets per docs/debt.md #117.
"""

from groundmodel.shared.constants.litho_constants import BaseLithology

# ---------------------------------------------------------------------------
# Robertson SBT zone → base lithology
# ---------------------------------------------------------------------------
# Geotech judgement call (per project spec): GRIND is NOT CPT-resolvable —
# the standard Robertson chart does not distinguish gravel reliably from
# dense sand. Zone 7 ("Gravelly sand to dense sand") maps to ZAND here;
# GRIND is confirmed only from borehole observation. This map is tunable.
ROBERTSON_ST_TO_LITHOLOGY: dict[int, BaseLithology] = {
    1: "KLEI",  # Sensitive fine-grained
    2: "VEEN",  # Organic soil / clay → peat (most common Belgian organic)
    3: "KLEI",  # Clay to silty clay
    4: "SILT",  # Clayey silt to silty clay
    5: "SILT",  # Silty sand to sandy silt
    6: "ZAND",  # Clean sand to silty sand
    7: "ZAND",  # Gravelly sand to dense sand (GRIND not CPT-resolvable)
    8: "ZAND",  # Stiff sand to clayey sand (very stiff OC)
    9: "KLEI",  # Stiff fine-grained (very stiff OC clay/silt)
}

# ---------------------------------------------------------------------------
# DOV hoofdnaam code → base lithology
# Source: codetabel_hoofdnaam.csv (infrastructure/codelists/data/).
# All codes that map unambiguously to a Belgian lithology are listed below;
# codes for rock types, construction materials, and unknowns fall through to
# ``None`` (the segmenter skips those layers or treats them as ``KLEI``
# conservatively, logged as unknown).
# ---------------------------------------------------------------------------
DOV_HOOFDNAAM_TO_LITHOLOGY: dict[str, BaseLithology | None] = {
    # Zand (sand) — both coarse and fine grain codes
    "XZ": "ZAND",  # zand (generic)
    "FZ": "ZAND",  # fijn zand
    "MZ": "ZAND",  # middelmatig zand
    "GZ": "ZAND",  # grof zand
    "ZL": "ZAND",  # zandleem (sand-dominant)
    # Grind (gravel)
    "XG": "GRIND",  # grind (generic)
    "FG": "GRIND",  # fijn grind
    "MG": "GRIND",  # middelmatig grind
    "GG": "GRIND",  # grof grind
    # Silt
    "SI": "SILT",  # silt
    "LE": "SILT",  # leem (loam — Belgian usage: silt-dominant)
    "ME": "SILT",  # mergel (marl — predominantly silt/clay, map conservatively)
    "SL": "SILT",  # slib (estuarine mud, silt-dominant)
    # Klei (clay)
    "KL": "KLEI",  # klei
    "GL": None,  # glauconiet — mineralogy, not a lithology; leave as None
    # Veen (peat) and organic material
    "VE": "VEEN",  # veen (peat)
    "HU": "VEEN",  # humus (organic horizon → peat class)
    "OM": "VEEN",  # organisch materiaal
    "LG": "VEEN",  # ligniet (sub-fossil peat)
    "PL": "VEEN",  # plantenresten (plant remains)
    # Rock and construction — not a soil lithology; map to None
    "KS": None,  # kalksteen
    "DL": None,  # dolomiet
    "GE": None,  # graniet
    "ZS": None,  # zandsteen
    "LS": None,  # leisteen
    "KW": None,  # kwartsiet
    "MA": None,  # marmer
    "BA": None,  # basalt
    "BT": None,  # beton
    "BK": None,  # baksteen
    "AT": None,  # asfalt
    "PU": None,  # puin
    "ST": None,  # stenen
    "XX": None,  # onbekend
    "RO": None,  # rots
    "RV": None,  # verweerde rots
    "GA": None,  # geroerd/gestoord
    # Shells — not a primary lithology
    "SC": None,  # schelpen
    "SF": None,  # schelpfragmenten
    "SG": None,  # schelpgruis
}
