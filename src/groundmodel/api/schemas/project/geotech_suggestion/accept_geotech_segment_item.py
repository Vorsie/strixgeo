"""Pydantic schema: :class:`AcceptGeotechSegmentItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.geotech_suggestion.accept_geotech_sub_unit_item import (
    AcceptGeotechSubUnitItem,
)


class AcceptGeotechSegmentItem(BaseModel):
    """Wire representation of one accepted geo-bounded skeleton segment.

    Maps to
    :class:`~groundmodel.application.accept_geotech_suggestions.AcceptGeotechSegment`.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole this segment is anchored on.
    segment_top_m : float
        Top of the geo-bounded skeleton segment (= the original skeleton
        segment-top contact depth).
    segment_base_m : float
        Base of the segment (next skeleton contact top, or investigation total
        depth).  The half-open ``[top, base)`` range excludes the next
        segment's top.
    sub_units : list[AcceptGeotechSubUnitItem]
        Accepted sub-units within the segment, ordered top-to-bottom.
    """

    investigation_id: UUID
    segment_top_m: float
    segment_base_m: float
    sub_units: list[AcceptGeotechSubUnitItem] = []
