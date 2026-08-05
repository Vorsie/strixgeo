"""Pydantic schema: :class:`GeotechTieStatusResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class GeotechTieStatusResponse(BaseModel):
    """Response of ``GET .../geotech/tie-status``.

    Answers the one question the four-step pipeline's third step raises: is
    there packing-correlation work still waiting for the engineer?  Cheap
    enough to poll after every accept, so the "Divide boreholes" button can
    say why it is disabled instead of failing on press.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model the counts describe.
    pending_tie_count : int
        Packing ties PROPOSED and not yet accepted.  While this is non-zero the
        divide-boreholes verb refuses (``geotech_ties_pending``).
    accepted_tie_count : int
        Packing ties the engineer has accepted.  These are the only ties the
        resolver, the fill and the 3-D build see, and the only ones that inform
        a borehole's donor pair.
    flagged_tie_count : int
        Accepted ties carrying a ``review_reason`` — carried across a rebuild
        onto a band that is not clearly the one they were drawn on.  They are
        accepted (so they count in ``accepted_tie_count`` too) and do NOT gate
        anything; the count is here so the UI can nudge.
    """

    geotech_model_id: UUID = Field(..., description="The geotechnical model.")
    pending_tie_count: int = Field(..., description="Proposed packing ties awaiting acceptance.")
    accepted_tie_count: int = Field(..., description="Accepted packing ties.")
    flagged_tie_count: int = Field(..., description="Accepted ties carrying a review flag.")
