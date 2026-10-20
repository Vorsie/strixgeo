"""Digest of a formation's picks: the cache key of the pick consistency check."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

from groundmodel.domain.value_objects.pick_observation import PickObservation


def pick_observation_digest(picks: Sequence[PickObservation]) -> str:
    """Return a SHA-256 over the picks, independent of their order.

    Parameters
    ----------
    picks : Sequence[PickObservation]
        The formation's picks.

    Returns
    -------
    str
        Hex digest; changes when any pick moves by 0.1 mm or more.
    """
    digest = hashlib.sha256()
    # Sorted by contact id so the order the repository returns does not matter;
    # elevations at 0.1 mm, positions at 1 mm: finer than any pick is made.
    for p in sorted(picks, key=lambda q: q.contact_id):
        digest.update(
            f"{p.contact_id}|{p.x_m:.3f}|{p.y_m:.3f}|{p.elevation_m:.4f}|{p.noise_floor_m:.3f}\n".encode()
        )
    return digest.hexdigest()
