"""NAD soil parameters per packing class — the export table (transcribed 2026-09-02).

Source
------
The values belong to the owner's private workbook **"Correlaties uit S en
NAD_NEN_v2.xlsx"** — the same ``NAD-NEN`` sheet the qc thresholds in
``nad_classification_constants.py`` were ported from — which carries, per
packing class 1..31, the NEN 9997-1 (Eurocode 7) **Tabel 2.b characteristic
values**: unit weight γ, effective friction angle φ′ and effective cohesion c′.

Those numbers are NOT in this repository, and this module does NOT invent
them. It ships :data:`NAD_SOIL_PARAMETERS` filled from the owner's workbook. The plumbing that
reads it (the D-Stability and D-Sheet Piling exporters) is wired so that the
day the owner transcribes the workbook into this dict — one
:class:`NadSoilParameters` per class, keyed by the NAD class number from
``litho_constants.NAD_CLASSES`` — the exports carry the parameters with no
further code change. Filling the table is the only remaining step.

Discipline
----------
* **Transcribe, never infer.** Every value is read from the workbook. A
  correlation Strix computes itself would be a design output, which the
  product deliberately does not ship (CLAUDE.md "Core Philosophy"); a value
  the owner reads from a published norm table is a characterisation input the
  engineer still verifies.
* **Key by NAD class 1..31** (``NAD_CLASSES``). A key that is not a real class
  fails ``tests/unit/domain/services/test_nad_soil_parameters.py``.
* Until a class has a row here, an export writes that soil with **no**
  parameters — GEOLib's own blank initial values — never a plausible default.

This is a Phase-4 characterisation slice: unit weight + drained strength for
the closed-geometry D-Series exports. The full Robertson/Mayne parameter port
(cu, OCR, E50, Vs, G0, M) and the complete NAD-NEN parameter sheet stay Phase 5
(see the MVP scope note in CLAUDE.md).
"""

from __future__ import annotations

from dataclasses import dataclass

# Export annotation naming the norm table the values come from. Rides on every
# soil that carries parameters (the D-Stability soil ``Notes`` field; folded
# into the D-Sheet Piling ``[RUN IDENTIFICATION]`` block, which has no per-soil
# free-text slot). "Tabel 2.b" is the NEN 9997-1 characteristic-value table;
# "karakteristieke waarde" (characteristic value) is what the engineer verifies.
SOURCE_LABEL = "NAD Tabel 2.b — karakteristieke waarde"


@dataclass(frozen=True)
class NadSoilParameters:
    """Characteristic soil parameters for one NAD packing class.

    A frozen value object — it holds data and does not act, so it does not
    inherit ``GroundModelLogger`` (CLAUDE.md "Logging via inheritance").
    Every field is a characteristic value transcribed from the NAD-NEN
    workbook, in the unit named by its suffix.

    Attributes
    ----------
    gamma_unsat_kn_m3 : float
        Unit weight above the phreatic level (unsaturated), kN/m³.
    gamma_sat_kn_m3 : float
        Unit weight below the phreatic level (saturated), kN/m³. Never
        below ``gamma_unsat_kn_m3``.
    phi_deg : float
        Effective angle of internal friction φ′, degrees.
    c_kpa : float
        Effective cohesion c′, kPa. Zero for a clean sand or gravel.
    cu_kpa : float | None
        Characteristic undrained shear strength, kPa; ``None`` for the granular
        classes, where the workbook carries a dash.
    """

    gamma_unsat_kn_m3: float
    gamma_sat_kn_m3: float
    phi_deg: float
    c_kpa: float
    cu_kpa: float | None


