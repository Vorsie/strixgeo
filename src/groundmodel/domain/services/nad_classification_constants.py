"""NAD packing-class lookup: ``(soil, admixture-variant, qc) → class 1–31``.

Production thresholds ported from the NAD table of NEN 9997-1 (the Dutch
national annex to Eurocode 7, table 2.b), as tabulated on page 2 of ``NO26043_BepalingTabelGrond­
karakteristieken_v1.0``. Each class's tabulated qc is the LOWER bound of its
packing band; the band's upper bound is the next (denser) class's qc, so e.g.
``ZAND, matig gp`` is ``4 ≤ qc < 10`` and ``zeer dicht`` is ``qc ≥ 15`` (the
``>`` marker in the sheet). The same sheet also carries the per-class design
parameters (γ, φ′, c′, cu, m) — those are the Phase-5 table, NOT used here.

Classification is on RAW qc (MPa), no Dr, no σ′v — and that is the SOURCE'S own
method, not a shortcut: the workbook's notes state the NAD soil-type assignment
is made "waar geen normalisatie wordt toegepast" (where NO normalisation is
applied). Verified against the workbook 2026-08-11 (audit F06 closed). The
normalisation the sheet warns about belongs to the NEN TABLE ENTRY — converting
field qc via ``qc;tabel = qc;terrein × Cqc`` with ``Cqc = (100/σ′v)^0.67``
before pulling PARAMETERS (E100, φ′, C′p, Cc/(1+e0), Csw/(1+e0); grind/zand and
to a limited degree leem and sterk zandige klei) — plus the sheet's own
one-line up/down shift, implemented for ZAND only. That conversion ships with
the Phase-5 NEN parameter port and has no role in packing classification.

A variant is ``"clean"`` or ``"secondary"``. ``"secondary"`` means the soil
carries its single admixture variant that the NAD table defines:
sand/gravel → silt-/kleihoudend, silt/clay → zandhoudend. Any other admixture
(e.g. gravelly sand) is NOT a NAD variant and falls to ``"clean"`` (spec §5,
exact matching). VEEN has no secondary variant in the table (its ``secondary``
row mirrors ``clean``).
"""

from __future__ import annotations

from typing import Literal

from groundmodel.shared.constants.litho_constants import BaseLithology

Variant = Literal["clean", "secondary"]

# Each entry: ascending list of (qc_upper_bound_mpa, nad_class). The classifier
# picks the first band whose upper bound exceeds qc (qc < upper); qc above the
# last band → that last (densest) class; qc below the first → that first
# (loosest) class (nearest-class fallback, spec §5). ``None`` upper bound =
# open-topped (densest).
# Real NAD-NEN thresholds (Task T0). Each (upper_bound, class): the band is
# qc < upper; upper = the next class's tabulated lower-bound qc. Comments give
# the band range in MPa.
NAD_QC_BANDS: dict[tuple[BaseLithology, Variant], list[tuple[float | None, int]]] = {
    # GRIND: matig gp (qc<20) / dicht gp (qc≥20). Table has no los/zeer-dicht gravel.
    ("GRIND", "clean"): [(20.0, 1), (None, 2)],
    ("GRIND", "secondary"): [(20.0, 3), (None, 4)],
    # ZAND: los [2,4) / matig [4,10) / dicht [10,15) / zeer dicht ≥15
    # (ANB Tabel 2.1, grondsoort "zand"). qc < 2 → nearest = los.
    ("ZAND", "clean"): [(4.0, 5), (10.0, 6), (15.0, 7), (None, 8)],
    ("ZAND", "secondary"): [(4.0, 9), (10.0, 10), (15.0, 11), (None, 12)],
    # SILT (table "Leem"): weinig vast [0.4,1) / matig vast [1,2) / vrij vast [2,4) /
    # vast ≥4. qc < 0.4 → nearest = weinig vast.
    ("SILT", "clean"): [(1.0, 13), (2.0, 14), (4.0, 15), (None, 16)],
    ("SILT", "secondary"): [(1.0, 17), (2.0, 18), (4.0, 19), (None, 20)],
    # KLEI: weinig vast [0.4,1) / matig vast [1,2) / vrij vast [2,4) / vast ≥4
    # (ANB Tabel 2.1, grondsoort "klei").
    ("KLEI", "clean"): [(1.0, 21), (2.0, 22), (4.0, 23), (None, 24)],
    ("KLEI", "secondary"): [(1.0, 25), (2.0, 26), (4.0, 27), (None, 28)],
    # VEEN: weinig vast [0.2,0.5) / matig vast [0.5,1) / vast ≥1 (ANB Tabel 2.1,
    # "veen"). No secondary variant in the table → secondary mirrors clean.
    ("VEEN", "clean"): [(0.5, 29), (1.0, 30), (None, 31)],
    ("VEEN", "secondary"): [(0.5, 29), (1.0, 30), (None, 31)],
}

# Sand bijmenging codes → any of these makes a fines soil "zandhoudend".
# ZN is the CORE "zand" admixture code (GL/ZN/SL/KL/VE); XZ is the generic DOV
# grain code; Z is its alias; FZ/MZ/GZ are fine/medium/coarse-sand grain
# variants. All are unambiguously sand (matches the UI's ADMIXTURE_SOIL_EN
# 'sandy' group). ZL (zandleem = sandy-loam) is deliberately excluded — it is
# loam-dominant, and whether it triggers "zandhoudend" is an unresolved owner
# ruling, not a mechanical inclusion.
_SAND_ADMIXTURE_CODES = frozenset({"XZ", "ZN", "Z", "FZ", "MZ", "GZ"})

# Silt/clay bijmenging codes → any of these makes a coarse soil (sand/gravel)
# "silt-/kleihoudend". DOV codes (codetabel_hoofdnaam.csv): SI=silt, KL=klei,
# LE=leem (geotechnically = silt, owner directive 2026-06-23). ``SL`` is a
# code-vocabulary collision: the UI emits it for a "Silt (SL)" admixture, but
# DOV uses ``SL`` for slib (sludge). Owner ruling 2026-07-26: slib is rare, so
# treat SL as silt here. (The cleaner fix is to align the UI's silt code to the
# DOV ``SI``; tracked separately.)
_SILT_CLAY_ADMIXTURE_CODES = frozenset({"SI", "KL", "LE", "SL"})

# Which admixture soil_codes map to the "secondary" NAD variant per main soil
# (spec §5). Coarse soils (sand/gravel) go secondary on a silt/clay admixture;
# fines (silt/clay/peat) go secondary on a sand admixture ("zandhoudend").
_SECONDARY_ADMIXTURE_CODES: dict[BaseLithology, frozenset[str]] = {
    "GRIND": _SILT_CLAY_ADMIXTURE_CODES,
    "ZAND": _SILT_CLAY_ADMIXTURE_CODES,
    "SILT": _SAND_ADMIXTURE_CODES,
    "KLEI": _SAND_ADMIXTURE_CODES,
    "VEEN": _SAND_ADMIXTURE_CODES,
}
