"""Pydantic schema: :class:`PinchOutExtrapolationRequest`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.application.pinch_out_constants import DEFAULT_PINCH_OUT_OFFSET_M


class PinchOutExtrapolationRequest(BaseModel):
    """Request body for the pinch-out extrapolation endpoint.

    Attributes
    ----------
    formation_id : UUID
        The formation that is pinching out (thinning to zero thickness).
    target_formation_id : UUID
        The deeper formation the pinching one wedges into.
    section_id : UUID
        Cross-section used to slice the TIN surfaces and derive the
        tip location.  The two synthetic contacts are committed in the
        absolute project CRS, NOT section-relative — the section is a
        view/compute surface, not a storage primitive.
    direction : Literal["left", "right"]
        Which end of the section the formation thins toward.
    dip_override_m_per_m : float | None
        Optional gradient override (m elevation per m along section).
        Required when the pinching formation has a single-point TIN
        slice (no segment to derive a gradient from).  Negative values
        indicate a downward dip in the given direction.
    offset_m : float | None
        Perpendicular offset (metres) for the twin contact that breaks
        Delaunay collinearity.  Defaults to
        ``DEFAULT_PINCH_OUT_OFFSET_M`` (1.0 m).  Adjust only when
        the default produces an undesirable TIN artefact at this scale.
    """

    formation_id: UUID
    target_formation_id: UUID
    section_id: UUID
    direction: Literal["left", "right"]
    dip_override_m_per_m: float | None = Field(
        default=None,
        description=(
            "Explicit dip gradient (m/m). Required when the pinching "
            "formation has fewer than 2 TIN slice points."
        ),
    )
    offset_m: float | None = Field(
        default=DEFAULT_PINCH_OUT_OFFSET_M,
        description=(
            "Perpendicular offset (m) for the Delaunay-collinearity-breaking "
            f"twin contact. Default: {DEFAULT_PINCH_OUT_OFFSET_M} m."
        ),
    )
