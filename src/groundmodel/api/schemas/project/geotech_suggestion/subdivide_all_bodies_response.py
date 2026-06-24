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
        Total ``litho_layer`` rows inserted into the geotech model across all
        model investigations (section-independent).
    body_count : int
        Total ``BodyOrm`` rows created after the resolver runs, i.e. the
        number of distinct spatial geotech bodies in the model.
    split_body_count : int
        Number of body groups that received a consistent multi-band split
        (B-policy: the CPT profiles agreed on more than one NAD class band).
    one_class_body_count : int
        Number of body groups assigned one representative NAD class
        (inconsistent CPT profiles → thickness-dominant single class).
    borehole_only_count : int
        Number of body groups that were borehole-only (no CPT qc data →
        skeleton sub-body, then extrapolated from nearest same-lithology CPT
        when one exists).
    extrapolated_borehole_count : int
        Number of borehole-only sub-bodies that were successfully extrapolated
        to a NAD class from the nearest same-lithology CPT.  Borehole sub-
        bodies that found no overlapping CPT retain ``nad_class=None``.
    section_count : int
        Number of project sections for which geotech correlation edges were
        derived from the litho model's approved edges.
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
    extrapolated_borehole_count: int = Field(
        0,
        description=(
            "Borehole-only sub-bodies extrapolated to a NAD class from the "
            "nearest same-lithology CPT."
        ),
    )
    section_count: int = Field(
        0,
        description="Project sections for which geotech edges were derived.",
    )
