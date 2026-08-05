"""Pydantic schema: :class:`DivideBoreholesRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class DivideBoreholesRequest(BaseModel):
    """Optional body of ``POST .../geotech/divide-boreholes``.

    Both fields are optional and both default to the endpoint's historic
    behaviour, so a caller that sends no body at all gets exactly what it got
    before the four-step pipeline landed — except for the acceptance gate,
    which is the point of the step (owner ruling 2026-08-04).

    Parameters
    ----------
    borehole_ids : list[UUID] | None
        Divide only these borehole columns.  ``None`` (the default) divides
        every borehole.  A subset is what lets the engineer accept the ghost
        bands one borehole at a time; the boreholes left out keep the bands —
        and the accepted ties anchored on them — they already had.
    ignore_pending_ties : bool
        Skip the "accept your packing ties first" gate.  Defaults to ``False``:
        dividing boreholes reads the accepted ties to decide where each
        borehole's packing comes from, so doing it with proposals outstanding
        throws away evidence the engineer is one click from supplying.  The
        escape exists for callers that deliberately want the pre-pipeline
        behaviour, and it has to say so.
    """

    borehole_ids: list[UUID] | None = Field(
        default=None,
        description=(
            "Divide only these boreholes; omit or null to divide every borehole "
            "(the historic behaviour)."
        ),
    )
    ignore_pending_ties: bool = Field(
        default=False,
        description=(
            "Divide even while packing-tie proposals are still pending. Default "
            "false: the gate exists because accepted ties steer the donors."
        ),
    )
