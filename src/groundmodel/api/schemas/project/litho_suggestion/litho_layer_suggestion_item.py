"""Pydantic schema: :class:`LithoLayerSuggestionItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.shared.constants.litho_constants import BaseLithology
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence


class AdmixtureItem(BaseModel):
    """Secondary soil component within a suggested litho layer.

    Mirrors :class:`groundmodel.domain.value_objects.admixture.Admixture`
    at the API boundary.

    Parameters
    ----------
    soil_code : str
        DOV vocabulary code (e.g. ``"KL"`` for clay, ``"GL"`` for glauconite).
    amount : str
        Amount qualifier (e.g. ``"Z"`` = weak, ``"M"`` = medium, ``"S"`` =
        strong).  Empty string when unspecified.
    locally : bool
        ``True`` when the admixture is only locally present within the interval.
    """

    soil_code: str
    amount: str = ""
    locally: bool = False


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
    suggested_admixtures : list[AdmixtureItem]
        Secondary soil components aggregated from the contributing observation
        layers (borehole path only; empty for CPT suggestions).  Populated by
        the ``AcceptLithoSuggestions`` use case via the ``_aggregate_admixtures``
        heuristic (debt #66 — >50% thickness-weighted majority).
    parent_formation_id : UUID | None
        Id of the geological formation this litho suggestion falls within.
        ``None`` when the parent geology model has no surfaces or the
        investigation has no geology contacts.
    spans_boundary : bool
        ``True`` when the suggestion's depth interval crosses a geological-
        formation boundary (i.e. it would be split into two contacts on
        Accept).  The frontend renders such layers with an amber border/
        tooltip to warn the engineer.
    """

    depth_top_m: float = Field(ge=0.0)
    depth_base_m: float = Field(gt=0.0)
    suggested_lithology: BaseLithology
    suggested_nad_class: int | None = Field(default=None, ge=1, le=31)
    mean_qc_mpa: float | None = None
    dr_pct: float | None = None
    confidence: SuggestionConfidence
    source: str
    # Phase 1 additions — all optional/defaulted so existing clients
    # (pre-Phase-1 callers that don't send these fields) stay compatible.
    suggested_admixtures: list[AdmixtureItem] = Field(default_factory=list)
    parent_formation_id: UUID | None = None
    spans_boundary: bool = False
