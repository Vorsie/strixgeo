"""Pydantic schema: :class:`LithoLayerSuggestionItem`."""

from __future__ import annotations

from pydantic import BaseModel, Field

from groundmodel.domain.services.litho_constants import BaseLithology
from groundmodel.domain.services.litho_segmentation import SuggestionConfidence


class LithoLayerSuggestionItem(BaseModel):
    """One suggested lithostratigraphic layer from the segmenter.

    Parameters
    ----------
    depth_top_m : float
        Top of the layer in metres below ground surface.
    depth_base_m : float
        Base of the layer in metres below ground surface.
    suggested_lithology : BaseLithology
        Base lithology token (ZAND / KLEI / SILT / GRIND / VEEN).
    suggested_nad_class : int | None
        NAD packing class 5–8 for clean-sand layers inferred from Dr.
        ``None`` for all other lithologies (admixture/silt-clayey classes
        require borehole confirmation and are not inferred from CPT alone).
    mean_qc_mpa : float | None
        Mean cone resistance over the layer (raw, unsmoothed).
        ``None`` for borehole-path suggestions.
    dr_pct : float | None
        Mean relative density over the layer for clean-sand layers.
        ``None`` when the layer is not clean sand.
    confidence : SuggestionConfidence
        Segmenter confidence: HIGH (thick, stable zone) / MEDIUM / LOW
        (thin run that survived greedy-merge).
    source : str
        Provenance: ``"cpt_robertson_2015"`` or ``"borehole_observation"``.
    """

    depth_top_m: float = Field(ge=0.0)
    depth_base_m: float = Field(gt=0.0)
    suggested_lithology: BaseLithology
    suggested_nad_class: int | None = Field(default=None, ge=1, le=31)
    mean_qc_mpa: float | None = None
    dr_pct: float | None = None
    confidence: SuggestionConfidence
    source: str
