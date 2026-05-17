"""Geology API — formations + geotechnical-unit (subdivision) routes.

Split from the former 1,100-line ``geology.py`` monolith (debt
#40). Mounted under the shared ``/projects/{project_id}/geology``
prefix by this package's ``__init__``; paths are unchanged.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.formation_codelist import (
    FormationCodelistResponse,
    NadClassOption,
)
from groundmodel.api.schemas.project.geological_formation import (
    GeologicalFormationCreateRequest,
    GeologicalFormationResponse,
    GeologicalFormationUpdateRequest,
)
from groundmodel.api.schemas.project.geotechnical_unit import (
    GeotechnicalUnitCreateRequest,
    GeotechnicalUnitResponse,
    GeotechnicalUnitUpdateRequest,
)
from groundmodel.domain.services.litho_constants import (
    ADMIXTURE_QUALIFIERS,
    BASE_LITHOLOGIES,
    NAD_CLASSES,
)
from groundmodel.domain.value_objects.model_kind import ModelKind
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geotechnical_unit_orm import (
    GeotechnicalUnitOrm,
)
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()

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
        lithology=request.lithology,
        nad_class=request.nad_class,
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


@router.get(
    "/formations/codelist",
    response_model=FormationCodelistResponse,
)
async def formation_codelist(
    project_id: UUID,
    kind: ModelKind = Query(
        default="lithostratigraphic",
        description="Model kind the suggestions are for.",
    ),
) -> FormationCodelistResponse:
    """Kind-aware formation-name suggestion set (debt-campaign follow-on).

    Drives the editor autocomplete only — the create endpoint stays
    permissive. Declared before the dynamic ``/formations/{id}``
    routes so the static ``codelist`` segment is matched first.
    Project-independent vocabulary (``project_id`` is the router
    prefix); no project lookup needed.
    """
    # str(...) coerces the BaseLithology Literal keys to plain str —
    # dict/list are invariant so the response model's dict[str, str] /
    # list[str] would otherwise reject the Literal-typed source.
    litho_labels: dict[str, str] = {str(tok): en for tok, (_nl, en) in BASE_LITHOLOGIES.items()}
    lithologies: list[str] = [str(t) for t in BASE_LITHOLOGIES]

    if kind == "lithostratigraphic":
        return FormationCodelistResponse(
            kind=kind,
            lithologies=lithologies,
            lithology_labels=litho_labels,
            admixtures=list(ADMIXTURE_QUALIFIERS),
            nad_classes=[],
        )
    if kind == "geotechnical":
        return FormationCodelistResponse(
            kind=kind,
            lithologies=lithologies,
            lithology_labels=litho_labels,
            admixtures=[],
            nad_classes=[
                NadClassOption(nad_class=n, label=name, base_lithology=base)
                for n, (name, base) in NAD_CLASSES.items()
            ],
        )
    # geological — free / G3Dv3-seeded names, no fixed vocabulary here.
    return FormationCodelistResponse(
        kind=kind,
        lithologies=[],
        lithology_labels={},
        admixtures=[],
        nad_classes=[],
    )


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
    # Scope-check pre-update so a leaked id from another project doesn't
    # mutate a row this caller has no business touching.
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    # exclude_unset so omitted fields stay untouched and explicit null
    # only clears optional columns.
    patch = request.model_dump(exclude_unset=True)
    formation = await repo.update_formation(formation_id, patch)
    if formation is None:
        # TOCTOU race — row vanished between scope-check and update.
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
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    await repo.delete_formation(formation_id)
    await session.commit()


# ---------------------------------------------------------------------------
# Geotechnical units — formation subdivision (structure only in v1)
# ---------------------------------------------------------------------------


@router.post(
    "/formations/{formation_id}/units",
    response_model=GeotechnicalUnitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_unit(
    project_id: UUID,
    formation_id: UUID,
    request: GeotechnicalUnitCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechnicalUnitOrm:
    """Create a new geotechnical unit under a formation.

    Scope guard: the formation must exist and belong to the URL's
    project. The unit's ``app_project_id`` is sourced from the parent
    formation (denormalised onto the row), not the URL — same data,
    one source of truth.
    """
    repo = GeologyRepository(session)
    formation = await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    unit = await repo.create_unit(
        app_project_id=formation.app_project_id,
        geological_formation_id=formation_id,
        name=request.name,
        color=request.color,
        code=request.code,
        display_order=request.display_order,
        description=request.description,
    )
    await session.commit()
    await session.refresh(unit)
    return unit


@router.get(
    "/formations/{formation_id}/units",
    response_model=list[GeotechnicalUnitResponse],
)
async def list_units(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeotechnicalUnitOrm]:
    """List the geotechnical units under one formation."""
    repo = GeologyRepository(session)
    # Scope-check the formation; a missing formation 404s rather than
    # silently returning an empty list under a wrong-project guess.
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Formation not found"
    )
    return await repo.list_units(geological_formation_id=formation_id)


@router.patch(
    "/formations/{formation_id}/units/{unit_id}",
    response_model=GeotechnicalUnitResponse,
)
async def update_unit(
    project_id: UUID,
    formation_id: UUID,
    unit_id: UUID,
    request: GeotechnicalUnitUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> GeotechnicalUnitOrm:
    """Partial update on a unit. Only fields present in the body are written."""
    repo = GeologyRepository(session)
    # Two-stage scope guard: the unit must point at this formation,
    # AND the formation must live in this project. Single 404 message
    # either way — we don't leak which boundary the caller hit.
    await get_in_project_or_404(
        repo.get_unit(unit_id),
        formation_id,
        detail="Unit not found",
        project_attr="geological_formation_id",
    )
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Unit not found"
    )
    patch = request.model_dump(exclude_unset=True)
    updated = await repo.update_unit(unit_id, patch)
    if updated is None:
        # TOCTOU race — row vanished between scope-check and update.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found")
    await session.commit()
    await session.refresh(updated)
    return updated


@router.delete(
    "/formations/{formation_id}/units/{unit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_unit(
    project_id: UUID,
    formation_id: UUID,
    unit_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a geotechnical unit."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_unit(unit_id),
        formation_id,
        detail="Unit not found",
        project_attr="geological_formation_id",
    )
    await get_in_project_or_404(
        repo.get_formation(formation_id), project_id, detail="Unit not found"
    )
    await repo.delete_unit(unit_id)
    await session.commit()
