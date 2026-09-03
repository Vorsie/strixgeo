"""Pydantic schema: :class:`LithoSuggestionRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.domain.services.robertson_2015_constants import (
    DEFAULT_GUNSAT_KNM3,
    DEFAULT_GWATER_KNM3,
    GUNSAT_KNM3_MAX,
    GUNSAT_KNM3_MIN,
    GWATER_KNM3_MAX,
    GWATER_KNM3_MIN,
)


class LithoSuggestionRequest(StrictRequestModel):
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
        Minimum layer thickness the segmenter will output (default 0.15 m;
        range 0.05–10.0 m). 0.15 m matches typical CPT measurement
        sampling resolution — finer would be measurement noise; coarser
        was missing thin clay drapes in the dogfeed (2026-05-23).
    gunsat_kNm3 : float
        Unit weight above the water table (CPT path only; default 16 kN/m³).
    gwater_kNm3 : float
        Unit weight of water (CPT path only; default 9.81 kN/m³).
    dr_compression_factor : float
        Sand relative-density compression factor (CPT path only;
        default 0.675 = average quartz sand).
    merge_same_lithology : bool
        When ``True`` (default per owner directive 2026-05-25), run the
        same-lithology merge pass so adjacent sand-on-sand / clay-on-clay
        segments collapse into a single layer.  Applies to both the CPT
        path (after Robertson-SBT segmentation) and the borehole path
        (after DOV hoofdnaam → lithology mapping).  Set to ``False`` to
        see the un-merged splits (useful for diagnosing packing-density
        boundaries or individual observation-layer sequences).
    use_normalised_qc : bool
        CPT path only.  When ``True`` (default), classify with the stress-
        NORMALISED Robertson 2015 pipeline (Qtn / F / Ic).  When ``False``,
        use the NON-normalised Robertson 2010 I_SBT index (qc/pa + Rf) — no
        stress profile or groundwater needed, appropriate at shallow depth or
        when the effective-stress profile is unreliable.  Ignored on the
        borehole path.  In non-normalised mode Dr / NAD packing are left blank
        (relative density needs effective stress).
    """

    cpt_id: UUID | None = None
    borehole_id: UUID | None = None
    minimum_layer_thickness_m: float = Field(default=0.15, ge=0.05, le=10.0)
    # Defaults + bounds come from the domain constants, NOT literals: the SBT
    # profile endpoint validates the same two numbers, and the whole point of
    # that endpoint is that it normalises exactly as this request does. Two
    # copies of "8.0 to 25.0" is one copy too many for a parity contract.
    gunsat_kNm3: float = Field(default=DEFAULT_GUNSAT_KNM3, ge=GUNSAT_KNM3_MIN, le=GUNSAT_KNM3_MAX)
    gwater_kNm3: float = Field(default=DEFAULT_GWATER_KNM3, ge=GWATER_KNM3_MIN, le=GWATER_KNM3_MAX)
    dr_compression_factor: float = Field(default=0.675, ge=0.1, le=2.0)
    # Owner directive 2026-05-25 (extended to borehole path 2026-05-25):
    # merge adjacent same-lithology segments by default for BOTH CPT and
    # borehole paths.  Set to False to inspect the un-merged segments
    # (useful for diagnosing packing-density boundaries before the Geotech
    # stage ships its own split gesture, or individual observation-layer
    # sequences on the borehole path).
    merge_same_lithology: bool = True
    # CPT path only — choose the non-normalised Robertson 2010 I_SBT classifier
    # (no stress profile / groundwater) over the default stress-normalised 2015
    # pipeline. Settings → Litho segmenter exposes this; the borehole path
    # ignores it.
    use_normalised_qc: bool = True

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> LithoSuggestionRequest:
        """Enforce XOR on cpt_id / borehole_id."""
        has_cpt = self.cpt_id is not None
        has_borehole = self.borehole_id is not None
        if has_cpt == has_borehole:  # both True or both False
            raise ValueError("Exactly one of 'cpt_id' or 'borehole_id' must be provided.")
        return self
