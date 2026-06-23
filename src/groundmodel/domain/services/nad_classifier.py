"""Pure NAD packing classifier — ``(soil, admixture, qc) → NAD class`` (spec §5).

Lithology is hard truth: qc never promotes or demotes a unit across soil types.
The band table is provisional; only the STRUCTURE of this module is final (spec §5,
Task T0 swaps in the production thresholds from the owner's xlsx).
"""

from __future__ import annotations

from groundmodel.domain.services.nad_classification_constants import (
    _SECONDARY_ADMIXTURE_CODES,
    NAD_QC_BANDS,
    Variant,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology


def _variant_for(soil: BaseLithology, admixtures: tuple[Admixture, ...]) -> Variant:
    """Return the NAD variant for a (soil, admixture) combination.

    Exact-match: the soil must carry at least one admixture whose ``soil_code``
    is in the soil's secondary set (spec §5). Any non-matching admixture code
    (e.g. gravel in sand) falls to ``"clean"``.

    Parameters
    ----------
    soil : BaseLithology
        Main soil type of the litho unit.
    admixtures : tuple[Admixture, ...]
        The unit's admixture components (may be empty).

    Returns
    -------
    Variant
        ``"secondary"`` when a qualifying admixture is present, else ``"clean"``.
    """
    codes = _SECONDARY_ADMIXTURE_CODES.get(soil, frozenset())
    if any(a.soil_code in codes for a in admixtures):
        return "secondary"
    return "clean"


def classify_nad(
    soil: BaseLithology,
    admixtures: tuple[Admixture, ...],
    qc_mpa: float,
) -> int:
    """Classify one (soil, admixture, qc) triple into a NAD packing class 1–31.

    Pure raw-qc band lookup (no Dr, no σ′v normalisation). qc outside the
    table's bands snaps to the nearest (loosest/densest) class within the
    soil's column; lithology is hard truth (qc never changes the soil type).
    See spec §5.

    Parameters
    ----------
    soil : BaseLithology
        Main soil type of the source litho unit (e.g. ``"ZAND"``).
    admixtures : tuple[Admixture, ...]
        The unit's admixtures — used only to pick clean vs secondary variant.
        Pass an empty tuple for a clean unit.
    qc_mpa : float
        Cone resistance at the segment in MPa (raw qc, not normalised).

    Returns
    -------
    int
        NAD class in the range 1–31.
    """
    variant = _variant_for(soil, admixtures)
    bands = NAD_QC_BANDS[(soil, variant)]
    # Walk ascending bands; return the first whose upper bound exceeds qc.
    # A ``None`` upper bound is open-topped (the densest class for this column).
    # qc below the very first band's upper bound returns that first (loosest) class
    # — the nearest-class fallback required by spec §5.
    for upper, nad_class in bands:
        if upper is None or qc_mpa < upper:
            return nad_class
    # Unreachable when every NAD_QC_BANDS row ends with a (None, ...) entry — an
    # invariant the constants table (and any Task T0 threshold swap) must preserve.
    # Present as a safety net to satisfy the type-checker and avoid an implicit None.
    return bands[-1][1]
