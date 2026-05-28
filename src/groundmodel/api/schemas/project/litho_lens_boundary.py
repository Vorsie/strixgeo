"""Schemas for the lens-boundary shaping endpoints (#163f Slice 2)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

LensRenderStyle = Literal["straight", "blocky", "rounded"]


class LensBoundaryNodeItem(BaseModel):
    """One control node on a lens boundary, section-local.

    Attributes
    ----------
    along_m : float
        Distance along the section line, metres.
    elevation_m : float
        Absolute elevation (mTAW), metres.
    """

    along_m: float
    elevation_m: float


class LensBoundaryWriteRequest(BaseModel):
    """Full-replace payload for a lens's boundary shape (#163f).

    The server sorts each node list by ``along_m`` and re-indexes 0..N-1, so
    callers need not pre-sort. An empty list clears that boundary's nodes.

    Attributes
    ----------
    upper_nodes, lower_nodes : list[LensBoundaryNodeItem]
        Control nodes for the upper / lower boundary of the lens wedge.
    render_style : {'straight', 'blocky', 'rounded'}
        How the boundary is drawn between nodes.
    """

    upper_nodes: list[LensBoundaryNodeItem] = Field(default_factory=list)
    lower_nodes: list[LensBoundaryNodeItem] = Field(default_factory=list)
    render_style: LensRenderStyle = "straight"


class LensBoundaryResponse(BaseModel):
    """The saved boundary shape for a lens body.

    Attributes
    ----------
    lens_id : UUID
        The lens whose shape this is.
    content_key : str | None
        The stable key the shape is stored under (null if the lens has not
        been detected with a key yet).
    render_style : {'straight', 'blocky', 'rounded'}
        Current render style (``'straight'`` when no shape is stored).
    primary_section_id : UUID | None
        The section the section-local node coordinates belong to.
    upper_nodes, lower_nodes : list[LensBoundaryNodeItem]
        Stored control nodes, ascending by ``along_m`` (empty = no custom shape).
    """

    lens_id: UUID
    content_key: str | None
    render_style: LensRenderStyle
    primary_section_id: UUID | None
    upper_nodes: list[LensBoundaryNodeItem]
    lower_nodes: list[LensBoundaryNodeItem]
