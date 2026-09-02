"""NAD soil parameters per packing class — the export table, empty until filled.

Source
------
The values belong to the owner's private workbook **"Correlaties uit S en
NAD_NEN_v2.xlsx"** — the same ``NAD-NEN`` sheet the qc thresholds in
``nad_classification_constants.py`` were ported from — which carries, per
packing class 1..31, the NEN 9997-1 (Eurocode 7) **Tabel 2.b characteristic
values**: unit weight γ, effective friction angle φ′ and effective cohesion c′.

Those numbers are NOT in this repository, and this module does NOT invent
them. It ships an **empty** :data:`NAD_SOIL_PARAMETERS`. The plumbing that
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
    """

    gamma_unsat_kn_m3: float
    gamma_sat_kn_m3: float
    phi_deg: float
    c_kpa: float


#: NAD class number (1..31) → characteristic parameters. EMPTY on purpose —
#: the owner transcribes the workbook here (see the module docstring). Every
#: key MUST be a class from ``NAD_CLASSES``; every value MUST be read from the
#: workbook, never inferred. Example of one filled row (illustrative shape
#: only — NOT a real value):
#:     6: NadSoilParameters(
#:         gamma_unsat_kn_m3=..., gamma_sat_kn_m3=...,
#:         phi_deg=..., c_kpa=...,
#:     ),
NAD_SOIL_PARAMETERS: dict[int, NadSoilParameters] = {}
