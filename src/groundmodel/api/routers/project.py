"""Project API route handlers — list, create, read, update, archive, unarchive."""

from __future__ import annotations

import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
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
from groundmodel.application.reconcile_bodies_after_restore import (
    reconcile_bodies_after_restore,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    BundleIntegrityError,
    build_project_bundle,
    restore_project_bundle,
)
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_clone import (
    BundleCloneIncompleteError,
)
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory
from groundmodel.shared.timing import ms_since

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
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[ProjectOrm]
        Project rows (serialised as ``list[ProjectResponse]``), ordered
        most-recent first.
    """
    repo = ProjectRepository(session)
    return await repo.list_all(include_archived=include_archived)


@router.get("/archived", response_model=list[ProjectResponse])
async def list_archived_projects(
    session: AsyncSession = Depends(get_session),
) -> list[ProjectOrm]:
    """List only archived projects, ordered by archive date (most-recent first).

    Parameters
    ----------
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[ProjectOrm]
        Archived project rows (serialised as ``list[ProjectResponse]``),
        ordered by ``archived_at`` most-recent first.
    """
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

    Parameters
    ----------
    request : ProjectCreateRequest
        New-project metadata (name, project number, client, site label,
        description, tags, default horizontal/vertical EPSG, phase, status).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The newly-created project row (serialised as ``ProjectResponse``),
        refreshed so server-side defaults (``created_at`` / ``updated_at`` /
        ``tags``) are populated. Response status is ``201 Created``.
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
    """Return a single project by id.

    Parameters
    ----------
    project_id : UUID
        Primary key of the project to fetch.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The matching project row (serialised as ``ProjectResponse``).

    Raises
    ------
    HTTPException(404)
        When no project with that id exists.
    """
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

    Parameters
    ----------
    project_id : UUID
        Primary key of the project to update.
    request : ProjectUpdateRequest
        Partial metadata update; only fields explicitly present in the JSON
        body are applied (``model_dump(exclude_unset=True)``).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The updated project row (serialised as ``ProjectResponse``),
        refreshed after commit.

    Raises
    ------
    HTTPException(404)
        When no project with that id exists.
    HTTPException(400)
        When the body explicitly sets ``name`` or ``status`` to ``null``
        (both are NOT NULL — omit the field to leave it unchanged).
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
    """Soft-delete a project — hide from default listings, keep all data.

    Parameters
    ----------
    project_id : UUID
        Primary key of the project to archive.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The archived project row (serialised as ``ProjectResponse``), with
        ``archived_at`` now set.

    Raises
    ------
    HTTPException(404)
        When no project with that id exists.
    """
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
    """Restore a previously-archived project to active status.

    Parameters
    ----------
    project_id : UUID
        Primary key of the project to unarchive.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The reactivated project row (serialised as ``ProjectResponse``), with
        ``archived_at`` cleared.

    Raises
    ------
    HTTPException(404)
        When no project with that id exists.
    """
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
    include_solids: bool = True,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Return a complete snapshot of a project + every CPT and borehole.

    Backs the desktop client's File → Save: the response is embedded
    verbatim in the .gmproj file and POSTed back to ``/restore`` if
    the DB ever loses the rows. UUIDs and dates serialise to strings;
    geometry is dropped (rebuilt from x/y/epsg on restore).

    ``include_solids`` (default ``True``) controls whether the cached
    ``litho_solids`` 3-D meshes ride along. The desktop File → Save passes
    ``include_solids=false``: the .strix v3 file never stores the meshes
    (``buildProjectFile`` drops the key) and nothing in the client reads
    them from the bundle, so the ~10 MB of vertices/triangles was pure
    over-the-wire waste that made every save slow.

    Parameters
    ----------
    project_id : UUID
        Primary key of the project to snapshot.
    include_solids : bool
        When ``True`` (default), embed the cached ``litho_solids`` 3-D
        meshes. Pass ``False`` (as File → Save does) to omit them.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    dict[str, object]
        The full project bundle (serialised as ``ProjectBundleResponse``):
        project metadata plus every CPT and borehole, with UUIDs/dates as
        strings and geometry dropped (rebuilt from x/y/epsg on restore).

    Raises
    ------
    HTTPException(404)
        When no project with that id exists.
    HTTPException(422)
        When the DB is self-inconsistent (e.g. layers reference formations
        that no longer exist) so the bundle cannot be safely written
        (``BundleIntegrityError``).
    """
    # File → Save round-trips this ~10 MB export on every save; log its
    # entry + outcome (counts + latency) so a slow or failed save is
    # diagnosable without a re-run.
    logger.info(f"GET /projects/{project_id}/bundle: include_solids={include_solids}")
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        logger.warning(f"GET /projects/{project_id}/bundle: 404 — project not found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    t0 = time.perf_counter()
    try:
        bundle = await build_project_bundle(session, project, include_solids=include_solids)
    except BundleIntegrityError as err:
        # 422: the DB is self-inconsistent (layers reference formations
        # that no longer exist) so the bundle cannot be safely written.
        # 500 would suggest a server bug; 422 says "your data is bad,
        # here's what's wrong" — actionable.
        logger.warning(f"GET /projects/{project_id}/bundle: 422 BundleIntegrityError — {err}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    # Bundle values are typed ``object``; guard the len() so mypy stays clean
    # and a shape change can't crash the log line.
    cpts = bundle.get("cpts")
    boreholes = bundle.get("boreholes")
    n_cpts = len(cpts) if isinstance(cpts, list) else 0
    n_boreholes = len(boreholes) if isinstance(boreholes, list) else 0
    logger.success(
        f"GET /projects/{project_id}/bundle ok: {n_cpts} CPTs, {n_boreholes} boreholes, "
        f"include_solids={include_solids} in {ms_since(t0)} ms"
    )
    return bundle


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

    Parameters
    ----------
    project_id : UUID
        Target project id — used both as the URL scope and, when the project
        row is missing, as the id of the freshly-inserted shell.
    request : ProjectBundleRequest
        The bundle to materialise (project metadata + CPTs + boreholes +
        geological/litho payloads). ``format_version`` gates acceptance.
    replace : bool
        When ``True`` (``?replace=true``), wipe the project's child
        collections before insert so the result matches the bundle exactly
        (revert-to-last-save, debt #160). Defaults to ``False``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The materialised project row (serialised as ``ProjectResponse``),
        refreshed after commit.

    Raises
    ------
    HTTPException(400)
        When ``format_version`` is not in ``SUPPORTED_BUNDLE_VERSIONS``, or
        the bundle shape is invalid (``ValueError`` / ``KeyError`` /
        ``TypeError`` from the restore).
    HTTPException(422)
        When the bundle parsed cleanly but is self-inconsistent (e.g.
        contacts/layers reference formations not in the bundle) —
        ``BundleIntegrityError``. The replace-restore guard refuses to wipe
        the DB in this state.
    """
    n_cpts = len(request.cpts) if request.cpts else 0
    n_bh = len(request.boreholes) if request.boreholes else 0
    n_formations = len(request.geological_formations) if request.geological_formations else 0
    n_models = len(request.geological_models) if request.geological_models else 0
    logger.info(
        f"POST /projects/{project_id}/restore: format_version={request.format_version} "
        f"replace={replace} cpts={n_cpts} boreholes={n_bh} "
        f"formations={n_formations} models={n_models}"
    )

    # Reject unsupported versions loudly. v1/v2 were dev-only; opening
    # one now means the file pre-dates the principle that decisions
    # live in the bundle, and silently materialising the partial state
    # would lose data the user assumes is intact. When v4 lands, v3
    # will stay in SUPPORTED_BUNDLE_VERSIONS with an upgrade step
    # before reaching restore_project_bundle.
    if request.format_version not in SUPPORTED_BUNDLE_VERSIONS:
        logger.warning(
            f"POST /projects/{project_id}/restore: rejected — "
            f"format_version={request.format_version} not in {sorted(SUPPORTED_BUNDLE_VERSIONS)}"
        )
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
            bodies_payload=request.bodies,
            formation_absences_payload=request.formation_absences,
            litho_contact_correlation_edges_payload=request.litho_contact_correlation_edges,
            body_geometry_facts_payload=request.body_geometry_facts,
            body_boundary_shapes_payload=request.body_boundary_shapes,
            body_boundary_nodes_payload=request.body_boundary_nodes,
            litho_solids_payload=request.litho_solids,
            geotech_tie_tombstones_payload=request.geotech_tie_tombstones,
            body_separations_payload=request.body_separations,
            body_unions_payload=request.body_unions,
            replace=replace,
        )
    except BundleIntegrityError as err:
        # 422: the bundle parsed cleanly but is self-inconsistent (e.g.
        # contacts/layers reference formations not in the bundle). The
        # replace-restore guard refuses to wipe the DB in this state —
        # the actionable error reaches the user instead of a silent
        # 833-layer wipe (2026-05-31 dogfeed).
        logger.warning(f"POST /projects/{project_id}/restore: BundleIntegrityError — {err}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    except (ValueError, KeyError, TypeError) as err:
        # Surface bad bundle shape as 400 instead of letting it 500.
        logger.warning(
            f"POST /projects/{project_id}/restore: invalid bundle shape — "
            f"{type(err).__name__}: {err}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid bundle payload: {err}",
        ) from err

    # ------------------------------------------------------------------ #
    # Body reconciliation on restore — resolver ONLY.                     #
    #                                                                      #
    # ``ResolveLithoInstances`` keeps body rows in sync with the restored #
    # correlation graph (one body per connected component, ``body_id``    #
    # stamps current, orphan unnamed bodies removed).  Runs for litho AND #
    # geotech models (both carry ``litho_layer.body_id``) via the shared  #
    # helper, so reopening a subdivided project keeps its geotech body    #
    # grouping instead of leaving it NULL until the next subdivide.       #
    #                                                                      #
    # ``DetectBodies`` is deliberately NOT run here.  Body EXTENTS are     #
    # section-scoped (2D) and ride in the bundle's ``bodies[]`` array      #
    # already — re-detecting on restore has no active section, so it would #
    # overwrite the user's nearest-target extents with the geometry-free   #
    # UUID fallback (dogfeed 2026-06-03).  The interactive                 #
    # ``POST .../bodies/detect`` (with the active ``section_id``) is the   #
    # only thing that sets or reconciles extents.                          #
    # ------------------------------------------------------------------ #
    await reconcile_bodies_after_restore(session, project_id)

    await session.commit()
    await session.refresh(project)
    logger.info(
        f"POST /projects/{project_id}/restore → ok: "
        f"cpts={n_cpts} boreholes={n_bh} replace={replace}"
    )
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
    """Deep-clone a project — investigations AND the whole interpretation.

    Backs the desktop client's File → Save As. ``name`` defaults to
    ``"Copy of <source name>"`` when omitted. The new project starts in
    ``active`` status regardless of the source's lifecycle.

    The copy is driven off the same bundle build + restore the .strix
    round-trip uses, so it carries the geological formations, the three
    model levels with their contacts and litho layers, the cross-sections,
    the bodies, the correlation edges, the reviews and the cached solids —
    not just the raw CPTs and boreholes. Body ids are re-stamped by the
    same resolver pass the restore endpoint runs, because the restore drops
    ``litho_layer.body_id`` for the resolver to re-derive.

    Parameters
    ----------
    project_id : UUID
        Primary key of the source project to clone.
    request : ProjectDuplicateRequest
        Duplicate options; ``name`` is the new project's name (defaults to
        ``"Copy of <source name>"`` when omitted).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The newly-created clone (serialised as ``ProjectResponse``),
        refreshed after commit. Response status is ``201 Created``.

    Raises
    ------
    HTTPException(404)
        When the source project id is unknown.
    HTTPException(500)
        When the copy came out with fewer rows than the source
        (``BundleCloneIncompleteError``). Nothing is committed, so the
        source is untouched and no half-empty copy reaches the client —
        the engineer sees the failure instead of a snapshot that quietly
        lacks his interpretation.
    """
    # File → Save As deep-clones the whole project tree — a heavy write;
    # log entry + outcome (new id + latency) so a slow/failed Save As is
    # diagnosable.
    logger.info(f"POST /projects/{project_id}/duplicate: name={request.name!r}")
    t0 = time.perf_counter()
    repo = ProjectRepository(session)
    try:
        duplicate = await repo.duplicate(project_id, new_name=request.name)
    except BundleCloneIncompleteError as err:
        # Never commit a lossy copy: the client adopts the duplicate the
        # moment this returns, so a silent partial copy would become the
        # session the engineer keeps working in.
        await session.rollback()
        logger.error(f"POST /projects/{project_id}/duplicate: incomplete copy — {err}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(err),
        ) from err
    if duplicate is None:
        logger.warning(f"POST /projects/{project_id}/duplicate: 404 — source project not found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    # The restore leaves ``litho_layer.body_id`` NULL for the resolver to
    # re-stamp (same contract as open-from-file), so run the same pass the
    # restore endpoint runs or the copy opens with no body grouping.
    await reconcile_bodies_after_restore(session, duplicate.id)
    await session.commit()
    await session.refresh(duplicate)
    logger.success(
        f"POST /projects/{project_id}/duplicate ok → {duplicate.id} "
        f"(name={duplicate.name!r}) in {ms_since(t0)} ms"
    )
    return duplicate
