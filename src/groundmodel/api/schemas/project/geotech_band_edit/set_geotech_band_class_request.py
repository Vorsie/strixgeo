"""Pydantic schema: :class:`SetGeotechBandClassRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SetGeotechBandClassRequest(StrictRequestModel):
    """Set a BOREHOLE band's NAD packing class by hand (owner ask 2026-08-18).

    Attributes
    ----------
    band_id : UUID
        The borehole band to reclassify.
    nad_class : int
        The chosen NAD packing class (1–31); the server validates it against
        the band's own soil family.
    """

    band_id: UUID = Field(..., description="The borehole band to reclassify.")
    nad_class: int = Field(
        ...,
        ge=1,
        le=31,
        description="The chosen NAD packing class; validated against the band's soil.",
    )
