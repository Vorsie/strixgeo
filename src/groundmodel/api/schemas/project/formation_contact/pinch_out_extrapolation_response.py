"""Pydantic schema: :class:`PinchOutExtrapolationResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.cross_section import CrossSectionResponse


class PinchOutExtrapolationResponse(BaseModel):
    """Result returned by the pinch-out extrapolation endpoint.

    Attributes
    ----------
    created_contact_ids : list[UUID]
        The two synthetic ``FormationContact`` ids committed by the
        use case: the tip on the section line and its perpendicular
        twin (both have ``source='pinch_out_extrapolation'`` and
        ``confidence='low'``).
    tip_elevation_m : float
        Absolute elevation (m above datum) of the pinch-out tip.
    tip_along_m : float
        Distance along the section line (m from start) of the tip.
    updated_section : CrossSectionResponse | None
        Updated cross-section row after its ``seeded_formation_contact_ids``
        was extended to include the two new contacts.  Non-null when the
        seeding step succeeded; null when the section update failed
        (non-fatal — the contacts are already committed).
    """

    created_contact_ids: list[UUID]
    tip_elevation_m: float
    tip_along_m: float
    updated_section: CrossSectionResponse | None = None
