"""Pydantic schema: :class:`CreateLithoLensRequest` and :class:`AbsentInvestigation`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AbsentInvestigation(BaseModel):
    """One investigation that shows positive evidence of lens absence.

    Parameters
    ----------
    kind : Literal['borehole', 'cpt']
        Discriminator matching ``litho_lens_absence.investigation_kind``.
    id : UUID
        Investigation id.  Must belong to the project (validated by the
        use case before inserting an absence record).
    """

    kind: Literal["borehole", "cpt"]
    id: UUID


class CreateLithoLensRequest(BaseModel):
    """Body of ``POST .../geology/models/{model_id}/lenses``.

    Atomically creates a :class:`LithoLens` row, records absence rows,
    tags present contacts with the lens id, and computes section-local
    wedge-tip synthetic contacts for each absent column.

    Parameters
    ----------
    parent_formation_id : UUID
        The lithostratigraphic formation this lens carves a body out of.
        Must belong to ``model_id``.
    section_id : UUID
        The cross-section used for wedge-tip geometry and for seeding the
        explicit-content invariant.
    name : str | None
        Optional human label (max 120 chars).  The UI falls back to a
        derived name ("Lens 1 in <formation>") when ``None``.
    present_contact_ids : list[UUID]
        Existing :class:`FormationContact` ids to tag with ``lens_id``.
        Every id must belong to ``parent_formation_id`` in ``model_id``
        (validated — 422 otherwise).
    absent_investigations : list[AbsentInvestigation]
        Investigations that show positive evidence of absence.  The use
        case records one :class:`LithoLensAbsence` row per entry and
        attempts a wedge-tip computation for each.
    """

    parent_formation_id: UUID
    section_id: UUID
    name: str | None = Field(default=None, max_length=120)
    present_contact_ids: list[UUID] = Field(default_factory=list)
    absent_investigations: list[AbsentInvestigation] = Field(default_factory=list)
