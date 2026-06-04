"""Shared helper for the auto-correlate algorithms.

Originally a set of inline helpers in ``auto_correlate.py`` (formation-level,
#127). That module is gone; the only surviving, live export is the generic
mutual-nearest-neighbour reducer ``_mnn_by_id``, consumed by the contact-level
algorithm (``auto_correlate_contact_edges.py``). The formation-level
``_CandidatePair`` DTO and its ``_mutual_nearest_neighbour`` wrapper were
removed once their only remaining caller was their own test.

The module is pure: no I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar
from uuid import UUID

T = TypeVar("T")


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
