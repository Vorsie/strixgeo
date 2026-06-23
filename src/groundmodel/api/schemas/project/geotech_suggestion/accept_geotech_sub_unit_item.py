"""Pydantic schema: :class:`AcceptGeotechSubUnitItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AcceptGeotechSubUnitItem(BaseModel):
    """Wire representation of one accepted NAD packing sub-unit.

    Maps to
    :class:`~groundmodel.application.accept_geotech_suggestions.AcceptedGeotechSubUnit`.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole this sub-unit is anchored on.
    depth_top_m : float
        Top depth of the sub-unit (metres, positive down).
    depth_base_m : float
        Base depth of the sub-unit (metres, positive down).
    nad_class : int | None
        Accepted NAD packing class 1–31, or ``None`` for a borehole
        carry-through (no qc → unclassifiable).
    source_litho_formation_id : UUID
        The lithostratigraphic formation this geotech sub-unit subdivides.
    source_geo_formation_id : UUID | None
        The geological formation the sub-unit sits within, or ``None`` for the
        open shallow band above the topmost geological surface.
    """

    investigation_id: UUID
    depth_top_m: float
    depth_base_m: float
    nad_class: int | None
    source_litho_formation_id: UUID
    source_geo_formation_id: UUID | None
