"""Which investigation wins a voxel column that two of them share.

A regular grid can hold ONE observed log per column, so two investigations
closer together than the horizontal voxel contend for the same one and only one
of their logs survives — the other is labelled from its neighbour's log AT ITS
OWN map position.  Before this module the winner was the lexicographically
smallest ``investigation_id``, and because the ids are time-ordered UUIDv7 that
meant *whichever was imported first*.  The choice also moved with the grid
phase, so the same pair could collide in one build and not the next.

The rule (owner decision 2026-07-27; the measurements behind it are in
``docs/debt.md`` #241):

0. **Having an observed log at all beats not having one.**  An empty column
   contributes no override, so it must never take a column from an
   investigation that does have a log.
1. **A CPT beats a borehole.**  Measured on the four paired stations of the
   reference model: the driller's descriptions are logged on a 0.5 m grid (13-19
   of every ~20 field-log boundaries land exactly on a 0.5 m multiple), so a
   borehole contact depth is only known to the nearest half metre, while the cone
   registers depth continuously and resolves 3-4x more contacts.  The borehole
   stays the better source for WHAT the soil is; its contact GEOMETRY is the
   least reliable in the pair, and geometry is what a voxel column is.
2. **Same kind → the one that reached deeper wins**, measured as the lowest base
   ELEVATION over its intervals.  Not depth below its own collar: paired collars
   differ by centimetres, so the two readings agree in practice, but elevation is
   the one that stays right when they do not.
3. **Still tied → the lower investigation id**, so a build is reproducible.  Not
   reached on real data.

The four keys form a TOTAL order, so a cell holding three or more contenders
resolves to the same winner whatever order they are folded in — the caller can
use a running comparison and need not sort.

Only ``cpt`` and ``borehole`` can anchor a litho layer today (the tokens live in
:mod:`~groundmodel.domain.services.investigation_kind_constants`, beside the
pick that carries them rather than here, because they describe an investigation
and not a voxel rule).  A future investigation kind (DMT, pressuremeter) MUST be
given an explicit place in ``_KIND_RANK`` rather than inheriting one.

Pure domain module — no I/O, no logging, no framework imports.  It computes; it
does not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.investigation_kind_constants import (
    KIND_BOREHOLE,
    KIND_CPT,
)
from groundmodel.domain.services.voxel_litho.voxel_types import InvestigationColumn

__all__ = ["honor_rank"]

# Lower rank wins.  An unrecognised kind sorts AFTER both known kinds rather
# than raising: a build must not fail because a new investigation type appeared,
# but it must not silently outrank a cone either.
_KIND_RANK: dict[str, int] = {KIND_CPT: 0, KIND_BOREHOLE: 1}
_UNKNOWN_KIND_RANK: int = 2


def honor_rank(column: InvestigationColumn) -> tuple[int, int, float, str]:
    """Sort key deciding which investigation is honored in a shared voxel column.

    The SMALLEST key wins, so a caller selects with ``min(..., key=honor_rank)``
    or a running ``honor_rank(candidate) < honor_rank(incumbent)`` comparison —
    both give the same answer, because the key is a total order.

    Having a log at all outranks EVERY other key.  A column with no observed
    intervals contributes no override, so it must never take a column away from
    an investigation that does have one — not even a cone from a borehole.

    Parameters
    ----------
    column : InvestigationColumn
        The contending investigation's observed column.

    Returns
    -------
    tuple[int, int, float, str]
        ``(has_no_log, kind_rank, base_elev_m, investigation_id)``.
        ``base_elev_m`` is the lowest base elevation over the column's
        intervals, so a smaller (deeper) value sorts first; a column with no
        intervals gets ``+inf`` there as well as losing on the first key.
    """
    kind_rank = _KIND_RANK.get(column.kind, _UNKNOWN_KIND_RANK)
    # An empty log has nothing to honour — rank it below every real log rather
    # than letting ``min()`` over an empty sequence raise.
    base_elev = (
        min(base for _body, _formation, _top, base in column.intervals)
        if column.intervals
        else math.inf
    )
    return (0 if column.intervals else 1, kind_rank, base_elev, column.investigation_id)
