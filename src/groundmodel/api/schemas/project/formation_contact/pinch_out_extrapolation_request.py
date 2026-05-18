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
    dry_run : bool
        When ``True``, the endpoint computes the tip geometry via the
        same ``compute_pinch_tip`` path as the commit flow but does NOT
        create contacts, does NOT mark the surface stale, does NOT seed
        the section, and does NOT commit.  The response carries
        ``tip_along_m`` / ``tip_elevation_m`` for the frontend ghost
        preview and ``created_contact_ids=[]``.

        Mapping errors (geometry uncomputable, missing TIN) are still
        returned as HTTP 422 so the frontend can surface a meaningful
        "can't pinch out here" inline message.

        WHY request-body flag (not query param): the existing endpoint
        already takes a JSON body, and adding a body field is additive
        without changing the route.  Sibling convention (auto-populate
        uses body fields for all variants).
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
    dry_run: bool = Field(
        default=False,
        description=(
            "When True: compute and return the tip geometry WITHOUT "
            "persisting any contacts or marking the surface stale. "
            "Used by the frontend ghost-preview step before Confirm."
        ),
    )
