"""Geology API — geological-model CRUD + activate routes.

Split from the former 1,100-line ``geology.py`` monolith (debt
#40). Mounted under the shared ``/projects/{project_id}/geology``
prefix by this package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.geological_model import (
    GeologicalModelCreateRequest,
    GeologicalModelResponse,
    GeologicalModelUpdateRequest,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import REQUIRED_PARENT_KIND
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


@router.post(
    "/models",
    response_model=GeologicalModelResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_model(
    project_id: UUID,
    request: GeologicalModelCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalModelOrm:
    """Create a model, enforcing the three-level parent invariant.

    ``geological`` → must have NO parent. ``lithostratigraphic`` /
    ``geotechnical`` → ``parent_geological_model_id`` is required and
    must point at an existing same-project model of the required
    parent kind (geological / lithostratigraphic respectively). Any
    violation is a 422 — this is where "not optional for litho/geotech"
    is enforced (the column is DB-nullable; see model_kind.py).
    """
    required_parent_kind = REQUIRED_PARENT_KIND[request.kind]
    parent_id = request.parent_geological_model_id

    if required_parent_kind is None:
        if parent_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A geological model cannot have a parent model.",
            )
    else:
        if parent_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"A {request.kind} model requires "
                    f"parent_geological_model_id (a {required_parent_kind} model)."
                ),
            )
        parent = await session.get(GeologicalModelOrm, parent_id)
        if (
            parent is None
            or parent.app_project_id != project_id
            or parent.kind != required_parent_kind
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"parent_geological_model_id must reference an existing "
                    f"{required_parent_kind} model in this project."
                ),
            )

    repo = GeologyRepository(session)
    model = await repo.create_model(
        project_id,
        name=request.name,
        description=request.description,
        is_active=request.is_active,
        excluded_borehole_ids=request.excluded_borehole_ids,
        kind=request.kind,
        parent_geological_model_id=parent_id,
    )
    await session.commit()
    await session.refresh(model)
    return model


@router.get("/models", response_model=list[GeologicalModelResponse])
async def list_models(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeologicalModelOrm]:
    """List all geological models for a project, active first."""
    repo = GeologyRepository(session)
    return await repo.list_models(project_id)


@router.patch("/models/{model_id}", response_model=GeologicalModelResponse)
async def update_model(
    project_id: UUID,
    model_id: UUID,
    request: GeologicalModelUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalModelOrm:
    """Partial update on a model. ``is_active`` lives on its own activate endpoint."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    patch = request.model_dump(exclude_unset=True)
    model = await repo.update_model(model_id, patch)
    if model is None:
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    await session.commit()
    await session.refresh(model)
    return model


@router.post("/models/{model_id}/activate", response_model=GeologicalModelResponse)
async def activate_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> GeologicalModelOrm:
    """Mark this model active; clear ``is_active`` on every sibling in the project."""
    repo = GeologyRepository(session)
    model = await repo.set_active_model(project_id, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    await session.commit()
    await session.refresh(model)
    return model


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a model and all its dependent data.

    Cascades to: geological formations and their contacts, geotechnical
    units, and every formation surface (TIN) associated with the model.

    Blocked with 409 when another model refines this one (a
    lithostratigraphic model pins its geological parent; a geotechnical
    model pins its lithostratigraphic parent). Pre-checked here so the
    user gets a clear message instead of a raw ON DELETE RESTRICT
    IntegrityError on commit.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    if await repo.has_child_models(model_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This model cannot be deleted while another model refines "
                "it. Delete the dependent (lithostratigraphic / "
                "geotechnical) model first."
            ),
        )
    await repo.delete_model(model_id)
    await session.commit()
