"""Pydantic schema: :class:`LithoSuggestionResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from .litho_layer_suggestion_item import LithoLayerSuggestionItem


class LithoSuggestionResponse(BaseModel):
    """Body of ``POST .../contacts/suggest-litho``.

    Wraps the list of suggested layers with the investigation identifier and
    the minimum-layer-thickness parameter that was used, so the client can
    re-request with a different threshold without losing the original context.

    Parameters
    ----------
    investigation_type : str
        ``"cpt"`` or ``"borehole"`` — discriminates which data source was used.
    minimum_layer_thickness_m : float
        The threshold that was applied (echoed from the request).
    layers : list[LithoLayerSuggestionItem]
        Suggested layers ordered top to bottom.  Empty list when the
        segmenter produced no output (e.g. all points undefined, or the
        series is too short).
    """

    investigation_type: str
    minimum_layer_thickness_m: float
    layers: list[LithoLayerSuggestionItem]
