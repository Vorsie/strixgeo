"""Pydantic schema: :class:`GeotechBandEditResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.project.geotech_band_edit.geotech_band_edit_plan_response import (
    GeotechBandEditPlanResponse,
)


class GeotechBandEditResponse(BaseModel):
    """Result of a committed split or merge.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model that was written.
    investigation_id : UUID
        The single column that changed — recalculation is local, so no other
        column's classes moved.
    plan : GeotechBandEditPlanResponse
        What was committed (same shape as the preview), so the UI can show the
        realised consequence without a second round-trip.
    layer_ids : list[UUID]
        The resulting band rows, top to bottom.
    created_layer_ids : list[UUID]
        Rows inserted by this edit.
    deleted_layer_ids : list[UUID]
        Rows removed by this edit.
    deleted_edge_ids : list[UUID]
        Correlations REMOVED. Since 2026-08-07 (flag-not-drop) this is
        narrower than it was: PENDING mismatches withdrawn, pending ties that
        cascaded with an absorbed row, and transfer drops (self-loops /
        duplicates). Accepted mismatches are no longer deleted — they appear
        in ``flagged_edge_ids`` instead.
    flagged_edge_ids : list[UUID]
        ACCEPTED ties flagged for review (violet badge) — a class mismatch or
        a transferred anchor. Surviving rows; the engineer confirms or
        deletes them via the existing verbs.
    cleared_edge_ids : list[UUID]
        Ties whose restored class match self-healed an earlier
        ``class_changed`` flag.
    """

    geotech_model_id: UUID = Field(..., description="The geotechnical model written.")
    investigation_id: UUID = Field(..., description="The only column that changed.")
    plan: GeotechBandEditPlanResponse = Field(..., description="What was committed.")
    layer_ids: list[UUID] = Field(default_factory=list, description="Resulting band rows.")
    created_layer_ids: list[UUID] = Field(default_factory=list, description="Rows inserted.")
    deleted_layer_ids: list[UUID] = Field(default_factory=list, description="Rows removed.")
    flagged_edge_ids: list[UUID] = Field(
        default_factory=list, description="Accepted ties flagged for review."
    )
    cleared_edge_ids: list[UUID] = Field(
        default_factory=list, description="Ties whose class_changed flag self-healed."
    )
    deleted_edge_ids: list[UUID] = Field(default_factory=list, description="Correlations dropped.")
    deleted_accepted_edge_ids: list[UUID] = Field(
        default_factory=list,
        description=(
            "The subset of deleted_edge_ids the engineer had ACCEPTED (a self-loop "
            "or a true duplicate an absorb could not re-anchor). Separate because a "
            "withdrawn machine proposal and a deleted accepted tie mean opposite "
            "things to the engineer."
        ),
    )
    pre_merge_upper_nad_class: int | None = Field(
        default=None,
        description=(
            "A MERGE only: the class the SURVIVOR (upper) band carried before the "
            "merge, so ctrl+z can restore it exactly rather than re-deriving it "
            "(owner #35). Null for a split / move or a skeleton band."
        ),
    )
    pre_merge_lower_nad_class: int | None = Field(
        default=None,
        description="A MERGE only: the class the ABSORBED (lower) band carried before the merge.",
    )
    pre_merge_upper_source: str | None = Field(
        default=None,
        description="A MERGE only: the survivor band's source stamp before the merge.",
    )
    pre_merge_lower_source: str | None = Field(
        default=None,
        description="A MERGE only: the absorbed band's source stamp before the merge.",
    )
