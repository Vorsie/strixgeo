"""Pydantic schema: :class:`SplitGeotechBandRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SplitGeotechBandRequest(StrictRequestModel):
    """Body of the preview-split and split endpoints.

    Parameters
    ----------
    band_id : UUID
        The packing band (``litho_layer`` row in the geotech model) to split.
    split_depth_m : float
        Proposed boundary depth in metres, positive down. It must fall strictly
        inside the band's own litho body; the server refuses
        anything else with a 422 (the owner overrules the class, not the
        hierarchy).
    restore : bool
        When ``true`` the two halves are ASSIGNED the ``restore_*`` classes +
        sources directly rather than re-derived from qc, and the borehole refusal
        is lifted (there is no qc to re-derive, so nothing is being guessed). The
        merge-undo path sends it to bring both pre-merge bands back exactly (owner
        #35). Additive: an older client that omits it gets the ordinary
        re-deriving split. Only the commit endpoint honours it; the preview
        ignores it.
    restore_upper_nad_class, restore_lower_nad_class : int | None
        The class to assign each half when ``restore``; ``null`` is a valid
        (skeleton) pre-merge state.
    restore_upper_source, restore_lower_source : str | None
        The ``source`` stamp to restore on each half; default ``manual``.
    """

    band_id: UUID = Field(..., description="The packing band to split.")
    split_depth_m: float = Field(
        ...,
        description="New boundary depth (m, positive down), inside the band's litho body.",
    )
    restore: bool = Field(
        default=False,
        description="Assign the halves' classes from restore_* instead of re-deriving them.",
    )
    restore_upper_nad_class: int | None = Field(
        default=None, description="Class to assign the upper half when restore."
    )
    restore_lower_nad_class: int | None = Field(
        default=None, description="Class to assign the lower half when restore."
    )
    restore_upper_source: str | None = Field(
        default=None, description="Source stamp to restore on the upper half."
    )
    restore_lower_source: str | None = Field(
        default=None, description="Source stamp to restore on the lower half."
    )
