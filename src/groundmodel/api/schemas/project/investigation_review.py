"""Pydantic schemas for the investigation_review API surface.

Per-(project, investigation) decisions: review status, notes, hidden
flag. The polymorphic target is captured at create time and is NOT
mutable — moving a decision from one investigation to another is a
delete + recreate, not a patch.

Allowed enum values are duplicated here from the repository module on
purpose: the API layer needs to declare them in its own contract, and
the repo's ``ALLOWED_*`` sets are the single source of truth for value
validation. Keep both lists in sync — the integration tests will fail
loudly if they drift.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirrors the repository's ALLOWED_* sets + the DB CHECK constraints.
ReviewTargetKind = Literal["cpt", "borehole"]
ReviewStatus = Literal["unreviewed", "in_progress", "reviewed"]


class InvestigationReviewUpsertRequest(BaseModel):
    """Body of ``PUT /projects/{pid}/reviews/{target_kind}/{target_id}``.

    Upsert by target — the canonical pattern for review decisions. The
    UI doesn't track review row ids; it knows which investigation it's
    annotating. Status defaults to ``reviewed`` so a one-click
    "mark reviewed" action sends a minimal body.

    Sending only fields you want to change works — keys not present
    leave the existing row untouched. New rows take defaults.
    """

    review_status: ReviewStatus | None = None
    review_notes: str | None = None
    is_hidden: bool | None = None


class InvestigationReviewResponse(BaseModel):
    """Shape returned by every review endpoint."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    target_kind: ReviewTargetKind
    target_id: UUID
    review_status: ReviewStatus
    review_notes: str | None
    reviewed_at: datetime | None
    is_hidden: bool
    created_at: datetime
    updated_at: datetime


class ProjectViewStatePatchRequest(BaseModel):
    """Body of ``PATCH /projects/{pid}/view-state``.

    Merge semantics — each key in the body is shallowly merged into the
    project's ``view_state`` dict. Sending ``{"dem_overlay": {...}}``
    overwrites the dem_overlay key without touching siblings like
    ``hidden_cpt_types``. Pass ``null`` for a key to remove it.

    Schema-less JSONB at the DB layer; the keys are documented here for
    callers. Add a new toggle by writing a key — no migration.
    """

    # Project-level view toggles. Free-form keys; the dict is opaque at
    # the API layer. Pydantic enforces only that the body is a dict.
    patch: dict[str, object] = Field(default_factory=dict)
