"""Pydantic schema: :class:`AcceptGeotechRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.geotech_suggestion.accept_geotech_segment_item import (
    AcceptGeotechSegmentItem,
)


class AcceptGeotechRequest(BaseModel):
    """Body of ``POST .../contacts/accept-geotech-suggestions``.

    Parameters
    ----------
    section_id : UUID
        The cross-section the suggestions were produced for.  Carried for
        logging symmetry; the accept itself is keyed on the per-segment
        ``[top, base)`` depth ranges.
    segments : list[AcceptGeotechSegmentItem]
        The accepted segments and their accepted NAD sub-units.
    """

    section_id: UUID
    segments: list[AcceptGeotechSegmentItem] = []
