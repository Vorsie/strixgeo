"""Pydantic schema: :class:`GeotechSegmentSuggestionItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.geotech_suggestion.geotech_ghost_sub_unit_item import (
    GeotechGhostSubUnitItem,
)


class GeotechSegmentSuggestionItem(BaseModel):
    """Wire representation of suggested sub-units for one geo-bounded skeleton segment.

    Maps
    :class:`~groundmodel.application.suggest_geotech_subdivision.GeotechSegmentSuggestion`
    to JSON.

    Parameters
    ----------
    segment_top_m : float
        The skeleton contact's ``depth_top_m`` — top of this segment.
    segment_base_m : float
        Base depth inferred from the next contact or investigation total depth.
    source_litho_formation_id : UUID
        The litho formation the skeleton contact's formation inherits from.
    source_geo_formation_id : UUID | None
        The geological formation the segment sits within.
    ghost_sub_units : list[GeotechGhostSubUnitItem]
        Suggested NAD sub-units — one or more per segment.
    """

    segment_top_m: float
    segment_base_m: float
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None
    ghost_sub_units: list[GeotechGhostSubUnitItem]
