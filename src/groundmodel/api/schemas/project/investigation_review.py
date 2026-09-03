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
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# Mirrors the repository's ALLOWED_* sets + the DB CHECK constraints.
ReviewTargetKind = Literal["cpt", "borehole"]
ReviewStatus = Literal["unreviewed", "in_progress", "reviewed"]


class InvestigationReviewUpsertRequest(StrictRequestModel):
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


class ProjectViewStatePatchRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{pid}/view-state``.

    **Shallow** merge semantics — each TOP-LEVEL key in the body
    replaces the same top-level key in the project's existing
    ``view_state`` dict. Siblings are left untouched. Pass ``null``
    for a key to remove it.

    Nested values are **not** deep-merged. To change one field inside
    a nested object, the caller must include the *whole* subtree:

    Example — set DEM opacity without disturbing other view_state:

        # Existing view_state on the server:
        # {"dem_overlay": {"enabled": true, "opacity": 0.5},
        #  "hidden_cpt_types": ["CPTM"]}

        # WRONG — clobbers dem_overlay.enabled:
        PATCH { "patch": {"dem_overlay": {"opacity": 0.7}} }
        # → view_state.dem_overlay becomes {"opacity": 0.7}, enabled gone.

        # RIGHT — replace the dem_overlay subtree as a whole:
        PATCH { "patch": {"dem_overlay": {"enabled": true, "opacity": 0.7}} }

    The trade-off is intentional: deep merge has surprising semantics
    around array fields (replace? append? dedup?) that the API can't
    decide for callers. Shallow + explicit is more predictable.

    Schema-less JSONB at the DB layer; the keys are documented here
    for callers. Add a new toggle by writing a key — no migration.
    """

    # Project-level view toggles. Free-form keys; the dict is opaque at
    # the API layer. Pydantic enforces only that the body is a dict.
    # ``Any`` matches the typing used elsewhere in the bundle layer
    # (project_bundle.py, project_response.view_state) — keeps the API
    # surface consistent for tooling that reads the OpenAPI schema.
    patch: dict[str, Any] = Field(default_factory=dict)
