"""Pydantic schema: :class:`GeotechBandEditPlanResponse`."""

from __future__ import annotations

from pydantic import BaseModel, Field

from groundmodel.api.schemas.project.geotech_band_edit.geotech_band_interval_item import (
    GeotechBandIntervalItem,
)
from groundmodel.api.schemas.project.geotech_band_edit.geotech_band_warning_item import (
    GeotechBandWarningItem,
)


class GeotechBandEditPlanResponse(BaseModel):
    """What a proposed split or merge would do — the preview payload.

    Parameters
    ----------
    kind : str
        ``"split"`` or ``"merge"``.
    parent_top_m : float
        Top of the hard bounds this edit is confined to (the geo-bounded litho
        body). A boundary moves freely inside this range and clamps at its edge.
    parent_base_m : float
        Base of the same hard bounds.
    intervals : list[GeotechBandIntervalItem]
        The resulting intervals, top to bottom, each with its re-derived class.
    warnings : list[GeotechBandWarningItem]
        Advisory consequences. A non-empty list never means the edit is refused —
        a manual override always wins.
    """

    kind: str = Field(..., description='"split" or "merge".')
    parent_top_m: float = Field(..., description="Top of the enclosing litho body (m).")
    parent_base_m: float = Field(..., description="Base of the enclosing litho body (m).")
    intervals: list[GeotechBandIntervalItem] = Field(
        default_factory=list, description="Resulting intervals, top to bottom."
    )
    warnings: list[GeotechBandWarningItem] = Field(
        default_factory=list, description="Advisory consequences; never blocking."
    )
