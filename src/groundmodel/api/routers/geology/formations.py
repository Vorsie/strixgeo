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
from groundmodel.shared.constants.litho_constants import (
    ADMIXTURE_QUALIFIERS,
    BASE_LITHOLOGIES,
    NAD_CLASSES,
)
from groundmodel.shared.constants.model_kind import ModelKind
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# No prefix here — the package __init__ mounts this on the shared
# ``/projects/{project_id}/geology`` parent router (paths unchanged).
router = APIRouter()


# ---------------------------------------------------------------------------
# parent_formation_name enrichment helpers (Slice 5 / debt #67)
# ---------------------------------------------------------------------------


def _build_parent_name_map(
    formations: list[GeologicalFormationOrm],
) -> dict[UUID, str]:
    """Build an id → name lookup from an already-loaded formation list.

    Used to resolve ``parent_formation_name`` without any extra DB round-trip
    or SQLAlchemy relationship traversal (which would raise MissingGreenlet on
    an async session).  The formation set is always loaded before this is
    called — it is a pure dict comprehension over data already in memory.

    Parameters
    ----------
    formations : list[GeologicalFormationOrm]
        All formations for the project, loaded within the current session.

    Returns
    -------
    dict[UUID, str]
        ``{formation.id: formation.name}`` — covers every formation in the
        project so any ``parent_formation_id`` can be resolved in O(1).
    """
    return {f.id: f.name for f in formations}


def _build_parent_code_map(
    formations: list[GeologicalFormationOrm],
) -> dict[UUID, str | None]:
    """Build an id → code lookup from an already-loaded formation list.

    Mirrors :func:`_build_parent_name_map` for the parent geological formation
    ``code`` (the DOV codelist code) that drives the lens auto-name. Pure dict
    comprehension over in-memory data — no relationship traversal.

    Parameters
    ----------
    formations : list[GeologicalFormationOrm]
        All formations for the project, loaded within the current session.

    Returns
    -------
    dict[UUID, str | None]
        ``{formation.id: formation.code}`` for every project formation.
    """
    return {f.id: f.code for f in formations}


def _enrich_formation(
    row: GeologicalFormationOrm,
    name_map: dict[UUID, str],
    code_map: dict[UUID, str | None] | None = None,
) -> GeologicalFormationResponse:
    """Construct a ``GeologicalFormationResponse`` with parent name + code resolved.

    Uses ``model_validate`` (``from_attributes=True``) to copy every ORM
    attribute, then injects the derived ``parent_formation_name`` (and, when
    ``code_map`` is supplied, ``parent_formation_code``) from the pre-built
    maps.  No SQLAlchemy relationship is traversed.

    Parameters
    ----------
    row : GeologicalFormationOrm
        The ORM row to serialise.
    name_map : dict[UUID, str]
        ``{formation.id: formation.name}`` for every project formation.
    code_map : dict[UUID, str | None] | None
        ``{formation.id: formation.code}`` for every project formation. When
        omitted, ``parent_formation_code`` stays ``None``.

    Returns
    -------
    GeologicalFormationResponse
        Response schema with ``parent_formation_name`` (and optionally
        ``parent_formation_code``) populated (or ``None`` when the row has no
        parent or the parent id is absent from the maps).
    """
    response = GeologicalFormationResponse.model_validate(row)
    if row.parent_formation_id is not None:
        # Defensive: a litho unit whose parent was deleted after creation
        # returns None instead of raising (orphan case).
        response.parent_formation_name = name_map.get(row.parent_formation_id)
        if code_map is not None:
            response.parent_formation_code = code_map.get(row.parent_formation_id)
    # geological-model rows (parent_formation_id=None) → parent fields stay None.
    return response


