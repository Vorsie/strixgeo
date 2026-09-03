"""Pydantic schema: :class:`DivideBoreholesRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.project.voxel_build_request import (
    SectionPartitionInputSchema,
)
from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class DivideBoreholesRequest(StrictRequestModel):
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
    section_id : UUID | None
        Divide only the boreholes that project onto ONE section, and gate on
        THAT section's pending ties (owner ruling 2026-08-15, reading the menu
        after steps 1-3 were scoped: *"i'm reading divide boreholes (whole
        model), no that should also be section scoped"*).  ``None`` (the
        default) is the historic whole-model run, gated on the whole model.

        Resolved through the same membership rule the rest of the pipeline
        uses and then fed into ``borehole_ids``, so the scoped delete, the
        untouched-column seeding and the tie capture all behave exactly as
        they do for a hand-picked subset.  Combining the two fields intersects
        them: "these boreholes, of the ones on this section".
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
    skip_existing: bool = Field(
        default=False,
        description=(
            "Owner ruling 2026-08-18: a borehole that already carries bands is "
            "imported as-is and skipped - the first subdivision wins, so a tie "
            "section never tells a second story."
        ),
    )
    section_id: UUID | None = Field(
        default=None,
        description=(
            "Divide only this section's boreholes and gate on this section's "
            "pending ties; omit or null for the whole model (the historic "
            "behaviour)."
        ),
    )
    section_partitions: dict[UUID, SectionPartitionInputSchema] | None = Field(
        default=None,
        description=(
            "The 2-D section partitions, keyed by section id — the same shape "
            "the 3-D build receives. When a partition covers a borehole it "
            "OUTRANKS the donor rule: the geometry between the two CPTs "
            "already says what lies in the gap, so the borehole's column is "
            "read as a vertical line through it (owner ruling 2026-08-15). "
            "Omit for the donor-only behaviour."
        ),
    )
