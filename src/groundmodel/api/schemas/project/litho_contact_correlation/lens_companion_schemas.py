"""Schemas for POST .../lens-companions/materialise (#133 Phase 2)."""

from __future__ import annotations

from pydantic import BaseModel


class MaterialiseLensCompanionsResponse(BaseModel):
    """Response body for the lens-companions materialise endpoint.

    Attributes
    ----------
    companion_sections_created : int
        Number of perpendicular companion sections successfully created.
    skipped_no_primary : int
        Lenses skipped because ``LithoLensOrm.primary_section_id`` is
        ``None`` or the section row has been deleted.
    skipped_unfinished_section : int
        Lenses skipped because at least one seeded contact on the primary
        section lacks a ``user_approved=True`` outbound edge.
    errored : int
        Lenses where ``CreatePerpendicularCompanion`` raised an exception.
        The loop continues past each error; ``errored > 0`` warrants
        investigation but does not block the other lenses.
    """

    companion_sections_created: int
    skipped_no_primary: int
    skipped_unfinished_section: int
    errored: int
