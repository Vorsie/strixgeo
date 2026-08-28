"""Resolve section units to unique, machine-usable export labels.

Both Deltares targets name their soils from a flat string namespace —
D-Stability keys a layer on a soil ``code``, D-Sheet Piling keys a
profile layer on a soil ``name`` — and neither tolerates a duplicate.
The unit-identifier scheme (``unit_identifier.py``, debt #104) is
deliberately NOT unique: two NAD 6 sand units under different
geological parents legitimately produce the same token. So the two
exporters would each need the same disambiguation, which is the second
concrete use — hence this shared helper rather than a copy in each.

Pure function, no I/O and no logger: the caller reports the collisions
it cares about (see :func:`label_collisions`).
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.application.section_polygon_set import SectionPolygonUnit
from groundmodel.infrastructure.exporters.ascii_fold import ascii_fold
from groundmodel.infrastructure.exporters.unit_identifier import unit_identifier
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    DUPLICATE_MATERIAL_SUFFIX,
)


def _base_label(unit: SectionPolygonUnit) -> str:
    """Return a unit's base export label — its identifier token or folded name.

    A classified unit's identifier (``NAD-06_ZAND`` / ``ZAND``) is already a
    closed-vocabulary ASCII token and passes through untouched. Only the
    fallback — the raw, user-typed ``unit.name`` — is ASCII-folded, because the
    label becomes a soil NAME/CODE that Deltares PARSES out of a cp1252 ``.shi``
    / ``.stix`` GEOLib re-opens with the ambient locale: a non-ASCII fallback
    name is the same ``UnicodeDecodeError``-on-Linux the identification block
    already folds. The soil name is a self-referential key (its definition and
    its profile reference are the same label), so folding keeps the only
    invariant that matters. Folding here — BEFORE the caller disambiguates —
    means two names that fold to the same ASCII collide in the same namespace
    and get the ordinal suffix, instead of silently minting a duplicate soil.
    Byte-identical for a fallback name that is already ASCII (``ascii_fold`` is
    the identity on pure-ASCII input).
    """
    return unit_identifier(
        nad_class=unit.nad_class,
        litho_main_soil_code=unit.litho_main_soil_code,
    ) or ascii_fold(unit.name)


def build_unit_labels(units: tuple[SectionPolygonUnit, ...]) -> dict[UUID, str]:
    """Map every unit to a unique export label.

    The label is the unit's identifier token when it has one, and its
    display name otherwise — so a geotech unit exports as
    ``NAD-06_ZAND``, a litho unit as ``ZAND``, and a geological
    formation as ``Boom Klei``. The SECOND and later unit claiming a
    label already taken gets an ordinal suffix (``NAD-06_ZAND #2``), so
    the first unit in ``units`` order keeps the clean token.

    Parameters
    ----------
    units : tuple[SectionPolygonUnit, ...]
        The section's units, in the order the caller wants them
        numbered. Callers pass them in ``display_order`` so the
        top-most unit of a colliding pair keeps the unsuffixed label.

    Returns
    -------
    dict[UUID, str]
        ``formation_id`` → label. Every unit in ``units`` is present;
        every value is distinct.
    """
    labels: dict[UUID, str] = {}
    taken: dict[str, int] = {}
    for unit in units:
        base = _base_label(unit)
        seen = taken.get(base, 0) + 1
        taken[base] = seen
        labels[unit.formation_id] = (
            base if seen == 1 else f"{base}{DUPLICATE_MATERIAL_SUFFIX}{seen}"
        )
    return labels


def label_collisions(units: tuple[SectionPolygonUnit, ...]) -> dict[str, int]:
    """Count the units that had to be disambiguated, per base label.

    Exporters log this so a colliding export is visible in the log
    rather than only in the artefact — an engineer who sees
    ``NAD-06_ZAND #2`` in D-Stability and does not know why has no
    other way to find out which two units collided.

    Parameters
    ----------
    units : tuple[SectionPolygonUnit, ...]
        Same units passed to :func:`build_unit_labels`.

    Returns
    -------
    dict[str, int]
        Base label → how many units claimed it, for bases claimed more
        than once. Empty when every unit's identifier was already
        unique.
    """
    counts: dict[str, int] = {}
    for unit in units:
        base = _base_label(unit)
        counts[base] = counts.get(base, 0) + 1
    return {base: n for base, n in counts.items() if n > 1}
