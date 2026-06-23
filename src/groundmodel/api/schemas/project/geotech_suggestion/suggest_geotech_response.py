"""Pydantic schema: :class:`GeotechInvestigationSuggestionItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.geotech_suggestion.geotech_segment_suggestion_item import (
    GeotechSegmentSuggestionItem,
)


class GeotechInvestigationSuggestionItem(BaseModel):
    """Wire representation of all segment suggestions for one in-corridor investigation.

    Maps
    :class:`~groundmodel.application.suggest_geotech_subdivision.GeotechInvestigationSuggestion`
    to JSON.  The response body is a ``list[GeotechInvestigationSuggestionItem]``.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole this suggestion is for.
    is_cpt : bool
        ``True`` for CPT anchors (qc available), ``False`` for boreholes.
    segments : list[GeotechSegmentSuggestionItem]
        Ordered top-to-bottom segment suggestions.
    """

    investigation_id: UUID
    is_cpt: bool
    segments: list[GeotechSegmentSuggestionItem]
