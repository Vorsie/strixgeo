"""The picks of one formation, ready for the pick consistency check."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.value_objects.pick_observation import PickObservation


@dataclass(frozen=True)
class FormationPicks:
    """Picks of one formation in one geological model.

    Attributes
    ----------
    formation_id : UUID
        The formation.
    formation_name : str
        Display name.
    display_order : int
        Stratigraphic order (higher = younger); used to sort the report top-down.
    picks : tuple[PickObservation, ...]
        Picks on tests that feed the model (same filter as the surfaces).
    skipped_no_location : int
        Picks dropped because their test has no position or ground elevation.
    """

    formation_id: UUID
    formation_name: str
    display_order: int
    picks: tuple[PickObservation, ...]
    skipped_no_location: int
