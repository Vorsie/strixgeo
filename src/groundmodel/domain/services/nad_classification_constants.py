"""Provisional NAD packing-class lookup: ``(soil, admixture-variant, qc) → class``.

⚠ PROVISIONAL VALUES — the production qc thresholds come from the owner's
``Correlaties uit S en NAD_NEN_v2.xlsx`` (Task T0). The STRUCTURE here is final;
only the numbers get swapped. Classification is on RAW qc (MPa), no Dr, no σ′v
(spec §5).

A variant is ``"clean"`` or ``"secondary"``. ``"secondary"`` means the soil
carries its single admixture variant that the NAD table defines:
sand → silt-/kleihoudend, silt/clay → zandhoudend. Any other admixture (e.g.
gravelly sand) is NOT a NAD variant and falls to ``"clean"`` (spec §5, exact
matching). Gravel uses clean/secondary too (silt-/kleihoudend).
"""

from __future__ import annotations

from typing import Literal

from groundmodel.shared.constants.litho_constants import BaseLithology

Variant = Literal["clean", "secondary"]

# Each entry: ascending list of (qc_upper_bound_mpa, nad_class). The classifier
# picks the first band whose upper bound is >= qc; qc above the last band → that
# last (densest) class; qc below the first → that first (loosest) class
# (nearest-class fallback, spec §5). ``None`` upper bound = open-topped (densest).
NAD_QC_BANDS: dict[tuple[BaseLithology, Variant], list[tuple[float | None, int]]] = {
    # GRIND (provisional)
    ("GRIND", "clean"): [(10.0, 1), (None, 2)],
    ("GRIND", "secondary"): [(10.0, 3), (None, 4)],
    # ZAND: los<5 / matig 5-10 / dicht 10-15 / zeer dicht >15 (provisional, memory)
    ("ZAND", "clean"): [(5.0, 5), (10.0, 6), (15.0, 7), (None, 8)],
    ("ZAND", "secondary"): [(5.0, 9), (10.0, 10), (15.0, 11), (None, 12)],
    # SILT: weinig/matig/vrij/vast (provisional)
    ("SILT", "clean"): [(1.0, 13), (2.0, 14), (4.0, 15), (None, 16)],
    ("SILT", "secondary"): [(1.0, 17), (2.0, 18), (4.0, 19), (None, 20)],
    # KLEI (provisional)
    ("KLEI", "clean"): [(0.5, 21), (1.0, 22), (2.0, 23), (None, 24)],
    ("KLEI", "secondary"): [(0.5, 25), (1.0, 26), (2.0, 27), (None, 28)],
    # VEEN: qc-based peat packing is weak; provisional single-band default.
    # The NAD table defines NO "zandhoudend veen" secondary variant, so the
    # secondary row intentionally mirrors clean (a sandy-peat admixture does not
    # change the class) rather than being a copy-paste stub.
    ("VEEN", "clean"): [(0.3, 29), (0.6, 30), (None, 31)],
    ("VEEN", "secondary"): [(0.3, 29), (0.6, 30), (None, 31)],
}

# Which admixture soil_codes map to the "secondary" NAD variant per main soil
# (spec §5, exact matching). Codes are DOV hoofdnaam/bijmenging grondsoort codes
# from ``codetabel_hoofdnaam.csv`` (same codelist for both main and admixture
# grondsoort elements). Sand/gravel take silt ("SI") OR clay ("KL"); silt/clay/peat
# take sand ("XZ"). Anything else → "clean".
# Verified against litho_segmentation_constants.py DOV_HOOFDNAAM_TO_LITHOLOGY and
# codetabel_hoofdnaam.csv: SI=silt, KL=klei, XZ=zand (generic). Leem ("LE") and
# slib ("SL") are silt-class soils but the NAD table only specifies "silt-/
# kleihoudend" as the named secondary variant; exact-match policy (spec §5)
# means only the direct silt code qualifies until the owner's xlsx confirms
# whether LE/SL should also trigger "secondary". TODO Task T0: verify LE/SL.
_SECONDARY_ADMIXTURE_CODES: dict[BaseLithology, frozenset[str]] = {
    "GRIND": frozenset({"SI", "KL"}),
    "ZAND": frozenset({"SI", "KL"}),
    "SILT": frozenset({"XZ"}),
    "KLEI": frozenset({"XZ"}),
    "VEEN": frozenset({"XZ"}),
}