def _enrich_formation_list(
    rows: list[GeologicalFormationOrm],
) -> list[GeologicalFormationResponse]:
    """Enrich a list of formation ORM rows with server-resolved parent name + code.

    Builds the ``id → name`` + ``id → code`` maps from the same list (parent
    formations are always in the same project-scoped list), then calls
    :func:`_enrich_formation` for each row.  One pass — O(n).

    Parameters
    ----------
    rows : list[GeologicalFormationOrm]
        All project formations, already loaded from the DB.

    Returns
    -------
    list[GeologicalFormationResponse]
        Serialised responses with ``parent_formation_name`` +
        ``parent_formation_code`` resolved for each litho unit (None for
        geological rows or orphans).
    """
    name_map = _build_parent_name_map(rows)
    code_map = _build_parent_code_map(rows)
    return [_enrich_formation(row, name_map, code_map) for row in rows]


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
) -> GeologicalFormationResponse:
    """Create a new formation under the given project.

    Also supports creating a lithostratigraphic child formation without a
    contact — the caller supplies ``parent_formation_id``,
    ``litho_main_soil_code``, and optionally ``litho_admixtures``.  This
    path was added for the "Add new unit" ghost flow (Bug 2 dogfeed
    2026-05-26): the FE creates the formation row first, then calls the
    manual ghost handler so the user can drag the contact into place via
    the normal ghost-extend-accept flow.  No 0.01 m sentinel contact is
    created.

    Parameters
    ----------
    project_id : UUID
        Project scope — the new formation is owned by this project.
    request : GeologicalFormationCreateRequest
        Creation body; only ``name`` is required.  For litho units,
        supply ``parent_formation_id`` + ``litho_main_soil_code`` (and
        optionally ``litho_admixtures``) so the find-or-create key in
        AcceptLithoSuggestions matches on re-use.
    session : AsyncSession
        DB session provided by DI.

    Returns
    -------
    GeologicalFormationResponse
        The newly created formation with ``parent_formation_name`` resolved.
    """
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
        parent_formation_id=request.parent_formation_id,
        litho_main_soil_code=request.litho_main_soil_code,
        litho_admixtures=request.litho_admixtures,
    )
    await session.commit()
    await session.refresh(formation)
    # Load the full project formation list for the parent-name map.
    # A freshly created formation with parent_formation_id=null resolves to
    # None trivially; a litho unit created here resolves its parent name.
    all_formations = await repo.list_formations(project_id)
    name_map = _build_parent_name_map(all_formations)
    code_map = _build_parent_code_map(all_formations)
    return _enrich_formation(formation, name_map, code_map)


@router.get("/formations", response_model=list[GeologicalFormationResponse])
async def list_formations(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[GeologicalFormationResponse]:
    """List all formations defined for a project.

    Parameters
    ----------
    project_id : UUID
        Project to list formations for.
    session : AsyncSession
        DB session provided by DI.

    Returns
    -------
    list[GeologicalFormationResponse]
        All formations ordered by ``display_order`` then name, with
        ``parent_formation_name`` server-resolved from the same list.
    """
    repo = GeologyRepository(session)
    formations = await repo.list_formations(project_id)
    return _enrich_formation_list(formations)


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

    Parameters
    ----------
    project_id : UUID
        Router-prefix parameter; unused for this vocabulary endpoint.
    kind : ModelKind
        Model kind to return vocabulary for.

    Returns
    -------
    FormationCodelistResponse
        Kind-appropriate vocabulary lists.
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
) -> GeologicalFormationResponse:
    """Partial update on a formation. Only fields present in the body are written.

    Parameters
    ----------
    project_id : UUID
        Scope guard — the formation must belong to this project.
    formation_id : UUID
        Formation to update.
    request : GeologicalFormationUpdateRequest
        Partial body; only keys present are written.
    session : AsyncSession
        DB session provided by DI.

    Returns
    -------
    GeologicalFormationResponse
        Updated formation with ``parent_formation_name`` server-resolved.

    Raises
    ------
    HTTPException(404)
        When the formation is missing or belongs to a different project.
    """
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
    # Load the full project formation list for the parent-name map.
    all_formations = await repo.list_formations(project_id)
    name_map = _build_parent_name_map(all_formations)
    code_map = _build_parent_code_map(all_formations)
    return _enrich_formation(formation, name_map, code_map)


@router.delete("/formations/{formation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_formation(
    project_id: UUID,
    formation_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a formation. Cascades to every contact that referenced it.

    Parameters
    ----------
    project_id : UUID
        Scope guard.
    formation_id : UUID
        Formation to delete.
    session : AsyncSession
        DB session provided by DI.
    """
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

    Parameters
    ----------
    project_id : UUID
        Scope guard.
    formation_id : UUID
        Parent formation.
    request : GeotechnicalUnitCreateRequest
        Creation body.
    session : AsyncSession
        DB session provided by DI.

    Returns
    -------
    GeotechnicalUnitOrm
        Newly created unit (FastAPI serialises via ``GeotechnicalUnitResponse``).
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
    """List the geotechnical units under one formation.

    Parameters
    ----------
    project_id : UUID
        Scope guard.
    formation_id : UUID
        Parent formation.
    session : AsyncSession
        DB session provided by DI.

    Returns
    -------
    list[GeotechnicalUnitOrm]
        Units sorted by ``display_order`` then name.
    """
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
    """Partial update on a unit. Only fields present in the body are written.

    Parameters
    ----------
    project_id : UUID
        Scope guard — the formation must belong to this project.
    formation_id : UUID
        Parent formation.
    unit_id : UUID
        Unit to update.
    request : GeotechnicalUnitUpdateRequest
        Partial body.
    session : AsyncSession
        DB session provided by DI.

    Returns
    -------
    GeotechnicalUnitOrm
        Updated unit.

    Raises
    ------
    HTTPException(404)
        When the unit or formation is missing or out of scope.
    """
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
    """Delete a geotechnical unit.

    Parameters
    ----------
    project_id : UUID
        Scope guard.
    formation_id : UUID
        Parent formation.
    unit_id : UUID
        Unit to delete.
    session : AsyncSession
        DB session provided by DI.
    """
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
