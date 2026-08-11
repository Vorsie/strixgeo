"""Pure NAD packing classifier — ``(soil, admixture, qc) → NAD class`` (spec §5).

Lithology is hard truth: qc never promotes or demotes a unit across soil types.
The band table is provisional; only the STRUCTURE of this module is final (spec §5,
Task T0 swaps in the production thresholds from the owner's xlsx).
"""

from __future__ import annotations

import math

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
    qc_mpa: float | None,
) -> int:
    """Classify one (soil, admixture, qc) triple into a NAD packing class 1–31.

    Pure raw-qc band lookup (no Dr, no σ′v normalisation). qc outside the
    table's bands snaps to the nearest (loosest/densest) class within the
    soil's column; lithology is hard truth (qc never changes the soil type).
    See spec §5.

    Invalid input is REJECTED, never silently mapped to a plausible class
    (owner rule 2026-07-25): a missing/NaN/infinite/negative qc raises rather
    than returning the densest (NaN) or loosest (negative) class, and an
    unrecognised soil raises a readable error naming it instead of a bare
    ``KeyError``. Callers filter bad samples upstream; these guards are the
    defensive backstop so no code path turns invalid data into a design-facing
    packing class.

    Parameters
    ----------
    soil : BaseLithology
        Main soil type of the source litho unit (e.g. ``"ZAND"``).
    admixtures : tuple[Admixture, ...]
        The unit's admixtures — used only to pick clean vs secondary variant.
        Pass an empty tuple for a clean unit.
    qc_mpa : float | None
        Cone resistance at the segment in MPa (raw qc, not normalised). Must be
        a finite, non-negative number. ``0.0`` is a physically valid reading
        (→ loosest class) and stays accepted; it is NOT a "no data" sentinel —
        a caller with no qc to classify must produce ``nad_class=None`` (needs
        review) instead of calling this function.

    Returns
    -------
    int
        NAD class in the range 1–31.

    Raises
    ------
    ValueError
        If ``qc_mpa`` is missing/None, NaN, infinite, or negative, or if
        ``soil`` has no NAD band column (unknown soil type).
    """
    if qc_mpa is None or not math.isfinite(qc_mpa) or qc_mpa < 0:
        raise ValueError(
            f"invalid qc_mpa {qc_mpa!r}: NAD classification needs a finite, "
            "non-negative cone resistance (MPa)."
        )
    variant = _variant_for(soil, admixtures)
    bands = NAD_QC_BANDS.get((soil, variant))
    if bands is None:
        raise ValueError(
            f"unknown soil for NAD classification: soil={soil!r} "
            f"(variant={variant!r}) has no NAD band column."
        )
    # Walk ascending bands; return the first whose upper bound exceeds qc.
    # A ``None`` upper bound is open-topped (the densest class for this column).
    # qc below the very first band's upper bound returns that first (loosest)
    # class — the bottoms are open too (owner ruling 2026-08-11: "Keep the open
    # ends to the bottom also, we're starting from litho so this is
    # conservative" — the soil is already fixed by the litho model, so a reading
    # below the printed table's floor still belongs to it and takes its loosest
    # class).
    for upper, nad_class in bands:
        if upper is None or qc_mpa < upper:
            return nad_class
    # Unreachable when every NAD_QC_BANDS row ends with a (None, ...) entry — an
    # invariant the constants table (and any Task T0 threshold swap) must preserve.
    # Present as a safety net to satisfy the type-checker and avoid an implicit None.
    return bands[-1][1]


def loosest_class_for(
    soil: BaseLithology | str,
    admixtures: tuple[Admixture, ...],
) -> int | None:
    """The loosest NAD class of the soil's OWN column — variant included.

    The absolute-min borehole fallback used a per-family constant that always
    named the CLEAN column's floor, so a silthoudend zand was stamped class 5
    instead of 9 (audit F19) — the right packing degree in the wrong NAD column,
    harmless until anything keys on the class number, which the Phase-5
    parameter table is. This derives the floor from the same table and the same
    variant rule the classifier proper uses, so the two can never disagree.

    Parameters
    ----------
    soil : BaseLithology | str
        Main soil of the litho unit.
    admixtures : tuple[Admixture, ...]
        The unit's admixtures — picks clean vs secondary, via the classifier's
        own :func:`_variant_for`.

    Returns
    -------
    int | None
        The first (loosest) class of the ``(soil, variant)`` column, or ``None``
        for a soil the table does not know — the caller skips rather than
        guesses a family.
    """
    bands = NAD_QC_BANDS.get((soil, _variant_for(soil, admixtures)))  # type: ignore[arg-type]
    if bands is None:
        return None
    return bands[0][1]
