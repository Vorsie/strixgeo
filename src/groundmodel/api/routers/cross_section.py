"""Cross-section API routes — CRUD on project-scoped section definitions.

All routes are project-scoped via the URL prefix
``/projects/{project_id}/sections``. Same shape as the geology router
and the project router — the project_id in the URL is the scope guard;
every section returned belongs to that project.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.project.cross_section import (
    CrossSectionCreateRequest,
    CrossSectionResponse,
    CrossSectionUpdateRequest,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.session import get_session

router = APIRouter(prefix="/projects/{project_id}/sections", tags=["cross-sections"])


@router.post(
    "",
    response_model=CrossSectionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_section(
    project_id: UUID,
    request: CrossSectionCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Create a new cross-section under the given project."""
    repo = CrossSectionRepository(session)
    section = await repo.create(
        project_id,
        name=request.name,
        description=request.description,
        start_x=request.start_x,
        start_y=request.start_y,
        end_x=request.end_x,
        end_y=request.end_y,
        epsg=request.epsg,
        projection_buffer_m=request.projection_buffer_m,
        vertical_exaggeration=request.vertical_exaggeration,
        excluded_borehole_ids=request.excluded_borehole_ids,
        excluded_cpt_ids=request.excluded_cpt_ids,
        min_depth_m=request.min_depth_m,
        max_depth_m=request.max_depth_m,
        display_order=request.display_order,
    )
    await session.commit()
    await session.refresh(section)
    return section


@router.get("", response_model=list[CrossSectionResponse])
async def list_sections(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[CrossSectionOrm]:
    """List every section for a project, ordered by display_order then name."""
    repo = CrossSectionRepository(session)
    return await repo.list_all(project_id)


@router.get("/{section_id}", response_model=CrossSectionResponse)
async def get_section(
    project_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Fetch a single section by id. 404 when missing or not in this project."""
    repo = CrossSectionRepository(session)
    section = await repo.get(section_id)
    if section is None or section.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cross-section not found")
    return section


@router.patch("/{section_id}", response_model=CrossSectionResponse)
async def update_section(
    project_id: UUID,
    section_id: UUID,
    request: CrossSectionUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> CrossSectionOrm:
    """Partial update — only fields present in the body are written."""
    repo = CrossSectionRepository(session)
    section = await repo.get(section_id)
    if section is None or section.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cross-section not found")
    # exclude_unset so omitted fields stay untouched; an explicit null
    # is honoured (e.g. clearing min_depth_m back to auto-fit).
    patch = request.model_dump(exclude_unset=True)
    updated = await repo.update(section_id, patch)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cross-section not found")
    # Post-update invariant: line still has non-zero length. Cheap check.
    if updated.start_x == updated.end_x and updated.start_y == updated.end_y:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cross-section endpoints must remain distinct after update.",
        )
    await session.commit()
    await session.refresh(updated)
    return updated


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    project_id: UUID,
    section_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a section. Polylines drawn on it (when the editor lands)
    cascade via FK; today there's nothing to cascade."""
    repo = CrossSectionRepository(session)
    section = await repo.get(section_id)
    if section is None or section.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cross-section not found")
    await repo.delete(section_id)
    await session.commit()
