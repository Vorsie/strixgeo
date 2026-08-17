"""One packing correlation per pair of surfaces on a section.

A divide reaches the same correlation twice: :mod:`geotech_tie_reanchor`
CARRIES it across the band rebuild, and the derivation RE-EMITS it from the
litho model.  The two write their endpoints in whatever order they hold them,
so a reversed pair defeats both writers' own checks and the row lands twice.

The owner met this as flagged ties he deleted by hand after every press
(2026-08-16): the carried copy is flagged, because it was matched onto a band
whose class had changed, while the re-emitted copy is derived fresh and needs
no review.  Two lines, one of them nagging, saying the same thing.
"""

from __future__ import annotations

from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from uuid import UUID

__all__ = [
    "GeotechEdgeRow",
    "duplicate_edge_ids_to_drop",
    "HopCandidate",
    "hop_skips_a_column",
    "hops_to_emit",
]


@dataclass(frozen=True)
class GeotechEdgeRow:
    """One stored packing correlation, as the dedup pass needs to see it.

    Parameters
    ----------
    edge_id : UUID
        The row.
    section_id : UUID
        The cross-section the correlation was drawn on; correlations are
        section-scoped, so the same bands may legitimately be tied on several.
    layer_a_id, layer_b_id : UUID
        The two geotech bands, in stored order — which is exactly what cannot
        be relied upon.
    layer_a_side, layer_b_side : str
        ``'top'`` or ``'base'``: which surface of each band the tie names.  A
        top-to-top tie and a base-to-base tie between the same two bands are
        different statements.
    source : str
        ``'manual'`` for a line the engineer drew, ``'auto'`` for a machine
        one.
    review_reason : str | None
        The flag asking the engineer to confirm the tie, or ``None``.
    layer_a_depth_top_m, layer_b_depth_top_m : float
        The two bands' top depths, so competing hops on one contact can be
        ranked by how far they jump.  Default ``0.0``: callers that only dedup
        by pair never read them.
    is_hop : bool
        ``True`` for a correlation step 4 derived from a donor correspondence,
        as opposed to one the engineer drew or one that restates a litho tie.
    """

    edge_id: UUID
    section_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    layer_a_side: str
    layer_b_side: str
    source: str
    review_reason: str | None
    layer_a_depth_top_m: float = 0.0
    layer_b_depth_top_m: float = 0.0
    is_hop: bool = False


def _identity(row: GeotechEdgeRow) -> tuple[UUID, tuple[UUID, str], tuple[UUID, str]]:
    """What makes two rows the same statement, independent of stored order."""
    ends = sorted(
        ((row.layer_a_id, row.layer_a_side), (row.layer_b_id, row.layer_b_side)),
        key=lambda end: (end[0].int, end[1]),
    )
    return (row.section_id, ends[0], ends[1])


def _rank(row: GeotechEdgeRow) -> tuple[int, int, int]:
    """Sort key for choosing the survivor — lower wins.

    Provenance first: a hand-drawn tie must still read ``manual`` after a
    divide, flagged or not — the flag is a question for the engineer, never a
    reason to discard his line.  Between two machine copies the unflagged one
    wins, because it is the freshly derived statement and the flag on the other
    belongs to a band generation that no longer exists.  The id breaks a true
    stalemate so a divide stays repeatable.
    """
    return (
        0 if row.source == "manual" else 1,
        0 if row.review_reason is None else 1,
        row.edge_id.int,
    )


def duplicate_edge_ids_to_drop(rows: list[GeotechEdgeRow]) -> list[UUID]:
    """Which rows to delete so each correlation is stored exactly once.

    Parameters
    ----------
    rows : list[GeotechEdgeRow]
        Every packing correlation on the geotech model.

    Returns
    -------
    list[UUID]
        The ids to delete, in the order the rows were given.  Empty when
        nothing is duplicated, which is the ordinary case and leaves the model
        untouched.
    """
    best: dict[tuple[UUID, tuple[UUID, str], tuple[UUID, str]], GeotechEdgeRow] = {}
    for row in rows:
        key = _identity(row)
        held = best.get(key)
        if held is None or _rank(row) < _rank(held):
            best[key] = row
    survivors = {row.edge_id for row in best.values()}
    return [row.edge_id for row in rows if row.edge_id not in survivors]


