"""Pydantic schema: :class:`SeedLithoFromParentRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SeedLithoFromParentRequest(StrictRequestModel):
    """Request body for the seed-litho-from-parent endpoint.

    Attributes
    ----------
    borehole_ids : list[UUID]
        In-corridor borehole ids to copy contacts for.  Typically the
        boreholes projected onto the active cross-section.  An empty list
        means "no boreholes in scope" and the endpoint returns immediately
        with zero created contacts.
    section_id : UUID or None
        When provided, the endpoint unions ``created_contact_ids ∪
        found_contact_ids`` and PATCHes the section's
        ``seeded_formation_contact_ids`` (explicit-content invariant).
        Omit when calling outside the Sections stage.
    """

    borehole_ids: list[UUID] = Field(
        default_factory=list,
        description="In-corridor borehole ids to copy contacts for.",
    )
    section_id: UUID | None = Field(
        default=None,
        description="Optional section whose seeded set to extend.",
    )
