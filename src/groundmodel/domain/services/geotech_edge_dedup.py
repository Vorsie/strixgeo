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

from dataclasses import dataclass
from uuid import UUID

__all__ = [
    "GeotechEdgeRow",
    "duplicate_edge_ids_to_drop",
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
