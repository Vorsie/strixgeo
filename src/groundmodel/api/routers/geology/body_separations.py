"""Geology API — body separations (the "Separate" verb, debt #278 R5).

Mounted under the shared /projects/{project_id}/geology prefix by the geology
package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/body-separations
  GET    /projects/{pid}/geology/models/{mid}/body-separations
  DELETE /projects/{pid}/geology/models/{mid}/body-separations/{sep_id}

Owner ruling 2026-08-31: a "Separate" verb, the counterpart to Dissolve, so the
engineer can state "these two are NOT the same body" and have the resolver
honour it PERMANENTLY. A separation is a cannot-link constraint in LAYER-id
space; the resolver reads it and drops any union (however indirect) that would
merge the two anchors.

Both write endpoints run the body resolver in the SAME request, under the
model's body-partition lock, so the split (or re-join) is durable even if the
frontend dies right after the call — the reversible-verb rule (fire, provide an
undo path) is satisfied by DELETE, which is the Rejoin.

Idempotency contract:
  POST   -> 201 when a new separation was created; 200 when it already existed
            (reversible verb — a duplicate returns the existing row, never 409).
  GET    -> 200 always (current separation list, possibly empty).
  DELETE -> 200 with the re-resolve diff; 404 when the separation is not on the
            model.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.body_separation.body_separation_schemas import (
    BodySeparationAnchorInfo,
    BodySeparationListItem,
    BodySeparationRejoinResponse,
    BodySeparationResponse,
    CreateBodySeparationRequest,
)
from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

router = APIRouter()

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)


def _canonical_pair(layer_a_id: UUID, layer_b_id: UUID) -> tuple[UUID, UUID]:
    """Order a layer pair so ``a < b`` (matching the DB CHECK / UNIQUE).

    Python's ``UUID`` comparison is by the 128-bit integer, which is the same
    big-endian byte order PostgreSQL's ``uuid`` type sorts by, so ordering the
    pair here produces exactly the arrangement the
    ``ck_body_separation_canonical_order`` CHECK accepts.
    """
    return (layer_a_id, layer_b_id) if layer_a_id < layer_b_id else (layer_b_id, layer_a_id)


@router.post(
    "/models/{model_id}/body-separations",
    response_model=BodySeparationResponse,
    status_code=status.HTTP_201_CREATED,
    summary='Separate two bodies — "these are NOT the same body" (debt #278 R5)',
)
async def create_body_separation(
    project_id: UUID,
    model_id: UUID,
    body: CreateBodySeparationRequest,
    session: AsyncSession = Depends(get_session),
) -> BodySeparationResponse:
    """Record that two bodies must never resolve into one, then re-resolve.

    Validates that both anchors are ACCEPTED layers of this model, canonicalises
    the pair, inserts the separation (idempotent on the unique constraint), and
    re-runs the body resolver in the same request under the model's
    body-partition lock so the split is durable.

    Returns **201** when a new separation is inserted; **200** when it already
    existed (reversible verb — a duplicate is not a conflict).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The model whose bodies are separated (path param).
    body : CreateBodySeparationRequest
        The two anchor layers (either order).

    Returns
    -------
    BodySeparationResponse
        The separation row + the re-resolve diff for the toast.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    422
        When the two anchors are not both accepted layers of this model, or are
        the same layer.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    layer_a_id, layer_b_id = _canonical_pair(body.layer_a_id, body.layer_b_id)

    accepted = {
        row.id
        for row in (
            await session.execute(
                select(LithoLayerOrm.id).where(
                    LithoLayerOrm.id.in_([layer_a_id, layer_b_id]),
                    LithoLayerOrm.model_id == model_id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        ).all()
    }
    if accepted != {layer_a_id, layer_b_id}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "body_separation_invalid_anchor",
                "message": ("Both layers must be accepted layers of this model to be separated."),
            },
        )

    # Take the partition lock now (after validation) so the find-or-create below
    # is serialised against a concurrent create of the same pair — two would
    # otherwise both INSERT and trip the unique constraint. Re-entrant with the
    # lock the resolver takes; releases on this request's commit / rollback.
    await lock_body_partition(session, model_id=model_id, operation="body-separations/create")

    existing = (
        await session.execute(
            select(BodySeparationOrm).where(
                BodySeparationOrm.model_id == model_id,
                BodySeparationOrm.layer_a_id == layer_a_id,
                BodySeparationOrm.layer_b_id == layer_b_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        # Reversible verb: the separation already stands, so the partition
        # already reflects it — no resolve needed, just release the lock.
        separation_id = existing.id
        was_created = False
        bodies_changed = 0
        renamed: tuple[str, ...] = ()
        await session.commit()
        logger.info(
            f"create_body_separation: project={project_id} model={model_id} "
            f"pair=({layer_a_id}, {layer_b_id}) already separated — no-op"
        )
    else:
        separation = BodySeparationOrm(
            id=uuid7(),
            model_id=model_id,
            layer_a_id=layer_a_id,
            layer_b_id=layer_b_id,
        )
        session.add(separation)
        await session.flush()
        separation_id = separation.id
        was_created = True
        # The resolver reads the just-flushed separation and re-partitions the
        # bodies, committing this request's transaction (insert + re-resolve).
        result = await ResolveLithoInstances(session).execute(model_id=model_id, commit=True)
        bodies_changed = len(result.updated)
        renamed = result.renamed
        logger.info(
            f"create_body_separation: project={project_id} model={model_id} "
            f"separated ({layer_a_id}, {layer_b_id}) — bodies_changed={bodies_changed}"
        )

    response = BodySeparationResponse(
        separation_id=separation_id,
        model_id=model_id,
        layer_a_id=layer_a_id,
        layer_b_id=layer_b_id,
        was_created=was_created,
        bodies_changed=bodies_changed,
        renamed=list(renamed),
    )
    if not was_created:
        return JSONResponse(  # type: ignore[return-value]
            content=response.model_dump(mode="json"),
            status_code=status.HTTP_200_OK,
        )
    return response


@router.get(
    "/models/{model_id}/body-separations",
    response_model=list[BodySeparationListItem],
    status_code=status.HTTP_200_OK,
    summary="List body separations with each anchor's current body (debt #278 R5)",
)
async def list_body_separations(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[BodySeparationListItem]:
    """Return the model's separations, each with its two anchors' current bodies.

    The FE renders "Rejoin with <label>" from the server-resolved display info:
    each anchor's live ``litho_layer.body_id`` mapped to the body's name /
    ordinal / formation, so the FE never owns a resolution map.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The model whose separations are listed (path param).

    Returns
    -------
    list[BodySeparationListItem]
        Separations ordered by creation time, each carrying both anchors'
        current-body display info.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    rows = list(
        (
            await session.execute(
                select(BodySeparationOrm)
                .where(BodySeparationOrm.model_id == model_id)
                .order_by(BodySeparationOrm.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return []

    anchor_ids = {row.layer_a_id for row in rows} | {row.layer_b_id for row in rows}
    body_by_layer: dict[UUID, UUID | None] = {
        r.id: r.body_id
        for r in (
            await session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.body_id).where(
                    LithoLayerOrm.id.in_(anchor_ids)
                )
            )
        ).all()
    }
    body_ids = {bid for bid in body_by_layer.values() if bid is not None}
    bodies = {
        r.id: r
        for r in (
            await session.execute(
                select(BodyOrm.id, BodyOrm.name, BodyOrm.body_ordinal, BodyOrm.formation_id).where(
                    BodyOrm.id.in_(body_ids)
                )
            )
        ).all()
    }

    def _anchor(layer_id: UUID) -> BodySeparationAnchorInfo:
        body_id = body_by_layer.get(layer_id)
        body = bodies.get(body_id) if body_id is not None else None
        return BodySeparationAnchorInfo(
            layer_id=layer_id,
            body_id=body_id,
            body_name=body.name if body is not None else None,
            body_ordinal=body.body_ordinal if body is not None else None,
            formation_id=body.formation_id if body is not None else None,
        )

    return [
        BodySeparationListItem(
            id=row.id,
            model_id=row.model_id,
            layer_a_id=row.layer_a_id,
            layer_b_id=row.layer_b_id,
            anchor_a=_anchor(row.layer_a_id),
            anchor_b=_anchor(row.layer_b_id),
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.delete(
    "/models/{model_id}/body-separations/{sep_id}",
    response_model=BodySeparationRejoinResponse,
    status_code=status.HTTP_200_OK,
    summary="Rejoin — lift a body separation and re-resolve (debt #278 R5)",
)
async def delete_body_separation(
    project_id: UUID,
    model_id: UUID,
    sep_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> BodySeparationRejoinResponse:
    """Delete one separation and re-run the resolver — the Rejoin.

    Lifting the cannot-link constraint lets the two anchors re-union if the ties
    / geometry facts still connect them. Runs under the model's body-partition
    lock and re-resolves in the same request so the re-join is durable.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The model the separation belongs to (path param).
    sep_id : UUID
        The separation to lift (path param).

    Returns
    -------
    BodySeparationRejoinResponse
        The re-resolve diff for the toast.

    Raises
    ------
    404
        When the model does not belong to ``project_id``, or the separation does
        not exist on this model.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    await lock_body_partition(session, model_id=model_id, operation="body-separations/delete")

    separation = (
        await session.execute(
            select(BodySeparationOrm).where(
                BodySeparationOrm.id == sep_id,
                BodySeparationOrm.model_id == model_id,
            )
        )
    ).scalar_one_or_none()
    if separation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Body separation not found",
        )

    await session.delete(separation)
    await session.flush()
    result = await ResolveLithoInstances(session).execute(model_id=model_id, commit=True)
    logger.info(
        f"delete_body_separation: project={project_id} model={model_id} sep={sep_id} "
        f"rejoined — bodies_changed={len(result.updated)}"
    )
    return BodySeparationRejoinResponse(
        bodies_changed=len(result.updated),
        renamed=list(result.renamed),
    )
