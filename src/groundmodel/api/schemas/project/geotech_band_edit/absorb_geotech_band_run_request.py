"""Pydantic schema: :class:`AbsorbGeotechBandRunRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class AbsorbGeotechBandRunRequest(StrictRequestModel):
    """Body of the preview-absorb-run and absorb-run endpoints (Ctrl+drag absorb-all).

    Parameters
    ----------
    band_ids : list[UUID]
        The run that unions: the dragged band plus every band the drag passed,
        2..N ids of a CONTIGUOUS run. Order irrelevant — normalised by depth.
    entered_band_id : UUID | None
        The band the release landed in, touching the far end of the run; or
        ``None`` when the drag reached the litho wall.
    new_depth_m : float | None
        The released depth (m, positive down), strictly inside the entered
        band; ``None`` exactly when there is no entered band.
    """

    band_ids: list[UUID] = Field(
        ...,
        min_length=2,
        description="The dragged band plus every band it passed (a contiguous run).",
    )
    entered_band_id: UUID | None = Field(
        None, description="The band the release landed in; null at the litho wall."
    )
    new_depth_m: float | None = Field(
        None, description="The released depth inside the entered band (m, positive down)."
    )

    @model_validator(mode="after")
    def _entered_and_depth_travel_together(self) -> AbsorbGeotechBandRunRequest:
        """Refuse a landing without its depth, or a depth without its landing."""
        if (self.entered_band_id is None) != (self.new_depth_m is None):
            raise ValueError("entered_band_id and new_depth_m must be given together, or neither.")
        return self
