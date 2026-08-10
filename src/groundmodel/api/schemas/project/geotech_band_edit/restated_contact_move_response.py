"""Response of the restated-contact move — what the drag actually changed."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.project.geotech_band_edit.geotech_band_edit_response import (
    GeotechBandEditResponse,
)


class RestatedContactMoveResponse(GeotechBandEditResponse):
    """The geotech band outcome, plus the other levels the move carried.

    Extends the band-edit payload rather than replacing it: the geotech half of
    this gesture IS a band move, so the caller reads the same plan, the same two
    row ids and the same tie outcome. What it adds is the answer to "what else
    did I just change", which the engineer has to be told before he presses the
    button, not after.

    Parameters
    ----------
    litho_upper_layer_id : UUID
        The lithostratigraphic layer above the contact, whose base moved.
    litho_lower_layer_id : UUID
        The layer below, whose top moved.
    geo_contact_id : UUID | None
        The geological contact carried along, or ``None`` when the litho row is
        not derived from one. About a third of them are, so a UI that assumes
        either answer is wrong most of the time.
    """

    litho_upper_layer_id: UUID = Field(
        ..., description="The litho layer above the contact (its base moved)."
    )
    litho_lower_layer_id: UUID = Field(
        ..., description="The litho layer below the contact (its top moved)."
    )
    geo_contact_id: UUID | None = Field(
        None,
        description="The geological contact carried with it, when the litho row has one.",
    )
