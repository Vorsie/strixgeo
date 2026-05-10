"""Project API route handlers — list, create, read, update, archive, unarchive."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.api.schemas.project.project_create_request import (
    ProjectCreateRequest,
)
from groundmodel.api.schemas.project.project_duplicate_request import (
    ProjectDuplicateRequest,
)
from groundmodel.api.schemas.project.project_response import ProjectResponse
from groundmodel.api.schemas.project.project_update_request import (
    ProjectUpdateRequest,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import get_session

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
) -> list[ProjectOrm]:
    """List all projects, most-recent first.

    Parameters
    ----------
    include_archived : bool
        When ``False`` (default), hide rows whose ``archived_at`` is set so
        the desktop's projects-list keeps active work front-and-centre. Set
        to ``True`` for an "Archived projects" view.
    """
    repo = ProjectRepository(session)
    return await repo.list_all(include_archived=include_archived)


@router.get("/archived", response_model=list[ProjectResponse])
async def list_archived_projects(
    session: AsyncSession = Depends(get_session),
) -> list[ProjectOrm]:
    """List only archived projects, ordered by archive date (most-recent first)."""
    repo = ProjectRepository(session)
    return await repo.list_archived()


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    request: ProjectCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Create a new project.

    The generated UUID is the canonical project id — desktop clients write
    it into the ``.gmproj`` file alongside the metadata.
    """
    project = ProjectOrm(
        id=uuid7(),
        name=request.name,
        project_number=request.project_number,
        client=request.client,
        site_label=request.site_label,
        description=request.description,
        tags=request.tags,
        default_horizontal_epsg=request.default_horizontal_epsg,
        default_vertical_epsg=request.default_vertical_epsg,
        phase=request.phase,
        status=request.status,
    )
    repo = ProjectRepository(session)
    await repo.save(project)
    await session.commit()
    # Refresh so server-side defaults (created_at, updated_at, server_default
    # columns like ``tags={}``) are loaded into the Python object before
    # Pydantic serialises it. Without this, accessing those attributes from
    # the response builder raises MissingGreenlet — they were expired/never-
    # loaded and re-fetching is async work that the sync extractor can't do.
    await session.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Return a single project by id."""
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    request: ProjectUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Apply a partial metadata update to a project.

    PATCH semantics: only fields present in the request body are written.
    Sending ``null`` for an optional field clears it; omitting the field
    leaves it unchanged. ``name`` and ``status`` are NOT NULL in the DB —
    sending ``null`` for either is rejected with a 400.
    """
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # ``model_dump(exclude_unset=True)`` is the load-bearing call here:
    # it returns only the fields the caller actually included in the
    # JSON body, so we never accidentally overwrite an unsent field with
    # its Pydantic default (``None``).
    updates = request.model_dump(exclude_unset=True)
    for col in ("name", "status"):
        if col in updates and updates[col] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{col}' cannot be null — omit the field to leave it unchanged",
            )

    for key, value in updates.items():
        setattr(project, key, value)

    await session.flush()
    await session.commit()
    await session.refresh(project)
    return project


@router.post("/{project_id}/archive", response_model=ProjectResponse)
async def archive_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Soft-delete a project — hide from default listings, keep all data."""
    repo = ProjectRepository(session)
    project = await repo.archive(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await session.commit()
    await session.refresh(project)
    return project


@router.post("/{project_id}/unarchive", response_model=ProjectResponse)
async def unarchive_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Restore a previously-archived project to active status."""
    repo = ProjectRepository(session)
    project = await repo.unarchive(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await session.commit()
    await session.refresh(project)
    return project


@router.post(
    "/{project_id}/duplicate",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_project(
    project_id: UUID,
    request: ProjectDuplicateRequest,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Deep-clone a project + every CPT and Borehole tree under it.

    Backs the desktop client's File → Save As. ``name`` defaults to
    ``"Copy of <source name>"`` when omitted. The new project starts in
    ``active`` status regardless of the source's lifecycle.

    Returns 404 when the source id is unknown.
    """
    repo = ProjectRepository(session)
    duplicate = await repo.duplicate(project_id, new_name=request.name)
    if duplicate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await session.commit()
    await session.refresh(duplicate)
    return duplicate
