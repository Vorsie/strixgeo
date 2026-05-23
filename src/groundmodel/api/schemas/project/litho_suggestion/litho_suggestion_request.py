"""Pydantic schema: :class:`LithoSuggestionRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class LithoSuggestionRequest(BaseModel):
    """Body of ``POST .../contacts/suggest-litho``.

    Exactly one of ``cpt_id`` / ``borehole_id`` must be provided (XOR).
    The schema validator enforces this at the HTTP boundary (422 on
    violation) so the use case never receives an ambiguous request.

    Parameters
    ----------
    cpt_id : UUID | None
        Target CPT to segment.  Mutually exclusive with ``borehole_id``.
    borehole_id : UUID | None
        Target borehole to segment.  Mutually exclusive with ``cpt_id``.
    minimum_layer_thickness_m : float
        Minimum layer thickness the segmenter will output (default 0.5 m;
        range 0.05–10.0 m).
    gunsat_kNm3 : float
        Unit weight above the water table (CPT path only; default 16 kN/m³).
    gwater_kNm3 : float
        Unit weight of water (CPT path only; default 9.81 kN/m³).
    dr_compression_factor : float
        Sand relative-density compression factor (CPT path only;
        default 0.675 = average quartz sand).
    """

    cpt_id: UUID | None = None
    borehole_id: UUID | None = None
    minimum_layer_thickness_m: float = Field(default=0.5, ge=0.05, le=10.0)
    gunsat_kNm3: float = Field(default=16.0, ge=8.0, le=25.0)
    gwater_kNm3: float = Field(default=9.81, ge=9.0, le=10.5)
    dr_compression_factor: float = Field(default=0.675, ge=0.1, le=2.0)

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> LithoSuggestionRequest:
        """Enforce XOR on cpt_id / borehole_id."""
        has_cpt = self.cpt_id is not None
        has_borehole = self.borehole_id is not None
        if has_cpt == has_borehole:  # both True or both False
            raise ValueError("Exactly one of 'cpt_id' or 'borehole_id' must be provided.")
        return self
