"""NAD packing-class lookup: ``(soil, admixture-variant, qc) → class 1–31``.

Production thresholds ported from the Belgian NAD table (Task T0): the
``NAD-NEN`` sheet of ``Correlaties uit S en NAD_NEN_v2.xlsx`` (Daniel Verastegui,
CPTE_2025), == the table on page 2 of ``NO26043_BepalingTabelGrond­
karakteristieken_v1.0``. Each class's tabulated qc is the LOWER bound of its
packing band; the band's upper bound is the next (denser) class's qc, so e.g.
``ZAND, matig gp`` is ``4 ≤ qc < 10`` and ``zeer dicht`` is ``qc ≥ 15`` (the
``>`` marker in the sheet). The same sheet also carries the per-class design
parameters (γ, φ′, c′, cu, m) — those are the Phase-5 table, NOT used here.

Classification is on RAW qc (MPa), no Dr, no σ′v (spec §5, owner directive). The
NAD sheet's *official* method NORMALISES qc for sand/gravel (its ``qc,gem,norm``
column, a Qtn-style overburden normalisation that can shift a sand one band
up/down); per owner directive raw qc is the default and the normalised/Qtn path
is a deferred Settings option (spec §5 "Qtn toggle"), applied to the same
thresholds before lookup. Non-sand soils are never normalised.

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

# Which admixture soil_codes map to the "secondary" NAD variant per main soil
# (spec §5). Codes are DOV hoofdnaam/bijmenging grondsoort codes from
# ``codetabel_hoofdnaam.csv`` (same codelist for main + admixture elements):
# SI=silt, KL=klei, LE=leem, XZ=zand (generic). The NAD secondary variant for
# coarse soils is "silt-/kleihoudend" (silty OR clayey); leem is geotechnically
# the same as silt (owner directive 2026-06-23), so sand/gravel take SI, KL OR
# LE. Fines (silt/clay/peat) take the sand code XZ ("zandhoudend"). "SL" (slib)
# is not a used admixture code → intentionally omitted. Anything else → "clean".
_SECONDARY_ADMIXTURE_CODES: dict[BaseLithology, frozenset[str]] = {
    "GRIND": frozenset({"SI", "KL", "LE"}),
    "ZAND": frozenset({"SI", "KL", "LE"}),
    "SILT": frozenset({"XZ"}),
    "KLEI": frozenset({"XZ"}),
    "VEEN": frozenset({"XZ"}),
}
