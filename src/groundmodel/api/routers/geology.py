"""Geology API routes — formations, models, formation contacts, validation.

The full REST surface the desktop client (and any future automation)
uses to read and write a project's geological model. All routes are
project-scoped (``/projects/{project_id}/geology/...``) so the URL
itself carries the access scope.

Mounted by ``api/main.py`` alongside the existing routers.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.project.formation_contact import (
    FormationContactCreateRequest,
    FormationContactResponse,
    FormationContactUpdateRequest,
    GapIssueResponse,
    GapValidationResponse,
)
from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationCreateRequest,
    GeologicalFormationResponse,
    GeologicalFormationUpdateRequest,
)
from groundmodel.api.schemas.project.geological_model import (
    GeologicalModelCreateRequest,
    GeologicalModelResponse,
    GeologicalModelUpdateRequest,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session

router = APIRouter(prefix="/projects/{project_id}/geology", tags=["geology"])


# ---------------------------------------------------------------------------
# Formations
# ---------------------------------------------------------------------------


@router.post(
    "/formations",
    response_model=GeologicalFormationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_formation(
    project_id: UUID,
    request: GeologicalFormationCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalFormationOrm:
    """Create a new formation under the given project."""
    repo = GeologyRepository(session)
    formation = await repo.create_formation(
        project_id,
        name=request.name,
        color=request.color,
        code=request.code,
        display_order=request.display_order,
        regional_ref=request.regional_ref,
        description=request.description,
    )
    await session.commit()
    await session.refresh(formation)
    return formation


@router.get("/formations", response_model=list[GeologicalFormationResponse])
async def list_formations(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeologicalFormationOrm]:
    """List all formations defined for a project."""
    repo = GeologyRepository(session)
    return await repo.list_formations(project_id)


@router.patch(
    "/formations/{formation_id}",
    response_model=GeologicalFormationResponse,
)
async def update_formation(
    project_id: UUID,
    formation_id: UUID,
    request: GeologicalFormationUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeologicalFormationOrm:
    """Partial update on a formation. Only fields present in the body are written."""
    repo = GeologyRepository(session)
    # exclude_unset so omitted fields stay untouched and explicit null
    # only clears optional columns.
    patch = request.model_dump(exclude_unset=True)
    formation = await repo.update_formation(formation_id, patch)
    if formation is None or formation.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Formation not found")
    await session.commit()
    await session.refresh(formation)
    return formation


@router.delete("/formations/{formation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_formation(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a formation. Cascades to every contact that referenced it."""
    repo = GeologyRepository(session)
    formation = await repo.get_formation(formation_id)
    if formation is None or formation.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Formation not found")
    await repo.delete_formation(formation_id)
    await session.commit()


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
    """Create a new geological model under the given project."""
    repo = GeologyRepository(session)
    model = await repo.create_model(
        project_id,
        name=request.name,
        description=request.description,
        is_active=request.is_active,
        excluded_borehole_ids=request.excluded_borehole_ids,
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
    patch = request.model_dump(exclude_unset=True)
    model = await repo.update_model(model_id, patch)
    if model is None or model.app_project_id != project_id:
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
    """Delete a model. Cascades to every contact under it."""
    repo = GeologyRepository(session)
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None or model.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    await repo.delete_model(model_id)
    await session.commit()


# ---------------------------------------------------------------------------
# Formation contacts
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/contacts",
    response_model=FormationContactResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact(
    project_id: UUID,
    model_id: UUID,
    request: FormationContactCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> FormationContactOrm:
    """Create a new formation contact under a model."""
    repo = GeologyRepository(session)
    # Guard: model must exist and belong to the project.
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None or model.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    try:
        contact = await repo.create_contact(
            model_id=model_id,
            formation_id=request.formation_id,
            depth_top_m=request.depth_top_m,
            borehole_id=request.borehole_id,
            cpt_id=request.cpt_id,
            source=request.source,
            confidence=request.confidence,
            observation_id=request.observation_id,
            observation_layer_id=request.observation_layer_id,
            notes=request.notes,
        )
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    await session.commit()
    await session.refresh(contact)
    return contact


@router.get(
    "/models/{model_id}/contacts",
    response_model=list[FormationContactResponse],
)
async def list_contacts(
    project_id: UUID,
    model_id: UUID,
    borehole_id: UUID | None = None,
    formation_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[FormationContactOrm]:
    """List contacts in a model, optionally filtered by borehole / formation.

    The ``project_id`` in the URL is a scope guard: we reject if the
    model doesn't belong to the project, preventing trivial id-guessing
    across projects.
    """
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None or model.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    repo = GeologyRepository(session)
    return await repo.list_contacts(model_id, borehole_id=borehole_id, formation_id=formation_id)


@router.patch(
    "/models/{model_id}/contacts/{contact_id}",
    response_model=FormationContactResponse,
)
async def update_contact(
    project_id: UUID,
    model_id: UUID,
    contact_id: UUID,
    request: FormationContactUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> FormationContactOrm:
    """Partial update on a contact (depth, formation, confidence, notes)."""
    contact = await session.get(FormationContactOrm, contact_id)
    if contact is None or contact.model_id != model_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    # Scope guard through the parent model.
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None or model.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    repo = GeologyRepository(session)
    updated = await repo.update_contact(contact_id, request.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    await session.commit()
    await session.refresh(updated)
    return updated


@router.delete(
    "/models/{model_id}/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_contact(
    project_id: UUID,
    model_id: UUID,
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a contact."""
    contact = await session.get(FormationContactOrm, contact_id)
    if contact is None or contact.model_id != model_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None or model.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    repo = GeologyRepository(session)
    await repo.delete_contact(contact_id)
    await session.commit()


# ---------------------------------------------------------------------------
# No-gaps validation
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/boreholes/{borehole_id}/validate",
    response_model=GapValidationResponse,
)
async def validate_no_gaps(
    project_id: UUID,
    model_id: UUID,
    borehole_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> GapValidationResponse:
    """Check that a borehole's formation contacts form a clean stratigraphy.

    Returns the list of issues found (empty list ⇒ all good). The
    editor calls this on save; the response surfaces as inline warnings
    in the section view.
    """
    model = await session.get(GeologicalModelOrm, model_id)
    if model is None or model.app_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    repo = GeologyRepository(session)
    issues = await repo.validate_no_gaps(model_id, borehole_id)
    return GapValidationResponse(
        model_id=model_id,
        borehole_id=borehole_id,
        issues=[
            GapIssueResponse(
                kind=i.kind,
                detail=i.detail,
                depth_m=i.depth_m,
                contact_ids=list(i.contact_ids),
            )
            for i in issues
        ],
    )
