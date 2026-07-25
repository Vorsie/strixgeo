"""Post-restore body reconcile — re-stamp ``litho_layer.body_id`` after a bundle restore.

On restore the bundle does NOT carry ``litho_layer.body_id`` (bodies are inserted in a
later phase than layers, so restoring it verbatim would FK-violate). Instead the id is
re-derived from each interpretation model's approved correlation edges by re-running
``ResolveLithoInstances``. Extracted from the ``POST /restore`` route so the reconcile
runs for every body-bearing model kind, not only the one the route happened to query.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.constants.model_kind import NON_STRATIGRAPHIC_KINDS


async def reconcile_bodies_after_restore(session: AsyncSession, project_id: UUID) -> None:
    """Re-stamp ``litho_layer.body_id`` for the project's body-bearing models.

    Runs ``ResolveLithoInstances`` (without committing — the caller owns the
    transaction) for every lithostratigraphic AND geotechnical model, rebuilding
    body membership from each model's restored correlation graph. Both kinds carry
    ``litho_layer.body_id`` (SubdivideAllBodies stamps the geotech axis the same
    way), so reopening a subdivided project must reconcile both — otherwise the
    geotech body grouping reopens NULL until the next subdivide.

    Parameters
    ----------
    session : AsyncSession
        The restore transaction's session.
    project_id : UUID
        The project whose models to reconcile.
    """
    model_ids = list(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(
                    GeologicalModelOrm.app_project_id == project_id,
                    GeologicalModelOrm.kind.in_(NON_STRATIGRAPHIC_KINDS),
                )
            )
        )
        .scalars()
        .all()
    )
    for model_id in model_ids:
        await ResolveLithoInstances(session).execute(model_id=model_id, commit=False)
