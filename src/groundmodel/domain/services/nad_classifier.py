"""Pure NAD packing classifier — ``(soil, admixture, qc) → NAD class`` (spec §5).

Lithology is hard truth: qc never promotes or demotes a unit across soil types.
The band table carries the production thresholds (Task T0 done), verified against
the printed NBN EN 1997-1 ANB Tabel 2.1 and the owner's workbook on 2026-08-11 —
see ``docs/reference/nad_reference_manifest.json`` and the WB1/WB2 pins.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.nad_classification_constants import (
    _SECONDARY_ADMIXTURE_CODES,
    NAD_QC_BANDS,
    Variant,
)

# NOTE: ``nad_admixture_choice.resolve_admixture_variant`` maps the persisted
# engineer answer to the ``variant_override`` these functions accept — kept in a
# sibling module so this classifier stays free of the stored-choice vocabulary.
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import (
    BASE_LITHOLOGIES,
    NAD_CLASSES,
    BaseLithology,
)


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
    *,
    variant_override: Variant | None = None,
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
    variant_override : Variant | None, optional
        The engineer's persisted NAD-family answer (owner ruling 2026-09-04),
        already resolved to a column: ``"clean"`` forces the pure column,
        ``"secondary"`` the with-admixture column, regardless of ``admixtures``.
        ``None`` (default) keeps the auto-from-admixtures behaviour.

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
    variant = variant_override if variant_override is not None else _variant_for(soil, admixtures)
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
    *,
    variant_override: Variant | None = None,
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
    variant_override : Variant | None, optional
        The engineer's persisted NAD-family answer, resolved to a column; forces
        the clean/secondary floor regardless of ``admixtures``. ``None`` (default)
        keeps the auto-from-admixtures behaviour.

    Returns
    -------
    int | None
        The first (loosest) class of the ``(soil, variant)`` column, or ``None``
        for a soil the table does not know — the caller skips rather than
        guesses a family.
    """
    variant = variant_override if variant_override is not None else _variant_for(soil, admixtures)  # type: ignore[arg-type]
    bands = NAD_QC_BANDS.get((soil, variant))  # type: ignore[arg-type]
    if bands is None:
        return None
    return bands[0][1]


def soil_family_of(nad_class: int | None) -> BaseLithology | None:
    """The soil family a NAD packing class belongs to.

    The inverse of :func:`hand_settable_classes_for`, read off the norm table
    itself (``NAD_CLASSES``) rather than a second range map, so the two can
    never drift.

    Parameters
    ----------
    nad_class : int | None
        A NAD packing class, or ``None`` for an unclassified band.

    Returns
    -------
    BaseLithology | None
        ``"GRIND"`` / ``"ZAND"`` / ``"SILT"`` / ``"KLEI"`` / ``"VEEN"``, or
        ``None`` for ``None`` and for any number the norm never printed.
    """
    if nad_class is None:
        return None
    entry = NAD_CLASSES.get(nad_class)
    return None if entry is None else entry[1]


def class_belongs_to_soil(nad_class: int | None, soil: BaseLithology | str | None) -> bool:
    """Whether a NAD class may sit on a band of this soil.

    Owner ruling 2026-08-26: *"no a zand body can never carry a silt packing
    class"* — and, the same day, *"the nad coupling is absolute."* A packing
    class is a statement about a soil column, so it is meaningless on any
    other soil.

    Two cases are deliberately NOT violations, because in neither is there a
    foreign family to convict:

    * ``nad_class is None`` — the band is not yet classified. That is the
      honest state this module falls back TO, so it can never be refused.
    * ``soil`` is absent or outside the five base lithologies — the norm table
      gives such a unit no NAD column at all, so nothing about it says the
      class is foreign. Those units are already denied a machine class
      upstream; refusing here would additionally wipe a class an engineer set
      by hand.

    Parameters
    ----------
    nad_class : int | None
        The class being placed on the band.
    soil : BaseLithology | str | None
        Main soil of the band's parent litho unit.

    Returns
    -------
    bool
        ``False`` only when both families are known and they differ.
    """
    class_soil = soil_family_of(nad_class)
    if class_soil is None:
        return True
    # The soil reaches this predicate as a raw token from a formation row on
    # some paths and as the segmenter's enum on others; ``.value`` is the one
    # that compares against the norm table's keys.
    soil_value = getattr(soil, "value", soil)
    if soil_value not in BASE_LITHOLOGIES:
        return True
    return class_soil == soil_value


def clamp_class_to_soil(nad_class: int | None, soil: BaseLithology | str | None) -> int | None:
    """The class if it belongs to *soil*, otherwise no class at all.

    The enforcement of this module's opening sentence — lithology is hard
    truth. A class from the wrong soil column is not downgraded, rank-mapped,
    or nudged into the right family: it is DROPPED, and the band comes back
    unclassified. "SILT, moderately firm" is evidence about a silt somewhere
    else; it is not evidence that a sand is medium dense, and manufacturing a
    same-rank sand class out of it would dress a guess as a reading (the
    no-guessing rule; Data Integrity Rule 3).

    Parameters
    ----------
    nad_class : int | None
        The candidate class.
    soil : BaseLithology | str | None
        Main soil of the band's parent litho unit.

    Returns
    -------
    int | None
        ``nad_class`` unchanged when it belongs to the soil (or when the
        coupling cannot be judged — see :func:`class_belongs_to_soil`);
        ``None`` when it belongs to a different soil family.
    """
    return nad_class if class_belongs_to_soil(nad_class, soil) else None


def hand_settable_classes_for(soil: BaseLithology | str) -> tuple[int, ...]:
    """Every NAD class an engineer may set BY HAND on a band of this soil.

    Both variants (clean and secondary) are offered: a hand class is the
    engineer's judgement, and that judgement may include "this interval is the
    silty variant" — the admixture-derived variant only decides what the
    MACHINE classifies, never what the engineer is allowed to state.

    Parameters
    ----------
    soil : BaseLithology | str
        Main soil of the band's parent litho unit.

    Returns
    -------
    tuple[int, ...]
        The soil's classes across both variants, ascending; empty for a soil
        the table does not know (the caller refuses rather than guesses).
    """
    classes: set[int] = set()
    for (table_soil, _variant), bands in NAD_QC_BANDS.items():
        if table_soil == soil:
            classes.update(nad_class for _threshold, nad_class in bands)
    return tuple(sorted(classes))
