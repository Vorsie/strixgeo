"""Investigation review API routes.

Two distinct surfaces share this module:

1. ``/projects/{project_id}/reviews/*`` — per-(project, investigation)
   decisions. CRUD on rows; upsert-by-target is the dominant write
   path because the UI doesn't track review row ids.

2. ``/projects/{project_id}/view-state`` — project-level toggle bag.
   Lives on ``ProjectOrm.view_state`` (JSONB column) but is exposed as
   its own endpoint so callers can patch keys without round-tripping
   the full ProjectResponse + sending it through PATCH /projects/{id}.

Project scope: every route validates that the resolved row's
``app_project_id`` matches the URL's ``project_id`` so a leaked id from
project A can't read or mutate project B's data.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.project.investigation_review import (
    InvestigationReviewResponse,
    InvestigationReviewUpsertRequest,
    ProjectViewStatePatchRequest,
    ReviewTargetKind,
)
from groundmodel.api.schemas.project.project_response import ProjectResponse
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import (
    InvestigationReviewOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import get_session

router = APIRouter(prefix="/projects/{project_id}", tags=["investigation-review"])


# ---------------------------------------------------------------------------
# /reviews — per-investigation decision CRUD.
# ---------------------------------------------------------------------------


@router.get("/reviews", response_model=list[InvestigationReviewResponse])
async def list_reviews(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[InvestigationReviewOrm]:
    """Return every review row for a project, oldest first.

    Most callers won't iterate this — they prefer the per-target
    lookup. The list endpoint exists for the .gmproj round-trip and
    for the desktop sidebar's "show all reviewed/hidden" filter.
    """
    repo = InvestigationReviewRepository(session)
    return await repo.list_all(project_id)


@router.get(
    "/reviews/{target_kind}/{target_id}",
    response_model=InvestigationReviewResponse,
)
async def get_review_for_target(
    project_id: UUID,
    target_kind: ReviewTargetKind,
    target_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> InvestigationReviewOrm:
    """Fetch the decision row for a specific investigation.

    404 when no row has been written yet — callers should treat the
    absence as the default ``unreviewed`` / not-hidden state. The route
    handler doesn't auto-create on read to keep GET semantics pure.
    """
    repo = InvestigationReviewRepository(session)
    row = await repo.get_for_target(target_kind, target_id)
    if row is None or row.app_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No review row for this investigation in this project",
        )
    return row


@router.put(
    "/reviews/{target_kind}/{target_id}",
    response_model=InvestigationReviewResponse,
)
async def upsert_review_for_target(
    project_id: UUID,
    target_kind: ReviewTargetKind,
    target_id: UUID,
    request: InvestigationReviewUpsertRequest,
    session: AsyncSession = Depends(get_session),
) -> InvestigationReviewOrm:
    """Create or update the decision row for an investigation.

    Idempotent: if a row already exists for ``(target_kind, target_id)``
    it's updated in place; otherwise a new row is inserted with the
    supplied fields. ``reviewed_at`` is managed server-side as the
    status transitions through 'reviewed'.

    Validates that the target row actually exists for this project — a
    leaked id from another project (or a typo) is rejected as 404
    rather than silently inserting a review pointing at nothing.
    """
    target_exists = await _target_exists_in_project(session, project_id, target_kind, target_id)
    if not target_exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(f"No {target_kind} with id {target_id} exists in project {project_id}"),
        )

    repo = InvestigationReviewRepository(session)
    patch = request.model_dump(exclude_unset=True, exclude_none=False)
    try:
        row = await repo.set_for_target(project_id, target_kind, target_id, patch)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(err),
        ) from err
    await session.commit()
    await session.refresh(row)
    return row


@router.delete(
    "/reviews/{target_kind}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_review_for_target(
    project_id: UUID,
    target_kind: ReviewTargetKind,
    target_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Drop the decision row for an investigation.

    Semantically equivalent to "this investigation was never reviewed"
    — the default state (no row = unreviewed, not hidden) is restored.
    Used by the desktop "reset review" action and by integration tests.
    No 404 when the row is already absent — DELETE is idempotent.
    """
    repo = InvestigationReviewRepository(session)
    row = await repo.get_for_target(target_kind, target_id)
    if row is None or row.app_project_id != project_id:
        return
    await repo.delete(row.id)
    await session.commit()


# ---------------------------------------------------------------------------
# /view-state — project-level JSONB bag.
# ---------------------------------------------------------------------------


@router.patch("/view-state", response_model=ProjectResponse)
async def patch_project_view_state(
    project_id: UUID,
    request: ProjectViewStatePatchRequest,
    session: AsyncSession = Depends(get_session),
) -> ProjectOrm:
    """Shallow-merge the patch dict into ``project.view_state``.

    Each key in ``patch`` overwrites the same key in the existing
    ``view_state``; siblings are left untouched. Pass ``null`` for a
    key to remove it from the bag. Sending an empty patch is a no-op.

    Returns the full ProjectResponse so the caller can refresh its
    in-memory project handle without a second GET.
    """
    repo = ProjectRepository(session)
    project = await repo.get_by_id(project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Shallow merge. Build a new dict so SQLAlchemy notices the change
    # — JSONB columns require a *new* object reference to flag dirty.
    merged: dict[str, Any] = dict(project.view_state or {})
    for key, value in request.patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    project.view_state = merged

    await session.flush()
    await session.commit()
    await session.refresh(project)
    return project


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _target_exists_in_project(
    session: AsyncSession,
    project_id: UUID,
    target_kind: str,
    target_id: UUID,
) -> bool:
    """Verify ``(target_kind, target_id)`` resolves to a row in the project.

    Skips the FK-via-DB approach (we deliberately don't have one — see
    InvestigationReviewOrm docstring) and runs a small targeted SELECT
    that returns True/False without loading the row.
    """
    if target_kind == "cpt":
        row = await session.get(CptOrm, target_id)
    elif target_kind == "borehole":
        row = await session.get(BoreholeOrm, target_id)
    else:
        # Pydantic Literal already rejects other values at request
        # parse time; this branch is defence in depth.
        return False
    return row is not None and row.app_project_id == project_id