@dataclass(frozen=True)
class HopCandidate:
    """A correlation step 4 would like to write, before anything is written.

    Parameters
    ----------
    contact_a, contact_b : Hashable
        The two contacts it would join.  Opaque to this module, and the caller's
        key carries more than the layer: the SECTION, because correlations are
        section-scoped and a contact tied on one section must not block a hop on
        another; and the DIRECTION, because a contact legitimately ties left AND
        right — that is how a band spans a gap.  Both were measured on 2026-08-17
        by capping without them: model-wide keys blocked cross-section hops, and
        direction-blind keys left every borehole able to reach only one flank, so
        the chain CPT->BH->CPT could not close at all.
    jump_m : float
        How far apart the two contacts sit in depth.  Ranks competing
        candidates: both are guesses, and the flatter is the less extravagant
        one.
    cap_a, cap_b : bool
        Whether each contact is subject to the one-tie cap.  Only contacts on a
        column step 4 is DERIVING are — that is where it invents.  A CPT's
        contacts are step 2's business and are routinely tied both left and
        right, which is how a band spans a section; capping them refused every
        borehole hop in the model (measured 2026-08-17: nine integration
        scenarios lost their chain entirely).
    """

    contact_a: Hashable
    contact_b: Hashable
    jump_m: float
    cap_a: bool = True
    cap_b: bool = True


def hops_to_emit(candidates: Sequence[HopCandidate], *, taken_contacts: set[Hashable]) -> list[int]:
    """Which candidate hops may be written, given what is already correlated.

    Owner, 2026-08-17: *"put litho ties first, if a contact already has a tie it
    can't get a second tie for step 4"*.

    A contact is one surface of one band — a ``(layer, side)`` pair.  Step 4 was
    writing hops onto surfaces that already carried a correlation, his own or a
    litho restatement's, so the cap is one tie per contact and the machine's hop
    is what yields.  Seeding ``taken_contacts`` from the ties that already exist
    is what makes "litho first" true; nothing here deletes anything, because a
    hop that may not exist is simply never written.

    Ties the ENGINEER drew are never affected: two of his ties on one contact is
    how a band spans a section, and this function only ever declines to add.

    Parameters
    ----------
    candidates : Sequence[HopCandidate]
        The hops step 4 derived, in any order.
    taken_contacts : set[Hashable]
        Contacts already spoken for, keyed the same way as the candidates'.  MUTATED: each emitted hop claims its
        CAPPED contacts, so two candidates cannot both take one of them.

    Returns
    -------
    list[int]
        Indices into ``candidates``, ascending, of the hops to write.  Ordered
        by jump so that where two compete for a bare contact, the flatter one is
        the one that gets it.
    """
    order = sorted(range(len(candidates)), key=lambda i: (candidates[i].jump_m, i))
    emit: list[int] = []
    for index in order:
        candidate = candidates[index]
        capped = [
            contact
            for contact, capped_flag in (
                (candidate.contact_a, candidate.cap_a),
                (candidate.contact_b, candidate.cap_b),
            )
            if capped_flag
        ]
        if any(contact in taken_contacts for contact in capped):
            continue
        taken_contacts.update(capped)
        emit.append(index)
    return sorted(emit)


def hop_skips_a_column(
    left_along_m: float, right_along_m: float, banded_along_m: Sequence[float]
) -> bool:
    """Whether a column carrying the same body lies BETWEEN a hop's endpoints.

    Owner, 2026-08-17: *"especially when you look at the clay tie crossing a
    cpt, i didn't do that"*.  His model held exactly one tie over 200 m — B4's
    clay top to a CPT 284 m away — with four banded columns in between and no
    litho tie to restate.

    A hop asserts that two bands are the same surface across ONE gap.  With a
    column carrying that body in between, the assertion is not the engine's to
    make: that column is evidence, and it was not consulted.

    Parameters
    ----------
    left_along_m, right_along_m : float
        Along-section positions of the two endpoints, in either order.
    banded_along_m : Sequence[float]
        Along-positions of every column carrying this body on the section,
        endpoints included — being one of the two joined does not count as
        being between them.

    Returns
    -------
    bool
        ``True`` when at least one such column lies strictly between.
    """
    low, high = sorted((left_along_m, right_along_m))
    return any(low < along < high for along in banded_along_m)
