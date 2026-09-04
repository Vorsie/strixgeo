"""Belgian lithology + NAD geotechnical-class reference codelist.

Curated reference data (NOT ingested upstream data — the data-integrity
"store raw upstream tokens" rule does not apply here). Source: the
NAD table of NBN EN 1997-1 ANB (the Belgian national annex to Eurocode 7, table 2.1),
transcribed from a working sheet that has data-entry artefacts ("KLEi", double
spaces, inconsistent "zandh.,"/"zandh,"); those are normalised here
because these strings are shown to engineers and round-tripped — the
NAD **class number** (1..31, == ``laagnr``) is the stable key, the
name is presentation.

Used by the formation-codelist endpoint (api), the CPT/borehole
segmenter (domain) and the litho suggestion schema (api). Because it
is consumed across layers — and the API layer must not import from the
domain layer — it lives in ``shared/constants/`` rather than next to
the segmenter service (debt #54, layer purity). ``shared/`` is the
explicitly cross-layer-permitted home; this overrides the local
"constants alongside the classes that use them" rule for the
cross-layer case.
"""

from __future__ import annotations

from typing import Literal

# ---------------------------------------------------------------------------
# Base lithology — the ``Grondsoort`` axis (≤ String(20), fits the
# geological_formation.lithology column). Admixture / packing-density
# are NOT folded into this token (kept as separate axes — admixture
# becomes a stored field only when the segmenter needs it; do not
# pre-design it).
# ---------------------------------------------------------------------------

BaseLithology = Literal["GRIND", "ZAND", "SILT", "KLEI", "VEEN"]

#: value → (Dutch label, English label). Order = coarse→fine→organic.
BASE_LITHOLOGIES: dict[BaseLithology, tuple[str, str]] = {
    "GRIND": ("Grind", "Gravel"),
    "ZAND": ("Zand", "Sand"),
    "SILT": ("Silt", "Silt"),
    "KLEI": ("Klei", "Clay"),
    "VEEN": ("Veen", "Peat"),
}

#: Base-lithology → display colour (SVG/CSS hex). Single source of truth
#: shared with the frontend ``lithoConstants.ts`` LITHOLOGY_COLORS table —
#: the two MUST stay byte-identical so a stored formation colour matches
#: what the ghost-suggestion overlay rendered before it was accepted.
#: Stamped onto ``geological_formation.color`` at litho-formation create
#: (``accept_litho_suggestions._create_litho_formation``) so the DB row is
#: correct for every read-side consumer (section bands, 3D viewer, exports,
#: .gmproj bundle) without a presentation-layer override.
LITHOLOGY_COLORS: dict[str, str] = {
    "GRIND": "#d97706",  # amber / orange-brown — gravel
    "ZAND": "#fbbf24",  # yellow — sand
    "SILT": "#84cc16",  # lime-green — silt
    "KLEI": "#6b7280",  # blue-grey — clay
    "VEEN": "#92400e",  # dark brown — peat
}

#: Fallback colour for an unrecognised lithology token (neutral grey).
#: A litho formation whose ``litho_main_soil_code`` is not one of the five
#: base lithologies falls back to this rather than carrying no colour.
LITHOLOGY_FALLBACK_COLOR = "#9ca3af"

#: Admixture qualifiers (the ``bijmenging`` axis) — informational
#: suggestions for the editor; not a stored field in v1.
ADMIXTURE_QUALIFIERS: tuple[str, ...] = (
    "silt-/kleihoudend",  # silty/clayey admixture
    "zandhoudend",  # sandy admixture
)

#: Density state for SAND (the packing-density / NAD axis) and the
#: consistency state for fines — kept for the segmenter (slice 3).
SAND_PACKING_STATES: tuple[str, ...] = (
    "los",
    "matig",
    "dicht",
    "zeer dicht",
)
FINE_CONSISTENCY_STATES: tuple[str, ...] = (
    "weinig vast",
    "matig vast",
    "vrij vast",
    "vast",
)

# ---------------------------------------------------------------------------
# NAD geotechnical classes — the 31 ``laagnr NAD-NEN`` rows. The class
# number is the stable key (Phase-5 parameter join key into the NAD-NEN
# parameter sheet); names normalised from the source artefacts.
# ---------------------------------------------------------------------------

#: NAD class number (1..31) → (canonical name, base lithology).
NAD_CLASSES: dict[int, tuple[str, BaseLithology]] = {
    1: ("GRIND, matig gp", "GRIND"),
    2: ("GRIND, dicht gp", "GRIND"),
    3: ("GRIND, silt-/kleihoudend, matig gp", "GRIND"),
    4: ("GRIND, silt- of kleihoudend, dicht gp", "GRIND"),
    5: ("ZAND, los gp", "ZAND"),
    6: ("ZAND, matig gp", "ZAND"),
    7: ("ZAND, dicht gp", "ZAND"),
    8: ("ZAND, zeer dicht gp", "ZAND"),
    9: ("ZAND, silt-/kleihoudend, los gp", "ZAND"),
    10: ("ZAND, silt-/kleihoudend, matig gp", "ZAND"),
    11: ("ZAND, silt-/kleihoudend, dicht gp", "ZAND"),
    12: ("ZAND, silt-/kleihoudend, zeer dicht gp", "ZAND"),
    13: ("SILT, weinig vast", "SILT"),
    14: ("SILT, matig vast", "SILT"),
    15: ("SILT, vrij vast", "SILT"),
    16: ("SILT, vast", "SILT"),
    17: ("SILT, zandhoudend, weinig vast", "SILT"),
    18: ("SILT, zandhoudend, matig vast", "SILT"),
    19: ("SILT, zandhoudend, vrij vast", "SILT"),
    20: ("SILT, zandhoudend, vast", "SILT"),
    21: ("KLEI, weinig vast", "KLEI"),
    22: ("KLEI, matig vast", "KLEI"),
    23: ("KLEI, vrij vast", "KLEI"),
    24: ("KLEI, vast", "KLEI"),
    25: ("KLEI, zandhoudend, weinig vast", "KLEI"),
    26: ("KLEI, zandhoudend, matig vast", "KLEI"),
    27: ("KLEI, zandhoudend, vrij vast", "KLEI"),
    28: ("KLEI, zandhoudend, vast", "KLEI"),
    29: ("VEEN, weinig vast", "VEEN"),
    30: ("VEEN, matig vast", "VEEN"),
    31: ("VEEN, vast", "VEEN"),
}

#: Lowest / highest valid NAD class — mirrors the Pydantic ge/le bound
#: on ``GeologicalFormation*.nad_class`` so the two never drift.
NAD_CLASS_MIN = 1
NAD_CLASS_MAX = 31
