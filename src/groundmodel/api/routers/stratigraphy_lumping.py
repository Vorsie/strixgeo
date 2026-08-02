"""Stratigraphy-lumping persistence routes.

Two endpoints under ``/projects/{project_id}/stratigraphy-lumping``:

* ``PUT /staged`` — called by "Fill from boreholes → Apply". Writes the
  snapshot to ``project.stratigraphy_lumping_staged`` immediately, so a
  crash before File → Save no longer loses the map. Carries the optional
  monotonic ``revision`` and rejects a stale one with 409 (see the handler).
* ``POST /promote`` — called by File → Save. Copies ``staged`` onto
  ``saved``; never touches the revision.

Why this surface and not something smaller
------------------------------------------
The obvious "smallest" option is a single PATCH taking both slots. It was
rejected: it lets a caller write ``saved`` without ever having staged the
value, which is exactly the two-stage-save violation the removed
``writeLumpingSnapshot`` attempt made. Promote-as-a-verb makes the only
legal transition into ``saved`` a server-side copy, so ``saved`` can never
hold something the user did not apply first.

Reading needs no endpoint at all: both slots ride on ``ProjectResponse``,
so the renderer seeds them from the project GET it already performs on
open. That is the ``view_state`` precedent — a write-only sub-resource
whose reads come along with the parent.

Both handlers return the full ``ProjectResponse`` so the caller can refresh
its in-memory project handle without a second GET (again mirroring
``PATCH /projects/{id}/view-state``).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.project.project_response import ProjectResponse
from groundmodel.api.schemas.project.stratigraphy_lumping import (
    StratigraphyLumpingStageRequest,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/stratigraphy-lumping",
    tags=["stratigraphy-lumping"],
)


@router.put("/staged", response_model=ProjectResponse)
async def stage_stratigraphy_lumping(
    project_id: UUID,
    request: StratigraphyLumpingStageRequest,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Write the lumping snapshot to the project's ``staged`` slot.

    Whole-value replace, not a merge: the map is one atomic snapshot
    stamped with its own ``applied_at``, so merging two Applies would
    produce a map that was never applied at any single moment.

    ``saved`` is deliberately left alone — the resulting ``staged !=
    saved`` state is the dirty signal the desktop shows as the unsaved
    asterisk.

    Monotonic revision guard
    ------------------------
    When the body carries a ``revision`` and the row already stores one, a
    LOWER incoming revision is rejected with 409: it can only come from a
    stale writer (a resurrected debounce timer, a recovered session replaying
    an old snapshot) and accepting it would silently roll the map back. Equal
    revisions ARE accepted — that is an idempotent retry of the same stage.
    A body without a ``revision`` (older / simpler client) writes the map and
    leaves the stored counter untouched.

    Clearing (``lumping = null``) is a stage action like any other: both the
    guard and the revision store apply to it identically.

    Parameters
    ----------
    project_id : UUID
        Project whose staged slot is written.
    request : StratigraphyLumpingStageRequest
        Body carrying the snapshot (or ``null`` to clear the slot) plus the
        optional renderer-owned monotonic ``revision``.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The updated project row (serialised as ``ProjectResponse``).

    Raises
    ------
    HTTPException
        Status 404 when no project with ``project_id`` exists; status 409
        when ``request.revision`` is older than the stored revision.
    """
    project = await _get_project_or_404(session, project_id)

    incoming = request.lumping
    stored_revision = project.stratigraphy_lumping_revision
    if (
        request.revision is not None
        and stored_revision is not None
        and request.revision < stored_revision
    ):
        detail = f"Stale lumping stage: revision {request.revision} < stored {stored_revision}"
        logger.warning(f"Rejecting stage for project {project_id}: {detail}")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

    summary = "cleared" if incoming is None else f"{len(incoming.map)} entries"
    logger.info(f"Staging lumping map for project {project_id}: {summary} (rev {request.revision})")
    # ``mode='json'`` so the JSONB column receives plain JSON scalars —
    # the sub-object is str/int only today, but the dump mode keeps that
    # true if a typed field (date, UUID) is ever added to it.
    project.stratigraphy_lumping_staged = (
        None if incoming is None else incoming.model_dump(mode="json")
    )
    # Only advance the counter when the client actually tracks one; a
    # revision-less client must not reset a counter a revision-aware client
    # already established for this project.
    if request.revision is not None:
        project.stratigraphy_lumping_revision = request.revision

    await session.commit()
    await session.refresh(project)
    logger.success(f"Lumping map staged for project {project_id}")
    return project


@router.post("/promote", response_model=ProjectResponse)
async def promote_stratigraphy_lumping(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Copy ``staged`` onto ``saved`` — the File → Save half of the model.

    ``staged`` is intentionally NOT cleared: the renderer keeps editing
    that slot, and leaving it in place is what makes ``staged == saved``
    read as "clean" straight after a save.

    Idempotent, and a no-op when nothing was ever staged (both slots stay
    NULL) — saving a project that never ran Fill from boreholes must not
    invent an empty map.

    ``stratigraphy_lumping_revision`` is left COMPLETELY alone here: the
    counter tracks staged edits (Applies) only, and crash-recovery
    reconciliation compares it against the revision the recovery file
    recorded for the staged map. Bumping it on save would make a save look
    like an edit and desynchronise that comparison.

    Parameters
    ----------
    project_id : UUID
        Project whose staged slot is promoted.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ProjectOrm
        The updated project row (serialised as ``ProjectResponse``).

    Raises
    ------
    HTTPException
        Status 404 when no project with ``project_id`` exists.
    """
    project = await _get_project_or_404(session, project_id)

    staged = project.stratigraphy_lumping_staged
    summary = "nothing staged" if staged is None else f"{len(staged.get('map', {}))} entries"
    logger.info(f"Promoting lumping map for project {project_id}: {summary}")
    # Copy rather than alias: both columns must be independent JSON
    # documents, so a later Apply that rewrites ``staged`` cannot mutate
    # the snapshot the user already saved.
    project.stratigraphy_lumping_saved = None if staged is None else dict(staged)

    await session.commit()
    await session.refresh(project)
    logger.success(f"Lumping map promoted to saved for project {project_id}")
    return project


async def _get_project_or_404(session: AsyncSession, project_id: UUID) -> ProjectOrm:
    """Fetch the project row or raise HTTP 404.

    Mirrors the guard in ``PATCH /projects/{id}/view-state``; the shared
    ``get_in_project_or_404`` helper does not fit because the row being
    fetched IS the project, not a child scoped by ``app_project_id``.
    """
    project = await ProjectRepository(session).get_by_id(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project
