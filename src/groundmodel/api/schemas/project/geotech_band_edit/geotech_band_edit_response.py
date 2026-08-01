"""Pydantic schema: :class:`GeotechBandEditResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.project.geotech_band_edit.geotech_band_edit_plan_response import (
    GeotechBandEditPlanResponse,
)


class GeotechBandEditResponse(BaseModel):
    """Result of a committed split or merge.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model that was written.
    investigation_id : UUID
        The single column that changed — recalculation is local, so no other
        column's classes moved.
    plan : GeotechBandEditPlanResponse
        What was committed (same shape as the preview), so the UI can show the
        realised consequence without a second round-trip.
    layer_ids : list[UUID]
        The resulting band rows, top to bottom.
    created_layer_ids : list[UUID]
        Rows inserted by this edit.
    deleted_layer_ids : list[UUID]
        Rows removed by this edit.
    deleted_edge_ids : list[UUID]
        Correlations dropped because the re-derived class no longer matches
        their partner (plus, on a merge, those that cascaded away with the
        absorbed band).
    """

    geotech_model_id: UUID = Field(..., description="The geotechnical model written.")
    investigation_id: UUID = Field(..., description="The only column that changed.")
    plan: GeotechBandEditPlanResponse = Field(..., description="What was committed.")
    layer_ids: list[UUID] = Field(default_factory=list, description="Resulting band rows.")
    created_layer_ids: list[UUID] = Field(default_factory=list, description="Rows inserted.")
    deleted_layer_ids: list[UUID] = Field(default_factory=list, description="Rows removed.")
    deleted_edge_ids: list[UUID] = Field(default_factory=list, description="Correlations dropped.")
