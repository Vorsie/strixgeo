"""Pydantic schemas for the body-boundary shaping endpoints (#163f Slice 2)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

BodyRenderStyle = Literal["straight", "blocky", "rounded"]


class BodyBoundaryNodeItem(BaseModel):
    """One control node on a body boundary, section-local.

    Attributes
    ----------
    along_m : float
        Distance along the section line, metres.
    elevation_m : float
        Absolute elevation (mTAW), metres.
    """

    along_m: float
    elevation_m: float


class BodyBoundaryWriteRequest(BaseModel):
    """Full-replace payload for a body's boundary shape.

    The server sorts each node list by ``along_m`` and re-indexes 0..N-1,
    so callers need not pre-sort.  An empty list clears that boundary's
    nodes.

    Attributes
    ----------
    upper_nodes : list[BodyBoundaryNodeItem]
        Control nodes for the upper boundary of the body wedge.
    lower_nodes : list[BodyBoundaryNodeItem]
        Control nodes for the lower boundary of the body wedge.
    render_style : {'straight', 'blocky', 'rounded'}
        How the boundary is interpolated between nodes.
    """

    upper_nodes: list[BodyBoundaryNodeItem] = Field(default_factory=list)
    lower_nodes: list[BodyBoundaryNodeItem] = Field(default_factory=list)
    render_style: BodyRenderStyle = "straight"


class BodyBoundaryResponse(BaseModel):
    """The saved boundary shape for a body.

    Attributes
    ----------
    body_id : UUID
        The body whose shape this is.
    render_style : {'straight', 'blocky', 'rounded'}
        Current render style (``'straight'`` when no shape is stored).
    primary_section_id : UUID | None
        The section the section-local node coordinates belong to.
    upper_nodes : list[BodyBoundaryNodeItem]
        Stored control nodes for the upper boundary, ascending by
        ``along_m`` (empty when no custom shape is stored).
    lower_nodes : list[BodyBoundaryNodeItem]
        Stored control nodes for the lower boundary, ascending by
        ``along_m`` (empty when no custom shape is stored).
    """

    body_id: UUID
    render_style: BodyRenderStyle
    primary_section_id: UUID | None
    upper_nodes: list[BodyBoundaryNodeItem]
    lower_nodes: list[BodyBoundaryNodeItem]
