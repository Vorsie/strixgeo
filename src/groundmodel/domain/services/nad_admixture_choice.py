"""Admixture → NAD-family prompt: which units to ask, and how the answer binds.

Owner ruling 2026-09-04 (verbatim): *"we can keep the admixture mix, but then we
need to prompt user in geotech stage on subdivide. Hey we see you have an
admixture here, which NAD classes do you want, pure sand or sand with
admixture."*

The NAD classifier already picks a ``"clean"`` or ``"secondary"`` column from a
unit's admixtures (see :mod:`nad_classifier`). For some soils that pick is a real
fork — a silty sand can be classified as clean sand (NAD 5-8) OR as
silt-/kleihoudend sand (NAD 9-12) — and the ruling makes it the engineer's call
rather than the machine's. This module decides WHICH units carry such a fork
(:func:`unit_admixture_is_ambiguous`) and turns the persisted answer into a
forced classifier variant (:func:`resolve_admixture_variant`). Both read the
EXISTING ``NAD_QC_BANDS`` table — no thresholds are invented here.
"""

from __future__ import annotations

from typing import Literal

from groundmodel.domain.services.nad_classification_constants import (
    NAD_QC_BANDS,
    Variant,
)
from groundmodel.domain.services.nad_classifier import _variant_for
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology

#: The persisted answer stored on ``geological_formation.nad_admixture_choice``.
#: ``"pure"`` = classify into the soil's clean NAD column;
#: ``"with_admixture"`` = classify into the secondary (silt-/klei- or
#: zandhoudend) column; ``None`` (the column default) = not answered yet, so the
#: classifier keeps its auto-from-admixtures behaviour.
NadAdmixtureChoice = Literal["pure", "with_admixture"]


def unit_admixture_is_ambiguous(
    soil: BaseLithology | str | None,
    admixtures: tuple[Admixture, ...],
) -> bool:
    """Whether the prompt must ask this litho unit which NAD family to use.

    True only when BOTH hold, so the question is never asked when there is no
    genuine fork to decide:

    * the unit carries a qualifying secondary admixture — the classifier's own
      :func:`nad_classifier._variant_for` returns ``"secondary"`` (silt/clay on a
      coarse soil, sand on a fine soil); AND
    * the soil's ``"clean"`` and ``"secondary"`` NAD columns actually differ.

    The second clause is what excludes VEEN, whose secondary column mirrors its
    clean one (the norm table gives peat no with-admixture variant), and any soil
    the table does not know at all.

    Parameters
    ----------
    soil : BaseLithology | str | None
        Main soil of the litho unit (raw token accepted; ``None`` → not ambiguous).
    admixtures : tuple[Admixture, ...]
        The unit's admixtures.

    Returns
    -------
    bool
        ``True`` when the pure-vs-with-admixture choice is a real fork the
        engineer should decide; ``False`` otherwise.
    """
    clean = NAD_QC_BANDS.get((soil, "clean"))  # type: ignore[arg-type]
    secondary = NAD_QC_BANDS.get((soil, "secondary"))  # type: ignore[arg-type]
    if clean is None or secondary is None or clean == secondary:
        return False
    return _variant_for(soil, admixtures) == "secondary"  # type: ignore[arg-type]


def resolve_admixture_variant(
    soil: BaseLithology | str | None,
    admixtures: tuple[Admixture, ...],
    choice: NadAdmixtureChoice | str | None,
) -> Variant | None:
    """Turn a persisted answer into a forced NAD variant for the classifier.

    ``"pure"`` → ``"clean"``; ``"with_admixture"`` → ``"secondary"``; anything
    else (``None``, or an unrecognised legacy string) → ``None``, which tells the
    classifier to keep deciding from the admixtures itself.

    ``soil`` and ``admixtures`` are accepted for symmetry with the classifier
    signature and to keep the call sites uniform; the mapping itself depends only
    on the stored ``choice``.

    Parameters
    ----------
    soil : BaseLithology | str | None
        Main soil of the unit (unused; kept for a uniform call shape).
    admixtures : tuple[Admixture, ...]
        The unit's admixtures (unused; kept for a uniform call shape).
    choice : NadAdmixtureChoice | str | None
        The persisted ``nad_admixture_choice``.

    Returns
    -------
    Variant | None
        ``"clean"`` / ``"secondary"`` to force a column, or ``None`` to defer to
        the classifier's own variant rule.
    """
    if choice == "pure":
        return "clean"
    if choice == "with_admixture":
        return "secondary"
    return None
