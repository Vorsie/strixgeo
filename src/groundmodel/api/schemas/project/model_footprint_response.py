"""Pydantic schema: :class:`ModelFootprintResponse`."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ModelFootprintResponse(BaseModel):
    """The model's footprint boundary, as the alpha hull the last build clipped to.

    Answers ``GET .../models/{model_id}/footprint``. The 3-D viewer draws
    ``polygon`` as a subtle closed ring so the model's edge reads as an edge,
    not a hole — the SAME hull ``build_domain_from_sections`` (see
    ``groundmodel.domain.services.voxel_litho.build_domain_from_sections``)
    computed for the last successful ``BuildVoxelLithoModel`` run, re-derived
    from the persisted ``LithoBuildGeneration`` row rather than recomputed on
    the frontend (a client-side re-derivation would be a second source of
    truth that could draw a boundary not matching the actual build geometry).

    Attributes
    ----------
    polygon : list[list[float]]
        Closed ring of ``[x_m, y_m]`` vertices in the project CRS, WITHOUT a
        repeated last vertex (this is exactly what
        :func:`~groundmodel.domain.services.model_domain.alpha_hull_polygon`
        returns — the caller closes the ring itself when drawing it). Empty
        when no ring is available; see ``unavailable_reason``.
    generation_id : UUID | None
        The ``LithoBuildGenerationOrm`` row (see
        ``groundmodel.infrastructure.db.models.litho_build_generation_orm``)
        the ring was derived from. ``None`` when ``polygon`` is empty.
    built_at : datetime | None
        That generation's ``created_at``. ``None`` when ``polygon`` is empty.
    unavailable_reason : str | None
        Plain-English reason when ``polygon`` is empty (never built yet, the
        footprint could not be framed, or the stored payload could not be
        read). ``None`` when a ring was returned.
    """

    polygon: list[list[float]]
    generation_id: UUID | None = None
    built_at: datetime | None = None
    unavailable_reason: str | None = None
