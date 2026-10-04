"""GEF-CPT parser constants — quantity mappings, unit conversions, MEASUREMENTVAR indices."""

# GEF quantity number → standard column name
#
# qty 1 vs qty 11 — the distinction that decides how deep every layer sits:
#   qty 1  = sondeerlengte  (penetration length) — length of rod pushed in,
#            measured ALONG the rod, so it includes the deviation from vertical.
#   qty 11 = gecorrigeerde diepte (corrected depth) — vertical depth below
#            ground level after the inclination correction.
# The corrected depth is therefore always ≤ the penetration length. A real
# DOV file states it in its own header — ``#COLUMNINFO= 1, m, Lengte, 1``
# next to ``#COLUMNINFO= 5, m, Diepte, 11`` — and its last row reads
# 20.22 (Lengte) against 20.212 (Diepte).
QUANTITY_TO_COLUMN: dict[int, str] = {
    1: "length_m",  # penetration length — needs inclination correction for true depth
    2: "qc_mpa",
    3: "fs_mpa",
    4: "rf_pct",
    5: "u1_mpa",
    6: "u2_mpa",
    7: "u3_mpa",
    8: "inclination_deg",
    9: "inclination_ns_deg",
    10: "inclination_ew_deg",
    11: "depth_m",  # inclination-corrected vertical depth below ground level
    # qty 15 = corrected cone resistance (CPTU only). Robertson definition:
    # qt = qc + u2·(1 - a). Some piezocone software emits this directly; otherwise
    # downstream code derives it from qc + u2 + net area ratio.
    15: "qt_mpa",
    16: "qn_mpa",
    # qty 128 = total resistance (GEF: totaalweerstand) in kN — Belgian CPTM /
    # Begemann mechanical cone. Physically distinct from qty 15: a mechanical
    # cone cannot separate tip and sleeve forces, so q_total measures the
    # combined reading directly. For the standard 1000 mm² cone:
    # q_total[MPa] = q_total[kN] / 0.001 m² × 0.001 = q_total[kN] numerically.
    128: "q_total_mpa",
    17: "bq",
    99: "time_s",
}

# Conversion factors to MPa
UNIT_TO_MPA: dict[str, float] = {
    "mpa": 1.0,
    "n/mm2": 1.0,
    "kpa": 0.001,
    "kn/m2": 0.001,
    "pa": 1e-6,
    "bar": 0.1,
    "tf/m2": 0.009807,
    "kgf/cm2": 0.098067,
}

PRESSURE_COLUMNS: frozenset[str] = frozenset(
    {
        "qc_mpa",
        "fs_mpa",
        "u1_mpa",
        "u2_mpa",
        "u3_mpa",
        "qt_mpa",
        "q_total_mpa",
        "qn_mpa",
    }
)

# ---------------------------------------------------------------------------
# Coordinate-system codes
# ---------------------------------------------------------------------------
# The number in ``#XYID=`` / ``#ZID=`` is a **GEF codelist code**, not an EPSG
# code. They look like EPSG codes and are five digits, which is exactly why
# they used to be stored verbatim as one — a row tagged 32000 then means
# nothing to PostGIS, proj4, or any EPSG-keyed lookup in this codebase.
#
# Horizontal (``#XYID``):
#   31000 → 28992  Rijksdriehoeksmeting (RD New, NL national grid)
#   32000 → 31370  Belgian Lambert 72 (every DOV-exported GEF; verified against
#                  data/cpt/*.gef, whose 32000-tagged coordinates land in
#                  Flanders when read as Lambert 72)
GEF_XY_CODE_TO_EPSG: dict[int, int] = {
    31000: 28992,
    32000: 31370,
}

# Vertical (``#ZID``):
#   32001 → 5710   mTAW (Tweede Algemene Waterpassing, BE) — matches the
#                  vertical EPSG the DOV XML import path stamps for the same
#                  physical soundings.
#
# The Dutch vertical code is deliberately ABSENT until a real BRO/DINO GEF is
# in hand to verify it against. Same stance as ``codelists/vertical_crs.py``:
# a wrong datum silently mislabels every elevation, a missing one only falls
# back to a bare "m".
GEF_Z_CODE_TO_EPSG: dict[int, int] = {
    32001: 5710,
}

# Data-block separators when the file declares none.
#
# ``#COLUMNSEPARATOR=`` and ``#RECORDSEPARATOR=`` are optional; without them
# the historic behaviour applies — values split on semicolons and/or runs of
# whitespace, and nothing terminates the record beyond the newline.
DEFAULT_COLUMN_SEPARATORS: frozenset[str] = frozenset({";"})

# Characters that may occur INSIDE a number and can therefore never act as a
# column separator. Splitting on '-' would turn the void value -9999.0 into
# +9999.0 — a sign flip that no validation check downstream would catch. A
# declared separator drawn from this set is refused rather than honoured.
NUMERIC_CHARACTERS: frozenset[str] = frozenset("0123456789.-+eE")

# Upper bound on the column count a ``#COLUMN=`` header may declare before the
# parse is refused. Justified from the format, not taste: the GEF-CPT-Report
# quantity codelist tops out around 128 (see QUANTITY_TO_COLUMN), a real CPT
# carries ~3–16 channels, and even the richest multi-sensor GEF (seismic CPT,
# geophysical logs, borehole grain-size) stays well under 100 columns — every
# declared column also requires its own ``#COLUMNINFO=`` header line. 512 is
# ~30× the richest realistic file, so it never bites legitimate data, while it
# caps the padded-frame allocation: a hostile ~200-byte file declaring
# ``#COLUMN= 1000000000`` would otherwise drive a tens-of-GB allocation (one
# ``None`` per declared column per row) and OOM the backend.
MAX_GEF_COLUMNS = 512

# #MEASUREMENTVAR indices (GEF-CPT-Report standard)
MVAR_NET_AREA_RATIO = 3  # Net surface area quotient of cone tip (a-value)
MVAR_CONE_TYPE = 12  # 0 = electric, 1 = mechanical
MVAR_PRE_DRILL = 13  # DIEPTE PUT — pit/pre-drill depth
MVAR_WATER_DEPTH = 14  # DIEPTE GRONDWATER — groundwater depth
MVAR_STOP_CRITERION = 17  # Stop criteria

# A declared pre-drill (MVAR 13) is read as NOT APPLIED to the depth column
# when the first stored depth lies more than this above it. 5 cm absorbs the
# one- or two-sample offset a rig writes between the pit bottom and its first
# reading (2 cm scan grain on the 23.15 campaign), while the case that started
# this check — 0.35 m declared, data from 0.02 m (camz-001 soundings 39/42) —
# is 33 cm off and far outside it.
PRE_DRILL_APPLIED_TOLERANCE_M = 0.05
