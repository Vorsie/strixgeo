"""One formation's row in the pick consistency report."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.value_objects.formation_pick_check import FormationPickCheck


@dataclass(frozen=True)
class FormationConsistencyEntry:
    """A formation and its check (``None`` while computing).

    Attributes
    ----------
    formation_id : UUID
        The formation.
    formation_name : str
        Display name.
    n_picks : int
        Picks that feed the model.
    skipped_no_location : int
        Picks dropped for a missing position or ground elevation.
    check : FormationPickCheck or None
        The result, or ``None`` while the background computation runs.
    """

    formation_id: UUID
    formation_name: str
    n_picks: int
    skipped_no_location: int
    check: FormationPickCheck | None
