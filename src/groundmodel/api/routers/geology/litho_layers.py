"""Litho-layer API router — read-path for the unified litho model (Slice A1).

Mounted under the shared ``/projects/{project_id}/geology`` prefix
through the ``geology`` package ``__init__``. Final path:
``GET /projects/{project_id}/geology/models/{model_id}/layers``.

Slice A1 ships read endpoints only — Slice A2 lands the write path
(PATCH layer, boundary-move, batch-status, bulk-create) plus the
dual-write transition.

The ``project_id`` in the URL is a scope guard: the handler rejects
if the model doesn't belong to the project, preventing trivial
id-guessing across projects (same pattern as the contacts router).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.litho_layer import (
    LithoLayerResponse,
    LithoLayerStatusLiteral,
)
from groundmodel.application.list_litho_layers_for_model import (
    ListLithoLayersForModel,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.session import get_session

router = APIRouter()


@router.get(
    "/models/{model_id}/layers",
    response_model=list[LithoLayerResponse],
)
async def list_layers(
    project_id: UUID,
    model_id: UUID,
    borehole_id: UUID | None = None,
    cpt_id: UUID | None = None,
    formation_id: UUID | None = None,
    status: LithoLayerStatusLiteral | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[LithoLayerOrm]:
    """List ``litho_layer`` rows in a model, optionally filtered.

    Sorted by ``depth_top_m`` ascending. When the model belongs to a
    geological (kind='geological') project rather than a
    lithostratigraphic one, returns an empty list — the table only
    carries litho rows.

    Filters
    -------
    borehole_id, cpt_id : UUID | None
        Restrict to one anchor. Combining both returns zero rows
        (the table's XOR CHECK guarantees no row matches both).
    formation_id : UUID | None
        Restrict to one formation across all anchors.
    status : "pending" | "accepted" | "rejected" | None
        Restrict to one status. Absence returns all three.
    """
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    use_case = ListLithoLayersForModel(session)
    return await use_case.execute(
        model_id,
        borehole_id=borehole_id,
        cpt_id=cpt_id,
        formation_id=formation_id,
        status=status,
    )
