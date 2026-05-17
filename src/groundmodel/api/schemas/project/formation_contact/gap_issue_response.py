"""Pydantic schema: :class:`GapIssueResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class GapIssueResponse(BaseModel):
    """One item in a geology-validator response.

    Used by both the per-borehole no-gaps check (kinds:
    ``missing_surface_contact`` / ``duplicate_depth`` /
    ``contact_below_test`` / ``no_contacts``) and the cross-formation
    crossing check (kind: ``formation_crossing``). Per-borehole
    issues populate ``contact_ids``; crossing issues populate
    ``formation_ids`` as ``(older_id, younger_id)``.
    """

    kind: str
    detail: str
    depth_m: float | None = None
    contact_ids: list[UUID] = Field(default_factory=list)
    formation_ids: list[UUID] = Field(default_factory=list)
