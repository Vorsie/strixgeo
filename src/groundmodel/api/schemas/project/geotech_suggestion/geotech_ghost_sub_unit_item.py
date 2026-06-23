"""Pydantic schema: :class:`GeotechGhostSubUnitItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class GeotechGhostSubUnitItem(BaseModel):
    """Wire representation of one suggested NAD packing sub-unit ghost.

    Maps :class:`~groundmodel.application.suggest_geotech_subdivision.GeotechGhostSubUnit`
    to JSON.

    Parameters
    ----------
    depth_top_m : float
        Top depth of the sub-unit (metres, positive down).
    depth_base_m : float
        Base depth of the sub-unit (metres, positive down).
    nad_class : int | None
        Classified NAD packing class 1–31, or ``None`` for borehole
        carry-through (no qc series → unclassifiable).
    source_litho_formation_id : UUID
        The lithostratigraphic formation this geotech sub-unit subdivides.
    source_geo_formation_id : UUID | None
        The geological formation the sub-unit sits within, or ``None`` for the
        open shallow band above the topmost geological surface.
    """

    depth_top_m: float
    depth_base_m: float
    nad_class: int | None
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None
