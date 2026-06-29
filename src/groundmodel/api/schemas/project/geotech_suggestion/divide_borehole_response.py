"""Pydantic schema: :class:`DivideBoreholeResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class DivideBoreholeResponse(BaseModel):
    """Response of ``POST .../geotech/divide-boreholes``.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model that was updated.
    divided_borehole_count : int
        Number of borehole columns that received ≥ 2 TIN-divided packing bands.
    single_band_borehole_count : int
        Number of borehole columns assigned a single band (no CPT split surfaces
        in their body group, or all splits clamped out of the geo extent).
    layer_count : int
        Total ``litho_layer`` rows inserted for boreholes in this call.
    created_formation_ids : list[UUID]
        Geotech ``geological_formation`` rows created in this call (find-or-create;
        a re-run lists only rows not already in the DB from a prior SAB or
        DivideBoreholes run).
    """

    geotech_model_id: UUID = Field(
        ...,
        description="The geotechnical model that was updated.",
    )
    divided_borehole_count: int = Field(
        ...,
        description="Borehole columns that received ≥ 2 TIN-divided packing bands.",
    )
    single_band_borehole_count: int = Field(
        ...,
        description=(
            "Borehole columns assigned a single band (no CPT split surfaces in their body group)."
        ),
    )
    layer_count: int = Field(
        ...,
        description="Total litho_layer rows inserted for boreholes.",
    )
    created_formation_ids: list[UUID] = Field(
        default_factory=list,
        description="Newly created geotech geological_formation rows.",
    )
