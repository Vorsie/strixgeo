"""Pydantic schema: :class:`AcceptLithoSuggestionsResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.cross_section import CrossSectionResponse


class AcceptLithoSuggestionsResponse(BaseModel):
    """Body of ``POST .../contacts/accept-litho-suggestions``.

    Parameters
    ----------
    created_formation_ids : list[UUID]
        Litho ``GeologicalFormation`` rows created in this call.
    found_formation_ids : list[UUID]
        Litho formation rows that already existed and were re-used
        (idempotent re-accept).
    created_contact_ids : list[UUID]
        ``FormationContact`` rows newly inserted.
    found_contact_ids : list[UUID]
        ``FormationContact`` rows that already existed (idempotent path).
    updated_section : CrossSectionResponse | None
        The refreshed section row after its ``seeded_formation_contact_ids``
        was extended, or ``None`` when no ``section_id`` was provided.
    """

    created_formation_ids: list[UUID]
    found_formation_ids: list[UUID]
    created_contact_ids: list[UUID]
    found_contact_ids: list[UUID]
    updated_section: CrossSectionResponse | None = None
