"""Pydantic schema: :class:`GapValidationResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from .gap_issue_response import GapIssueResponse


class GapValidationResponse(BaseModel):
    """Body returned by ``GET /projects/{pid}/geology/models/{mid}/boreholes/{bid}/validate``.

    Empty ``issues`` ⇒ contacts form a clean contiguous stratigraphy.
    Any non-empty list is a soft warning — the editor decides whether
    to block save.
    """

    model_id: UUID
    borehole_id: UUID
    issues: list[GapIssueResponse] = Field(default_factory=list)
