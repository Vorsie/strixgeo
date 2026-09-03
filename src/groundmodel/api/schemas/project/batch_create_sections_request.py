"""Request schema for batch cross-section creation."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.project.cross_section import CrossSectionCreateRequest
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class BatchCreateSectionsRequest(StrictRequestModel):
    """A list of cross-sections to create in a single transaction.

    Parameters
    ----------
    sections : list[CrossSectionCreateRequest]
        The sections to create; each validated exactly as a single create.
        An empty list is allowed (creates nothing, returns an empty response).
    """

    sections: list[CrossSectionCreateRequest] = Field(default_factory=list)
