"""A pick that does not fit its neighbours."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.pick_observation import PickObservation


@dataclass(frozen=True)
class PickFlag:
    """One flagged pick with the evidence the engineer needs.

    Attributes
    ----------
    pick : PickObservation
        The flagged pick.
    predicted_elevation_m : float
        Leave-one-out guess from the other picks (m TAW).
    sigma_m : float
        Standard deviation of (pick - guess), including the pick's own noise (m).
    z_score : float
        ``(pick - guess) / sigma``.
    nearest : PickObservation
        The closest other pick of the same formation.
    nearest_distance_m : float
        Horizontal distance to ``nearest`` (m).
    """

    pick: PickObservation
    predicted_elevation_m: float
    sigma_m: float
    z_score: float
    nearest: PickObservation
    nearest_distance_m: float
