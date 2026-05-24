"""Pydantic schema: :class:`UpsertFormationAbsenceRequest` and response."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class UpsertFormationAbsenceRequest(BaseModel):
    """Body of ``POST .../formations/{formation_id}/absences``.

    Records a user-intent absence for a formation at a specific investigation.
    The ``source`` must be ``'manual'`` or ``'observed'``; ``'inferred'`` is
    the engine's domain and is rejected by the use case.

    Parameters
    ----------
    investigation_id : UUID
        The borehole or CPT that lacks this formation.
    investigation_kind : Literal['borehole', 'cpt']
        Discriminator.
    source : Literal['manual', 'observed']
        User intent source.  ``'manual'`` = user confirmed / created the
        absence.  ``'observed'`` = user recorded direct field observation.
    """

    investigation_id: UUID
    investigation_kind: Literal["borehole", "cpt"]
    source: Literal["manual", "observed"]


class UpsertFormationAbsenceResponse(BaseModel):
    """Response of ``POST .../formations/{formation_id}/absences``.

    Attributes
    ----------
    absence_id : UUID
        The ``FormationAbsenceOrm`` row id (new or updated).
    was_created : bool
        ``True`` when a new row was inserted; ``False`` when an existing
        row's source was updated.
    """

    absence_id: UUID
    was_created: bool