#: NAD class number (1..31) → characteristic parameters. EMPTY on purpose —
#: the owner transcribes the workbook here (see the module docstring). Every
#: key MUST be a class from ``NAD_CLASSES``; every value MUST be read from the
#: workbook, never inferred. Example of one filled row (illustrative shape
#: only — NOT a real value):
#:     6: NadSoilParameters(
#:         gamma_unsat_kn_m3=..., gamma_sat_kn_m3=...,
#:         phi_deg=..., c_kpa=...,
#:     ),
# Transcribed 2026-09-02 by script from the owner's workbook
# "Correlaties uit S en NAD_NEN_v2.xlsx" (sheet NAD-NEN, columns g_k_d / g_k_n /
# phi' / c'k / cu,k_NAD; rows per docs/reference/nad_reference_manifest.json, whose
# sha256 the file matched), name + characteristic qc cross-checked per row. A dash
# in the workbook (no undrained strength for a granular class) is ``None``.
NAD_SOIL_PARAMETERS: dict[int, NadSoilParameters] = {
    1: NadSoilParameters(  # GRIND, matig gp
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=20, phi_deg=35, c_kpa=0, cu_kpa=None
    ),
    2: NadSoilParameters(  # GRIND, dicht gp
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=21, phi_deg=40, c_kpa=0, cu_kpa=None
    ),
    3: NadSoilParameters(  # GRIND, silt-/kleihoudend, matig gp
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=21, phi_deg=32, c_kpa=0, cu_kpa=None
    ),
    4: NadSoilParameters(  # GRIND, silt- of kleihoudend, dicht gp
        gamma_unsat_kn_m3=20, gamma_sat_kn_m3=22, phi_deg=37, c_kpa=0, cu_kpa=None
    ),
    5: NadSoilParameters(  # ZAND, los gp
        gamma_unsat_kn_m3=16, gamma_sat_kn_m3=18, phi_deg=27, c_kpa=0, cu_kpa=None
    ),
    6: NadSoilParameters(  # ZAND, matig gp
        gamma_unsat_kn_m3=17, gamma_sat_kn_m3=19, phi_deg=30, c_kpa=0, cu_kpa=None
    ),
    7: NadSoilParameters(  # ZAND, dicht gp
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=20, phi_deg=32, c_kpa=0, cu_kpa=None
    ),
    8: NadSoilParameters(  # ZAND, zeer dicht gp
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=20, phi_deg=35, c_kpa=0, cu_kpa=None
    ),
    9: NadSoilParameters(  # ZAND, silt-/kleihoudend, los gp
        gamma_unsat_kn_m3=16, gamma_sat_kn_m3=18, phi_deg=25, c_kpa=0, cu_kpa=None
    ),
    10: NadSoilParameters(  # ZAND, silt-/kleihoudend, matig gp
        gamma_unsat_kn_m3=17, gamma_sat_kn_m3=19, phi_deg=27, c_kpa=0, cu_kpa=None
    ),
    11: NadSoilParameters(  # ZAND, silt-/kleihoudend, dicht gp
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=20, phi_deg=30, c_kpa=0, cu_kpa=None
    ),
    12: NadSoilParameters(  # ZAND, silt-/kleihoudend, zeer dicht gp
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=20, phi_deg=32, c_kpa=0, cu_kpa=None
    ),
    13: NadSoilParameters(  # SILT, weinig vast
        gamma_unsat_kn_m3=17, gamma_sat_kn_m3=17, phi_deg=22, c_kpa=0, cu_kpa=10
    ),
    14: NadSoilParameters(  # SILT, matig vast
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=18, phi_deg=22, c_kpa=2, cu_kpa=25
    ),
    15: NadSoilParameters(  # SILT, vrij vast
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=19, phi_deg=22, c_kpa=4, cu_kpa=50
    ),
    16: NadSoilParameters(  # SILT, vast
        gamma_unsat_kn_m3=20, gamma_sat_kn_m3=20, phi_deg=22, c_kpa=8, cu_kpa=100
    ),
    17: NadSoilParameters(  # SILT, zandhoudend, weinig vast
        gamma_unsat_kn_m3=17, gamma_sat_kn_m3=17, phi_deg=25, c_kpa=0, cu_kpa=10
    ),
    18: NadSoilParameters(  # SILT, zandhoudend, matig vast
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=18, phi_deg=25, c_kpa=2, cu_kpa=25
    ),
    19: NadSoilParameters(  # SILT, zandhoudend, vrij vast
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=19, phi_deg=25, c_kpa=4, cu_kpa=50
    ),
    20: NadSoilParameters(  # SILT, zandhoudend, vast
        gamma_unsat_kn_m3=20, gamma_sat_kn_m3=20, phi_deg=25, c_kpa=8, cu_kpa=100
    ),
    21: NadSoilParameters(  # KLEI, weinig vast
        gamma_unsat_kn_m3=16, gamma_sat_kn_m3=16, phi_deg=20, c_kpa=2, cu_kpa=20
    ),
    22: NadSoilParameters(  # KLEI, matig vast
        gamma_unsat_kn_m3=17, gamma_sat_kn_m3=17, phi_deg=20, c_kpa=4, cu_kpa=50
    ),
    23: NadSoilParameters(  # KLEI, vrij vast
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=18, phi_deg=20, c_kpa=8, cu_kpa=100
    ),
    24: NadSoilParameters(  # KLEI, vast
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=19, phi_deg=20, c_kpa=15, cu_kpa=200
    ),
    25: NadSoilParameters(  # KLEI, zandhoudend, weinig vast
        gamma_unsat_kn_m3=16, gamma_sat_kn_m3=16, phi_deg=22, c_kpa=2, cu_kpa=20
    ),
    26: NadSoilParameters(  # KLEI, zandhoudend, matig vast
        gamma_unsat_kn_m3=17, gamma_sat_kn_m3=17, phi_deg=22, c_kpa=4, cu_kpa=50
    ),
    27: NadSoilParameters(  # KLEI, zandhoudend, vrij vast
        gamma_unsat_kn_m3=18, gamma_sat_kn_m3=18, phi_deg=22, c_kpa=8, cu_kpa=100
    ),
    28: NadSoilParameters(  # KLEI, zandhoudend, vast
        gamma_unsat_kn_m3=19, gamma_sat_kn_m3=19, phi_deg=22, c_kpa=15, cu_kpa=200
    ),
    29: NadSoilParameters(  # VEEN, weinig vast
        gamma_unsat_kn_m3=10, gamma_sat_kn_m3=10, phi_deg=15, c_kpa=2, cu_kpa=10
    ),
    30: NadSoilParameters(  # VEEN, matig vast
        gamma_unsat_kn_m3=12, gamma_sat_kn_m3=12, phi_deg=15, c_kpa=5, cu_kpa=20
    ),
    31: NadSoilParameters(  # VEEN, vast
        gamma_unsat_kn_m3=14, gamma_sat_kn_m3=14, phi_deg=15, c_kpa=10, cu_kpa=40
    ),
}
