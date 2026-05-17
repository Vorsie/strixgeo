"""Pydantic schema: :class:`CrossingValidationResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from .gap_issue_response import GapIssueResponse


class CrossingValidationResponse(BaseModel):
    """Body returned by ``GET /projects/{pid}/geology/models/{mid}/validate/crossings``.

    Empty ``issues`` ⇒ no two formation surfaces violate the
    stratigraphic-order superposition rule. Any non-empty list is a
    geological warning — the editor surfaces them as inline banners
    pointing at the offending formation pair.
    """

    model_id: UUID
    issues: list[GapIssueResponse] = Field(default_factory=list)
