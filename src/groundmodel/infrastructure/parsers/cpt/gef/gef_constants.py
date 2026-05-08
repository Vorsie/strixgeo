"""GEF-CPT parser constants — quantity mappings, unit conversions, MEASUREMENTVAR indices."""

# GEF quantity number → standard column name
QUANTITY_TO_COLUMN: dict[int, str] = {
    1: "depth_m",
    2: "qc_mpa",
    3: "fs_mpa",
    4: "rf_pct",
    5: "u1_mpa",
    6: "u2_mpa",
    7: "u3_mpa",
    8: "inclination_deg",
    9: "inclination_ns_deg",
    10: "inclination_ew_deg",
    11: "length_m",  # penetration length — needs inclination correction for true depth
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

# #MEASUREMENTVAR indices (GEF-CPT-Report standard)
MVAR_NET_AREA_RATIO = 3  # Net surface area quotient of cone tip (a-value)
MVAR_CONE_TYPE = 12  # 0 = electric, 1 = mechanical
MVAR_PRE_DRILL = 13  # DIEPTE PUT — pit/pre-drill depth
MVAR_WATER_DEPTH = 14  # DIEPTE GRONDWATER — groundwater depth
MVAR_STOP_CRITERION = 17  # Stop criteria
