"""Pure domain helper — classify enclosed lens units on a contact stack.

A lithostratigraphic contact stack is the depth-sorted list of contact
"tops" on one investigation.  Between consecutive contacts lies a *unit*:
unit ``i`` spans contact ``i`` (its top) down to contact ``i+1`` (its base).
The deepest contact has no base contact below it and so frames no unit.

An *enclosed lens* is a thin unit whose formation differs from the formation
of the contact directly above AND directly below it, where those bracketing
contacts share the SAME formation (e.g. SAND · SILT · SAND, both sands one
formation row).  Geologically the bracketing formation is one continuous
host wrapping the lens; the lens is the thing that pinches out laterally.

This module answers, from a formation-id sequence alone, which unit indices
are enclosed lenses and which are the host halves wrapping them.  It is a
PURE function — no I/O, no DB, no logging — so it is unit-testable in
isolation and callable from any layer without violating the clean-
architecture dependency rule.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class EnclosedLensClassification:
    """Result of :func:`classify_enclosed_lenses`.

    Attributes
    ----------
    lens_units : set[int]
        Unit indices that are enclosed lenses — bracketed above and below
        by the same (different-from-self) formation, where the lens
        formation is the minority of the bracket pair.
    host_half_units : set[int]
        Unit indices that are the bracketing host of some enclosed lens
        (the unit directly above or below a lens, sharing the host
        formation).  These are interior to one continuous host body and
        must NOT be suggested as independent pinch-outs.
    """

    lens_units: set[int]
    host_half_units: set[int]


def classify_enclosed_lenses(
    formation_ids: list[UUID],
) -> EnclosedLensClassification:
    """Classify enclosed-lens and host-half units on a contact stack.

    Parameters
    ----------
    formation_ids : list[UUID]
        Formation id of each contact on one investigation, ordered by
        ``depth_top_m`` ascending.  Entry ``k`` is the top of unit ``k``;
        the LAST entry frames no unit (no base contact below it).

    Returns
    -------
    EnclosedLensClassification
        ``lens_units`` and ``host_half_units`` as sets of unit indices in
        ``range(len(formation_ids) - 1)``.  Both are empty when the stack
        has fewer than three contacts or contains no qualifying bracket.

    Notes
    -----
    With ``n`` contacts there are ``U = n - 1`` units.  ``count(F)`` is the
    number of contacts whose formation is ``F`` (over all ``n`` contacts).
    Unit ``i`` is an enclosed lens iff ``1 <= i <= U-1`` AND
    ``formation_ids[i-1] == formation_ids[i+1] != formation_ids[i]`` AND
    ``count(formation_ids[i]) < count(formation_ids[i-1])`` (the lens is the
    minority; the recurring formation is the host/matrix).  A true count
    tie is not a lens.  The lower host half ``i+1`` is recorded only when it
    is itself a framed unit (``i+1 < U``); otherwise it is the deepest
    contact and frames no unit.
    """
    n = len(formation_ids)
    unit_count = n - 1  # the last contact frames no unit
    lens_units: set[int] = set()
    host_half_units: set[int] = set()
    if unit_count < 2:
        # Need at least three contacts (two units) for an interior unit.
        return EnclosedLensClassification(lens_units, host_half_units)

    # Count over ALL contacts so a host that runs to the bottom of the hole
    # (its deepest occurrence frames no unit) still counts toward "matrix".
    counts = Counter(formation_ids)

    # Unit i is framed by contacts i, i+1.  A lens needs a contact directly
    # above (i-1 >= 0) and directly below (i+1 <= n-1), i.e. 1 <= i <= n-2,
    # which is 1 <= i <= unit_count-1 → range(1, unit_count).
    for i in range(1, unit_count):
        above_fid = formation_ids[i - 1]
        lens_fid = formation_ids[i]
        below_fid = formation_ids[i + 1]
        if (
            above_fid == below_fid
            and above_fid != lens_fid
            and counts[lens_fid] < counts[above_fid]
        ):
            lens_units.add(i)
            host_half_units.add(i - 1)  # upper host half — always a framed unit
            if i + 1 < unit_count:
                # Lower host half is a framed unit only when a contact exists
                # below it; otherwise it is the deepest contact (no unit).
                host_half_units.add(i + 1)

    return EnclosedLensClassification(
        lens_units=lens_units,
        host_half_units=host_half_units,
    )
