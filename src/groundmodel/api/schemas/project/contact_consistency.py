"""Response schemas of ``GET /projects/{pid}/geology/models/{mid}/contact-consistency``."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class PickCheckNeighbourResponse(BaseModel):
    """The closest other pick of the same formation."""

    contact_id: str
    investigation_name: str
    distance_m: float
    pick_elevation_m: float


class PickCheckFlagResponse(BaseModel):
    """A pick that does not fit its neighbours."""

    contact_id: str
    investigation_id: str
    investigation_kind: str
    investigation_name: str
    pick_elevation_m: float
    predicted_elevation_m: float
    sigma_m: float
    z: float
    nearest: PickCheckNeighbourResponse


class PickCheckFitResponse(BaseModel):
    """The fitted covariance model, as standard deviations for display."""

    range_m: float
    sill_sd_m: float
    nugget_sd_m: float


class FormationPickCheckResponse(BaseModel):
    """One formation's result; ``status`` is ``computing`` while it runs.

    ``refit_fallbacks`` counts held-out picks whose refit failed and that were
    judged by the full-data model instead (0 while computing).
    """

    formation_id: UUID
    formation_name: str
    status: str
    n_picks: int
    skipped_no_location: int = 0
    fit: PickCheckFitResponse | None = None
    coverage_90: float | None = None
    flags: list[PickCheckFlagResponse] = Field(default_factory=list)
    reason: str | None = None
    refit_fallbacks: int = 0


class ContactConsistencyResponse(BaseModel):
    """The model's report; ``status`` is ``computing`` while any formation runs."""

    model_id: UUID
    status: str
    formations: list[FormationPickCheckResponse]
