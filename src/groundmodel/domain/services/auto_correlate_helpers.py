"""Shared helpers for the auto-correlate algorithms.

These helpers were originally defined inline in ``auto_correlate.py``
(formation-level, #127).  Phase 2+3 of #133 extracts them so the new
contact-level algorithm (``auto_correlate_contact_edges.py``) can reuse
them without depending on the formation-level module — which is being
removed in this same slice.

The module is pure: no I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar
from uuid import UUID

T = TypeVar("T")


@dataclass(frozen=True)
class _CandidatePair:
    """One within-window candidate between two formations at different columns.

    Attributes
    ----------
    formation_a_id : UUID
        The formation at column A.
    formation_b_id : UUID
        The formation at column B.
    depth_a : float
        Depth of the contact at column A (metres).
    depth_b : float
        Depth of the contact at column B (metres).
    residual : float
        Absolute depth residual |depth_b - predicted_b|.
    """

    formation_a_id: UUID
    formation_b_id: UUID
    depth_a: float
    depth_b: float
    residual: float


def _mnn_by_id(
    items: list[T],
    *,
    key_a: Callable[[T], UUID],
    key_b: Callable[[T], UUID],
    residual: Callable[[T], float],
) -> list[T]:
    """Mutual-nearest-neighbour reduction over an arbitrary item list.

    Generic core: callers project each item to (id_a, id_b, residual) via
    key callables.  An item survives iff each endpoint's lowest-residual
    candidate is this item and no other item with the same endpoint has a
    lower residual.  Ties are broken deterministically by the OPPOSITE
    endpoint's UUID ordering.

    Parameters
    ----------
    items : list[T]
        Pre-filtered candidate items (the caller has already applied
        per-pair gates such as depth window and distance threshold).
    key_a, key_b : Callable[[T], UUID]
        Project an item to its two endpoint ids.  Order between the two
        is irrelevant (MNN is symmetric).
    residual : Callable[[T], float]
        Lower-is-better scoring function.

    Returns
    -------
    list[T]
        The MNN survivors, in the input order.
    """
    best_by_a: dict[UUID, T] = {}
    best_by_b: dict[UUID, T] = {}
    for item in items:
        a, b, r = key_a(item), key_b(item), residual(item)
        cur_a = best_by_a.get(a)
        if cur_a is None or (residual(cur_a), key_b(cur_a)) > (r, b):
            best_by_a[a] = item
        cur_b = best_by_b.get(b)
        if cur_b is None or (residual(cur_b), key_a(cur_b)) > (r, a):
            best_by_b[b] = item
    survivors: list[T] = []
    for item in items:
        a, b = key_a(item), key_b(item)
        if best_by_a.get(a) is item and best_by_b.get(b) is item:
            survivors.append(item)
    return survivors


def _mutual_nearest_neighbour(
    candidates: list[_CandidatePair],
) -> list[_CandidatePair]:
    """Formation-level MNN wrapper — delegates to ``_mnn_by_id``.

    Reduce candidates to mutually-nearest-neighbour pairs.  For each
    formation on column A, find the candidate on column B with the
    smallest residual.  For each formation on column B, find the
    candidate on column A with the smallest residual.  Accept only pairs
    where both sides nominate each other.

    Parameters
    ----------
    candidates : list[_CandidatePair]
        All within-window candidate pairs for a single (group, column-pair).

    Returns
    -------
    list[_CandidatePair]
        Deduplicated list of mutually-nearest pairs.  At most one pair per
        formation id on either side.
    """
    return _mnn_by_id(
        candidates,
        key_a=lambda c: c.formation_a_id,
        key_b=lambda c: c.formation_b_id,
        residual=lambda c: c.residual,
    )


# Public alias — the underscore-prefixed names are kept as the canonical
# spelling for parity with the original inline definitions in
# auto_correlate.py.  ``mutual_nearest_neighbour`` (no leading underscore)
# is the preferred public import going forward.
mutual_nearest_neighbour = _mutual_nearest_neighbour
