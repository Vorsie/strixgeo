"""Pydantic schemas for the geological-model API surface."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel
from groundmodel.shared.constants.model_kind import ModelKind


class GeologicalModelCreateRequest(StrictRequestModel):
    """Body of ``POST /projects/{id}/geology/models``.

    A project can have multiple interpretation models. ``is_active``
    defaults to False — call ``POST .../models/{id}/activate`` to flip
    the active flag (which clears it on every SAME-KIND sibling).

    ``kind`` selects the hierarchy level (default ``geological``).
    ``parent_model_id`` is required for non-geological
    kinds (a lithostratigraphic model refines a geological one; a
    geotechnical model refines a lithostratigraphic one) and is
    rejected for ``geological`` — enforced at the endpoint, 422 on
    violation. ``kind``/parent are immutable post-create (no PATCH).
    """

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    is_active: bool = False
    excluded_borehole_ids: list[UUID] = Field(default_factory=list)
    kind: ModelKind = "geological"
    parent_model_id: UUID | None = None


class GeologicalModelUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{id}/geology/models/{mid}``.

    ``is_active`` is intentionally NOT updatable here — use the dedicated
    activate endpoint so the "only one active per project" guard runs.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    excluded_borehole_ids: list[UUID] | None = None


class GeologicalModelResponse(BaseModel):
    """API representation of a GeologicalModel row (without contacts).

    Use ``GET /projects/{id}/geology/models/{mid}/contacts`` to fetch
    the model's formation contacts. The shape stays light here so list
    endpoints don't drag the full contact tree.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    name: str
    description: str | None
    is_active: bool
    excluded_borehole_ids: list[UUID]
    kind: str
    parent_model_id: UUID | None
    # Representative qc statistic pair (owner rulings 7+8, debt #227) —
    # meaningful for kind='geotechnical' only; the defaults make the fields
    # additive for every existing client. ``bands_stale`` is derived client- or
    # server-side as classified != representative (never stored).
    representative_statistic: str = "median"
    classified_with_statistic: str | None = None
    created_at: datetime
    updated_at: datetime
