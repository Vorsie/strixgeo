"""Bed-override API routes — CRUD on project-scoped bed-level polygons.

All routes are project-scoped via the URL prefix
``/projects/{project_id}/bed-overrides``. The ``project_id`` in the URL is the
scope guard; every override returned belongs to that project.

A bed override is a polygon drawn on the map with one constant bed elevation.
Inside the polygon the ground surface takes that level instead of the DEM —
the manual fix for the missing bathymetry over dredged water (owner ruling
2026-09-06). Survey-file bathymetry import stays Phase 5.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.bed_override import (
    BedOverrideCreateRequest,
    BedOverrideResponse,
    BedOverrideUpdateRequest,
)
from groundmodel.application.stale_models_for_bed_change import (
    mark_models_stale_for_bed_change,
)
from groundmodel.infrastructure.db.models.bed_override_orm import BedOverrideOrm
from groundmodel.infrastructure.db.repositories.bed_override_repository import (
    BedOverrideRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/bed-overrides", tags=["bed-overrides"])


@router.post("", response_model=BedOverrideResponse, status_code=status.HTTP_201_CREATED)
async def create_bed_override(
    project_id: UUID,
    request: BedOverrideCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> BedOverrideOrm:
    """Create a bed override under the given project.

    Parameters
    ----------
    project_id : UUID
        Owning project (scope guard).
    request : BedOverrideCreateRequest
        Label, bed level, EPSG, and the polygon ring.

    Returns
    -------
    BedOverrideOrm
        The created row (serialised via ``BedOverrideResponse``).
    """
    logger.info(f"POST /projects/{project_id}/bed-overrides — {request.label!r}")
    repo = BedOverrideRepository(session)
    override = await repo.create(
        project_id,
        label=request.label,
        level_m=request.level_m,
        epsg=request.epsg,
        vertices=[[x, y] for x, y in request.vertices],
    )
    # A new bed cuts the ground under it, so every built model that caches the
    # ground (geological TIN surfaces, litho / geotech voxel solids) is now
    # stale — flip the on-click-Build staleness flags so the engineer is told to
    # rebuild. The section / fence VIEWS already cut at once (no rebuild).
    surfaces, solids = await mark_models_stale_for_bed_change(session, project_id)
    logger.info(
        f"bed override created — staled {surfaces} surface(s), {solids} solid(s) for rebuild"
    )
    await session.commit()
    await session.refresh(override)
    return override


@router.get("", response_model=list[BedOverrideResponse])
async def list_bed_overrides(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[BedOverrideOrm]:
    """List every bed override for a project, newest first.

    Parameters
    ----------
    project_id : UUID
        Project to list bed overrides for.

    Returns
    -------
    list[BedOverrideOrm]
        The project's bed overrides.
    """
    return await BedOverrideRepository(session).list_all(project_id)


@router.patch("/{override_id}", response_model=BedOverrideResponse)
async def update_bed_override(
    project_id: UUID,
    override_id: UUID,
    request: BedOverrideUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> BedOverrideOrm:
    """Partial update — only fields present in the body are written.

    Parameters
    ----------
    project_id : UUID
        Owning project (scope guard).
    override_id : UUID
        Bed override to update.
    request : BedOverrideUpdateRequest
        Fields to change.

    Returns
    -------
    BedOverrideOrm
        The updated row.

    Raises
    ------
    HTTPException(404)
        When the override does not exist or does not belong to the project.
    """
    repo = BedOverrideRepository(session)
    await get_in_project_or_404(repo.get(override_id), project_id, detail="Bed override not found")
    patch = request.model_dump(exclude_unset=True)
    if "vertices" in patch and patch["vertices"] is not None:
        patch["vertices"] = [[x, y] for x, y in patch["vertices"]]
    updated = await repo.update(override_id, patch)
    # Only a level / geometry change moves the ground the models cache; a
    # label-only rename leaves every built model valid, so it does not stale them.
    if "level_m" in patch or "vertices" in patch:
        surfaces, solids = await mark_models_stale_for_bed_change(session, project_id)
        logger.info(
            f"bed override {override_id} moved — staled {surfaces} surface(s), "
            f"{solids} solid(s) for rebuild"
        )
    await session.commit()
    assert updated is not None  # guarded by get_in_project_or_404 above
    await session.refresh(updated)
    return updated


@router.delete("/{override_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bed_override(
    project_id: UUID,
    override_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Delete a bed override.

    Irreversible — the desktop client guards this behind a confirmation dialog
    (Cancel default-focused). The backend removes the row after the scope guard.

    Parameters
    ----------
    project_id : UUID
        Owning project (scope guard).
    override_id : UUID
        Bed override to delete.

    Returns
    -------
    Response
        ``204 No Content`` on success.

    Raises
    ------
    HTTPException(404)
        When the override does not exist or does not belong to the project.
    """
    repo = BedOverrideRepository(session)
    await get_in_project_or_404(repo.get(override_id), project_id, detail="Bed override not found")
    await repo.delete(override_id)
    # Removing a bed restores the DEM ground under it, so the built models that
    # cached the cut ground are stale again — flip the rebuild flags.
    surfaces, solids = await mark_models_stale_for_bed_change(session, project_id)
    logger.info(
        f"bed override {override_id} deleted — staled {surfaces} surface(s), "
        f"{solids} solid(s) for rebuild"
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
