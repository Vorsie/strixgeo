"""Pydantic schema: :class:`SeedLithoFromParentResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.cross_section import CrossSectionResponse


class SeedLithoFromParentResponse(BaseModel):
    """Result returned by the seed-litho-from-parent endpoint.

    Attributes
    ----------
    created_contact_ids : list[UUID]
        IDs of freshly-created ``FormationContact`` rows under the litho
        model.
    skipped_existing : int
        Number of (formation, borehole) pairs skipped because a contact
        already existed in the litho model (idempotency).
    updated_section : CrossSectionResponse or None
        Updated cross-section row after the endpoint PATCHed its
        ``seeded_formation_contact_ids``.  Non-null only when
        ``section_id`` was provided in the request.  The frontend patches
        local section state from this without a separate GET.
    """

    created_contact_ids: list[UUID]
    skipped_existing: int
    updated_section: CrossSectionResponse | None = None
