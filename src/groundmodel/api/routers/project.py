"""Project API route handlers — list, create, read, update, archive, unarchive."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.api.schemas.project.project_bundle import (
    BUNDLE_FORMAT_VERSION,
    SUPPORTED_BUNDLE_VERSIONS,
    ProjectBundleRequest,
    ProjectBundleResponse,
)
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
from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    BundleIntegrityError,
    build_project_bundle,
    restore_project_bundle,
)
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import MODEL_KIND_LITHOSTRATIGRAPHIC
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

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
    logger.info(f"POST /projects: name={request.name!r}")
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
    logger.info(f"POST /projects → created {project.id}")
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


@router.get("/{project_id}/bundle", response_model=ProjectBundleResponse)
async def get_project_bundle(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Return a complete snapshot of a project + every CPT and borehole.

    Backs the desktop client's File → Save: the response is embedded
    verbatim in the .gmproj file and POSTed back to ``/restore`` if
    the DB ever loses the rows. UUIDs and dates serialise to strings;
    geometry is dropped (rebuilt from x/y/epsg on restore).
    """
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    try:
        return await build_project_bundle(session, project)
    except BundleIntegrityError as err:
        # 422: the DB is self-inconsistent (layers reference formations
        # that no longer exist) so the bundle cannot be safely written.
        # 500 would suggest a server bug; 422 says "your data is bad,
        # here's what's wrong" — actionable.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err


@router.post("/{project_id}/restore", response_model=ProjectResponse)
async def restore_project(
    project_id: UUID,
    request: ProjectBundleRequest,
    replace: bool = False,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Idempotently materialise a project row + its CPTs + boreholes from a bundle.

    Backs the desktop client's "open from file" path when the DB no
    longer has the rows the file points at — typically because the user
    wiped the local DB while a .gmproj still lives on disk. The file is
    the user's anchor; the DB is just a cache.

    Replace mode (``?replace=true``) backs the "Don't Save" / revert-to-last-
    save flow (debt #160): the project's child collections are wiped before
    the insert (same transaction), so the project ends up matching the bundle
    EXACTLY — session creates, mutations, AND deletes are all reverted. The
    project shell row is preserved. Defaults to false (the open-from-file path
    is unchanged).

    Behaviour:

    * Project missing → INSERT shell with the URL-provided id + the
      bundle's project metadata. Existing project rows are NOT
      mutated (the DB version is authoritative when it exists).
    * CPTs / boreholes in the payload are inserted if their id is not
      already in the DB for this project. Existing rows are skipped.
      Two concurrent restores of the same bundle therefore both
      succeed without duplication.

    Always 200 (vs. 200/201 split) because the caller treats this as a
    single "ensure exists" semantic regardless of how many rows we
    actually inserted.
    """
    # Reject unsupported versions loudly. v1/v2 were dev-only; opening
    # one now means the file pre-dates the principle that decisions
    # live in the bundle, and silently materialising the partial state
    # would lose data the user assumes is intact. When v4 lands, v3
    # will stay in SUPPORTED_BUNDLE_VERSIONS with an upgrade step
    # before reaching restore_project_bundle.
    if request.format_version not in SUPPORTED_BUNDLE_VERSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Bundle format_version={request.format_version} is not supported "
                f"(this build accepts {sorted(SUPPORTED_BUNDLE_VERSIONS)}). "
                f"Re-save the project from a build that emits "
                f"format_version={BUNDLE_FORMAT_VERSION}."
            ),
        )
    try:
        project = await restore_project_bundle(
            session,
            project_id,
            request.project,
            request.cpts,
            request.boreholes,
            request.geological_formations,
            request.geological_models,
            request.cross_sections,
            request.investigation_reviews,
            geotechnical_units_payload=request.geotechnical_units,
            bodies_payload=request.bodies,
            formation_absences_payload=request.formation_absences,
            litho_contact_correlation_edges_payload=request.litho_contact_correlation_edges,
            body_boundary_shapes_payload=request.body_boundary_shapes,
            body_boundary_nodes_payload=request.body_boundary_nodes,
            replace=replace,
        )
    except BundleIntegrityError as err:
        # 422: the bundle parsed cleanly but is self-inconsistent (e.g.
        # contacts/layers reference formations not in the bundle). The
        # replace-restore guard refuses to wipe the DB in this state —
        # the actionable error reaches the user instead of a silent
        # 833-layer wipe (2026-05-31 dogfeed).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except (ValueError, KeyError, TypeError) as err:
        # Surface bad bundle shape as 400 instead of letting it 500.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid bundle payload: {err}",
        ) from err

    # ------------------------------------------------------------------ #
    # Body reconciliation on restore — resolver ONLY.                     #
    #                                                                      #
    # ``ResolveLithoInstances`` keeps body rows in sync with the restored #
    # correlation graph (one body per connected component, ``body_id``    #
    # stamps current, orphan unnamed bodies removed).                      #
    #                                                                      #
    # ``DetectBodies`` is deliberately NOT run here.  Body EXTENTS are     #
    # section-scoped (2D) and ride in the bundle's ``bodies[]`` array      #
    # already — re-detecting on restore has no active section, so it would #
    # overwrite the user's nearest-target extents with the geometry-free   #
    # UUID fallback (dogfeed 2026-06-03).  The interactive                 #
    # ``POST .../bodies/detect`` (with the active ``section_id``) is the   #
    # only thing that sets or reconciles extents.                          #
    # ------------------------------------------------------------------ #
    litho_model_ids = list(
        (
            await session.execute(
                select(GeologicalModelOrm.id).where(
                    GeologicalModelOrm.app_project_id == project_id,
                    GeologicalModelOrm.kind == MODEL_KIND_LITHOSTRATIGRAPHIC,
                )
            )
        )
        .scalars()
        .all()
    )
    for litho_model_id in litho_model_ids:
        await ResolveLithoInstances(session).execute(
            model_id=litho_model_id,
            commit=False,
        )

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
