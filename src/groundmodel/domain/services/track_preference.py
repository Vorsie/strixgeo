"""Which track of a kind the consumers use when a borehole carries several.

Rule (session main, 2026-09-29): "the manual one wins if present, else the
newest edited, else today's rule". Today's rule is the first observation of the
kind in the order the caller passes - ``BoreholeOrm.observations`` is ordered by
``observation_date``, so that is the first-dated one.

ONE helper for every consumer: the borehole detail response is ordered with
:func:`order_by_track_preference` (so the renderer's first-match lookups - the
section columns, the borelog - find the winner), and the backend consumers
(stratigraphy bridge / scan / auto-populate, the litho suggester) call
:func:`preferred_track`. Pure: works on any object carrying
``observation_type``, ``source`` and ``edited_manually_at``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from typing import Any, Protocol, TypeVar

from groundmodel.domain.value_objects.track_source import TrackSource


class _TrackLike(Protocol):
    """Structural shape of an observation row / response the ranking reads."""

    observation_type: Any
    source: Any
    edited_manually_at: datetime | None


T = TypeVar("T", bound=_TrackLike)


def _rank(track: _TrackLike) -> tuple[int, float]:
    """Sort key: manual first, then edited (newest first), then untouched.

    The untouched rank's second element is constant so ``sorted`` (stable)
    keeps today's date order among them. An object without the provenance
    attributes (a pre-2026-09-29 stand-in, a test double) reads as an
    untouched import - hence ``getattr`` with a default.
    """
    edited_at: datetime | None = getattr(track, "edited_manually_at", None)
    stamp = -edited_at.timestamp() if edited_at is not None else 0.0
    if getattr(track, "source", None) == TrackSource.MANUAL.value:
        return (0, stamp)
    if edited_at is not None:
        return (1, stamp)
    return (2, 0.0)


def preferred_track(
    tracks: Iterable[T],
    kind: str,
    *,
    require: Callable[[T], bool] | None = None,
) -> T | None:
    """Return the track of ``kind`` the consumers should use, or None.

    Parameters
    ----------
    tracks : Iterable[T]
        A borehole's observations in today's order (``observation_date``).
    kind : str
        The ``observation_type`` value to pick.
    require : Callable[[T], bool] | None
        Optional extra filter applied BEFORE ranking (e.g. "has layers").

    Returns
    -------
    T | None
        The manual track if any (newest edit first), else the newest edited
        import, else the first untouched one; None when no track matches.
    """
    candidates = [
        t for t in tracks if t.observation_type == kind and (require is None or require(t))
    ]
    if not candidates:
        return None
    return sorted(candidates, key=_rank)[0]


def order_by_track_preference(tracks: Sequence[T]) -> list[T]:
    """Reorder ``tracks`` so each kind's preferred track comes first.

    Kinds keep the position of their first appearance; within a kind the
    tracks follow :func:`preferred_track`'s ranking, stable otherwise.

    Parameters
    ----------
    tracks : Sequence[T]
        A borehole's observations in today's order.

    Returns
    -------
    list[T]
        The same objects, reordered.
    """
    kind_order: dict[str, int] = {}
    for track in tracks:
        kind_order.setdefault(track.observation_type, len(kind_order))
    return sorted(tracks, key=lambda t: (kind_order[t.observation_type], *_rank(t)))
