"""Pydantic schemas: clear one investigation's geotech packing bands."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class ClearGeotechColumnRequest(StrictRequestModel):
    """Clear ONE test's subdivision (owner ask 2026-08-18).

    Attributes
    ----------
    investigation_id : UUID
        The CPT or borehole whose geotech bands are deleted. Its ties cascade;
        no tombstones are written — this is rebuild preparation.
    """

    investigation_id: UUID = Field(..., description="The CPT or borehole to clear.")


class ClearGeotechColumnResponse(BaseModel):
    """What one clear removed.

    Attributes
    ----------
    geotech_model_id : UUID
        The model the column was cleared in.
    investigation_id : UUID
        The cleared CPT or borehole.
    deleted_band_count : int
        Band rows deleted; 0 = the column carried none (idempotent no-op).
    """

    geotech_model_id: UUID
    investigation_id: UUID
    deleted_band_count: int
