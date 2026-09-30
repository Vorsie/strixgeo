"""Constants for the raw lab-series import (channel metadata, lab-reported labels).

Channel metadata is ``canonical key → (lab label, unit, provenance)``. The
lab label is the export's own column heading, verbatim (Dutch), so the viewer
can show it as the raw token next to the English presentation label (docs/ux.md
"translate at the presentation boundary").
"""

from groundmodel.domain.models.lab.series_provenance import SeriesProvenance
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_constants import (
    LAB_EXPORT_FORMAT_OED_LISTING,
    LAB_EXPORT_FORMAT_OED_NEW_RAW,
)

# Stage kinds (``lab_series_stage.stage_kind``).
STAGE_KIND_LOAD_STEP = "load_step"
STAGE_KIND_SHEAR = "shear"

_MEASURED = SeriesProvenance.MEASURED.value
_LAB_DERIVED = SeriesProvenance.LAB_DERIVED.value

# Oedometer reading columns per export: key → (lab label, unit, provenance).
# The settlement columns are the gauge displacement in mm as the lab listed
# it; the listing's settlement bridges a dial re-zero (the dial column does
# not), which is why both are kept.
OED_CHANNELS: dict[str, dict[str, tuple[str, str, str]]] = {
    LAB_EXPORT_FORMAT_OED_LISTING: {
        "elapsed_min": ("Tijd", "min", _MEASURED),
        # The listing's dial is in gauge units (coefficient in the header).
        "dial_reading": ("Afgelezen verplaatsing", "gauge unit", _MEASURED),
        "settlement_mm": ("Zetting", "mm", _MEASURED),
        "total_settlement_mm": ("Totale zetting", "mm", _MEASURED),
    },
    LAB_EXPORT_FORMAT_OED_NEW_RAW: {
        "elapsed_min": ("tijd sinds begin trap (min)", "min", _MEASURED),
        "dial_reading": ("meetwaarde meetklok (mm)", "mm", _MEASURED),
        "settlement_mm": ("vervorming sinds begin van de trap (mm)", "mm", _MEASURED),
        "total_settlement_mm": ("vervorming sinds begin van de proef (mm)", "mm", _MEASURED),
        "load_kg": ("belasting (kg)", "kg", _MEASURED),
        "elapsed_stage_s": ("tijd sinds begin trap (s)", "s", _MEASURED),
        "elapsed_test_s": ("tijd sinds begin proef (s)", "s", _MEASURED),
    },
}

# The oedometer lab summary table: field of OedometerLabSummaryRow →
# (the lab's column heading verbatim, unit). Stored as lab-reported rows.
OED_LAB_SUMMARY_FIELDS: tuple[tuple[str, str, str], ...] = (
    ("stress_kpa", "Druk", "kPa"),
    ("settlement_mm", "Dhi", "mm"),
    ("height_mm", "h", "mm"),
    ("dry_density_t_m3", "volumemassa droog", "t/m³"),
    ("void_ratio", "e", "-"),
    ("lab_coefficient", "C (A)", "-"),
    ("av_per_mpa", "av", "1/MPa"),
    ("mv_per_mpa", "mv", "1/MPa"),
    ("compression_index", "Cc", "-"),
)

# Triaxial channel units by canonical key (the dump's header carries no units;
# these are the units the lab's triaxial module writes, per the listings).
TX_CHANNEL_UNITS: dict[str, str] = {
    "force_n": "N",
    "displacement_um": "µm",
    "cell_pressure_kpa": "kPa",
    "pore_pressure_kpa": "kPa",
    "volume_change_cm3": "cm³",
    "axial_strain_pct": "%",
    "deviator_stress_kpa": "kPa",
    "sigma3_eff_kpa": "kPa",
    "sigma1_eff_kpa": "kPa",
    "eff_stress_ratio": "-",
    "sigma3_total_kpa": "kPa",
    "sigma1_total_kpa": "kPa",
    "total_stress_ratio": "-",
}
# A column the parser could not classify is kept, keyed by its label under
# this prefix, as lab-derived (never promoted to a measurement on a guess).
TX_UNCLASSIFIED_KEY_PREFIX = "raw:"
TX_UNCLASSIFIED_PROVENANCE = _LAB_DERIVED

# Triaxial specimen rows that are the LAB's statements (lab-reported): the
# before / after table ("Gegevens voor de proef / na de proef") and single
# values. Labels verbatim as the dump writes them.
TX_BEFORE_AFTER_HEADER_LABEL = "Gegevens"  # its cells name the two phases
TX_BEFORE_AFTER_LABELS: tuple[str, ...] = (
    "Dwarsdoorsnede",  # cross-section area
    "Volume",
    "Watergehalte",  # water content
    "Volumemassa nat",  # wet density
    "Volumemassa droog",  # dry density
    "Poriënvolume",  # porosity
    "Verzadigingsgraad",  # degree of saturation
)
TX_SINGLE_TEXT_LABELS: tuple[str, ...] = ("Type breuk / Afschuifhoek",)
# When the dump's "Gegevens" header row is missing, the phases are named by
# the lab's usual words (the dump always writes them in this order).
TX_DEFAULT_PHASES: tuple[str, str] = ("voor de proef", "na de proef")

# Upload guard: the largest real export is ~810 KB (tx_cd); 50 MiB is far
# past any lab file and still streams through tempfile without memory risk.
LAB_SERIES_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
LAB_SERIES_UPLOAD_SUFFIXES: frozenset[str] = frozenset({".txt", ".csv", ".dat"})
