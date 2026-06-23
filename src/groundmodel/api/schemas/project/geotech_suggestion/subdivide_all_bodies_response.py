"""Pydantic schema: :class:`SubdivideAllBodiesResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class SubdivideAllBodiesResponse(BaseModel):
    """Response of ``POST .../geotech/subdivide-all-bodies``.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model used (created by an earlier ``geotech/build``
        call or reused when it already exists).
    created_formation_ids : list[UUID]
        Classified geotech ``geological_formation`` rows created in this call.
        Find-or-create is DB-backed, so a re-run returns only newly created
        rows; formations created in a prior run are reused and not listed here.
    layer_count : int
        Total ``litho_layer`` rows inserted into the geotech model for the
        in-corridor investigations.
    body_count : int
        Total ``BodyOrm`` rows created after the resolver runs, i.e. the
        number of distinct spatial geotech bodies across the section corridor.
    split_body_count : int
        Number of body groups that received a consistent multi-band split
        (B-policy: the CPT profiles agreed on more than one NAD class band).
    one_class_body_count : int
        Number of body groups assigned one representative NAD class
        (inconsistent CPT profiles → thickness-dominant single class).
    borehole_only_count : int
        Number of body groups that were borehole-only (no CPT qc data →
        one skeleton sub-body with ``nad_class=None``).
    """

    geotech_model_id: UUID = Field(
        ...,
        description="The geotechnical model used (created or reused).",
    )
    created_formation_ids: list[UUID] = Field(
        ...,
        description="Classified geotech geological_formation rows created in this call.",
    )
    layer_count: int = Field(
        ...,
        description="Total litho_layer rows inserted into the geotech model.",
    )
    body_count: int = Field(
        ...,
        description="Total BodyOrm rows created after resolution.",
    )
    split_body_count: int = Field(
        ...,
        description="Body groups that received a consistent multi-band split.",
    )
    one_class_body_count: int = Field(
        ...,
        description="Body groups assigned one representative NAD class.",
    )
    borehole_only_count: int = Field(
        ...,
        description="Body groups that were borehole-only (no CPT qc data).",
    )
