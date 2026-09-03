"""Pydantic schema: :class:`MergeGeotechBandsRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class MergeGeotechBandsRequest(StrictRequestModel):
    """Body of the preview-merge and merge endpoints.

    Two shapes, exactly one of which must be used:

    * the PAIR form — ``upper_band_id`` + ``lower_band_id`` (the ordinary
      adjacent-pair merge);
    * the RUN form — ``band_ids`` with 2..N ids of a CONTIGUOUS run (the
      small-lens absorb: host + lens + host union in one atomic call, one
      honest preview, one undo step).

    Parameters
    ----------
    upper_band_id : UUID | None
        The shallower of the two adjacent packing bands (pair form).
    lower_band_id : UUID | None
        The deeper of the two. Order is normalised by depth on the server, so
        passing the pair the other way round is accepted.
    band_ids : list[UUID] | None
        The contiguous run to union (run form). Order irrelevant — normalised
        by depth on the server.
    """

    upper_band_id: UUID | None = Field(None, description="The shallower packing band (pair form).")
    lower_band_id: UUID | None = Field(None, description="The deeper packing band (pair form).")
    band_ids: list[UUID] | None = Field(
        None,
        min_length=2,
        description="A contiguous run of 2..N bands to union (run form).",
    )

    @model_validator(mode="after")
    def _exactly_one_form(self) -> MergeGeotechBandsRequest:
        """Refuse ambiguous bodies at the wire: pair XOR run."""
        pair = self.upper_band_id is not None and self.lower_band_id is not None
        run = self.band_ids is not None
        if pair == run:
            raise ValueError(
                "Provide either upper_band_id + lower_band_id (pair form) OR "
                "band_ids (run form), not both and not neither."
            )
        return self
