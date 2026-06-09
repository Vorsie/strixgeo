"""Response schema for batch cross-section creation."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.cross_section import CrossSectionResponse


class BatchCreateSectionsResponse(BaseModel):
    """The created sections returned in request order.

    Parameters
    ----------
    sections : list[CrossSectionResponse]
        One response entry per submitted section, in the same order as the
        request list.  Empty when the request contained an empty list.
    """

    sections: list[CrossSectionResponse]
