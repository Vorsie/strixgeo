"""Geology API — body unions (the "Join with…" verb, debt #278).

Mounted under the shared /projects/{project_id}/geology prefix by the geology
package __init__; paths extend to:

  POST   /projects/{pid}/geology/models/{mid}/body-unions
  GET    /projects/{pid}/geology/models/{mid}/body-unions
  DELETE /projects/{pid}/geology/models/{mid}/body-unions/{union_id}

Owner ruling 2026-08-31: a "Join with…" verb, the counterpart to Separate, so the
engineer can state "this body IS the same as that body" and have the resolver
honour it. A union is a must-link constraint in LAYER-id space; the resolver reads
it and merges the two anchors even when no edge connects them.

One guard is enforced at WRITE time so a bad union never reaches the table:

* **Never a mixed body** (``body_union_cross_class``, 422): the two anchors must
  describe one mass — the SAME ``same_mass`` predicate the resolver applies to
  an edge, reused here so the write guard cannot diverge from the resolve.

Owner 2026-09-01: the Separate / Rejoin verbs were removed and ``body_separation``
is DORMANT, so the former cannot-link pre-check (``body_union_contradicts_separation``,
422) was deleted — a leftover separation row must never refuse a Join. The
resolver ignores ``separations`` too, so a union always unions.

Both write endpoints run the body resolver in the SAME request, under the model's
body-partition lock, so the merge (or split) is durable even if the frontend dies
right after the call — the reversible-verb rule (fire, provide an undo path) is
satisfied by DELETE, which is the Disjoin.

Idempotency contract:
  POST   -> 201 when a new union was created; 200 when it already existed
            (reversible verb — a duplicate returns the existing row, never 409).
  GET    -> 200 always (current union list, possibly empty).
  DELETE -> 200 with the re-resolve diff; 404 when the union is not on the model.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.body_union.body_union_schemas import (
    BodyUnionAnchorInfo,
    BodyUnionDisjoinResponse,
    BodyUnionListItem,
    BodyUnionResponse,
    CreateBodyUnionRequest,
)
from groundmodel.application.body_partition_lock import lock_body_partition
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.domain.services.resolve_litho_instances import LayerNode, same_mass
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL
from groundmodel.shared.logging.logger_factory import LoggerFactory

router = APIRouter()

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)


def _canonical_pair(layer_a_id: UUID, layer_b_id: UUID) -> tuple[UUID, UUID]:
    """Order a layer pair so ``a < b`` (matching the DB CHECK / UNIQUE).

    Python's ``UUID`` comparison is by the 128-bit integer, which is the same
    big-endian byte order PostgreSQL's ``uuid`` type sorts by, so ordering the
    pair here produces exactly the arrangement the
    ``ck_body_union_canonical_order`` CHECK accepts.
    """
    return (layer_a_id, layer_b_id) if layer_a_id < layer_b_id else (layer_b_id, layer_a_id)


def _anchor_node(row: object, *, is_geotechnical: bool) -> LayerNode:
    """Build the minimal ``LayerNode`` the ``same_mass`` write guard needs.

    Mirrors the field mapping ``resolve_litho_instances_use_case`` uses so the
    router's class guard and the resolver's edge/union filter decide identically:
    a geotech model carries the formation row as its packing class + its
    ``nad_class``; a litho model carries neither, so ``same_mass`` falls to
    soil alone there. Only soil + packing are read by ``same_mass``; the other
    fields are placeholders.

    Parameters
    ----------
    row : object
        A result row with ``id``, ``formation_id``, ``litho_main_soil_code`` and
        ``nad_class`` attributes (the accepted-anchor query below).
    is_geotechnical : bool
        Whether the anchors' model is a geotechnical subdivision.

    Returns
    -------
    LayerNode
        A node carrying the anchor's soil + packing identity.
    """
    return LayerNode(
        layer_id=row.id,  # type: ignore[attr-defined]
        formation_id=row.formation_id,  # type: ignore[attr-defined]
        parent_formation_id=None,
        litho_main_soil_code=row.litho_main_soil_code,  # type: ignore[attr-defined]
        depth_top_m=0.0,
        source_investigation_id=row.id,  # type: ignore[attr-defined]
        packing_formation_id=row.formation_id if is_geotechnical else None,  # type: ignore[attr-defined]
        packing_nad_class=row.nad_class if is_geotechnical else None,  # type: ignore[attr-defined]
    )


@router.post(
    "/models/{model_id}/body-unions",
    response_model=BodyUnionResponse,
    status_code=status.HTTP_201_CREATED,
    summary='Join two bodies — "these ARE the same body" (debt #278)',
)
async def create_body_union(
    project_id: UUID,
    model_id: UUID,
    body: CreateBodyUnionRequest,
    session: AsyncSession = Depends(get_session),
) -> BodyUnionResponse:
    """Record that two bodies ARE one body, then re-resolve.

    Validates that both anchors are ACCEPTED layers of this model, that the two
    describe one mass (never a mixed body), and that no standing separation
    forbids the merge; then canonicalises the pair, inserts the union (idempotent
    on the unique constraint), and re-runs the body resolver in the same request
    under the model's body-partition lock so the merge is durable.

    Returns **201** when a new union is inserted; **200** when it already existed
    (reversible verb — a duplicate is not a conflict).

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The model whose bodies are joined (path param).
    body : CreateBodyUnionRequest
        The two anchor layers (either order).

    Returns
    -------
    BodyUnionResponse
        The union row + the re-resolve diff for the toast.

    Raises
    ------
    404
        When the model does not exist or does not belong to ``project_id``.
    422
        When the two anchors are not both accepted layers of this model
        (``body_union_invalid_anchor``); when they would make a mixed body
        (``body_union_cross_class``); or when a standing separation forbids the
        merge (``body_union_contradicts_separation``).
    """
    repo = GeologyRepository(session)
    model = await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    layer_a_id, layer_b_id = _canonical_pair(body.layer_a_id, body.layer_b_id)

    # Accepted-anchor guard + the class info the cross-class guard needs, in one
    # query joined to the formation row (soil + NAD class).
    anchor_rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.formation_id,
                LithoLayerOrm.body_id,
                GeologicalFormationOrm.litho_main_soil_code,
                GeologicalFormationOrm.nad_class,
            )
            .join(GeologicalFormationOrm, GeologicalFormationOrm.id == LithoLayerOrm.formation_id)
            .where(
                LithoLayerOrm.id.in_([layer_a_id, layer_b_id]),
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.status == "accepted",
            )
        )
    ).all()
    by_id = {row.id: row for row in anchor_rows}
    if set(by_id) != {layer_a_id, layer_b_id}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "body_union_invalid_anchor",
                "message": "Both layers must be accepted layers of this model to be joined.",
            },
        )

    # Never a mixed body: the two anchors must be ONE mass. Reuse the resolver's
    # own ``same_mass`` so this write guard cannot diverge from the resolve — a
    # union the router accepts is a union the resolver will actually apply.
    is_geotechnical = model.kind == MODEL_KIND_GEOTECHNICAL
    row_a, row_b = by_id[layer_a_id], by_id[layer_b_id]
    if not same_mass(
        _anchor_node(row_a, is_geotechnical=is_geotechnical),
        _anchor_node(row_b, is_geotechnical=is_geotechnical),
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "body_union_cross_class",
                "message": (
                    "The two bodies are different masses and cannot be joined into one — "
                    "a body is a single soil and packing class."
                ),
                "soil_a": row_a.litho_main_soil_code,
                "soil_b": row_b.litho_main_soil_code,
                "nad_class_a": row_a.nad_class,
                "nad_class_b": row_b.nad_class,
            },
        )

    # Owner 2026-09-01: the former cannot-link pre-check
    # (``body_union_contradicts_separation``, 422) was removed here. The Separate
    # verb is gone and ``body_separation`` is dormant — a leftover separation row
    # must never refuse a Join — so this endpoint no longer reads separations, and
    # the resolver ignores them too (a union always unions).

    # Take the partition lock now (after validation) so the find-or-create below
    # is serialised against a concurrent create of the same pair — two would
    # otherwise both INSERT and trip the unique constraint. Re-entrant with the
    # lock the resolver takes; releases on this request's commit / rollback.
    await lock_body_partition(session, model_id=model_id, operation="body-unions/create")

    existing = (
        await session.execute(
            select(BodyUnionOrm).where(
                BodyUnionOrm.model_id == model_id,
                BodyUnionOrm.layer_a_id == layer_a_id,
                BodyUnionOrm.layer_b_id == layer_b_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        # Reversible verb: the union already stands, so the partition already
        # reflects it — no resolve needed, just release the lock.
        union_id = existing.id
        was_created = False
        bodies_changed = 0
        renamed: tuple[str, ...] = ()
        suppressed = False
        inert = False
        await session.commit()
        logger.info(
            f"create_body_union: project={project_id} model={model_id} "
            f"pair=({layer_a_id}, {layer_b_id}) already joined — no-op"
        )
    else:
        union = BodyUnionOrm(
            id=uuid7(),
            model_id=model_id,
            layer_a_id=layer_a_id,
            layer_b_id=layer_b_id,
        )
        session.add(union)
        await session.flush()
        union_id = union.id
        was_created = True
        # The resolver reads the just-flushed union and re-partitions the bodies,
        # committing this request's transaction (insert + re-resolve).
        result = await ResolveLithoInstances(session).execute(model_id=model_id, commit=True)
        bodies_changed = len(result.updated)
        renamed = result.renamed
        # Surface the resolver's ground truth for THIS pair: the write-time
        # cross-class guard refuses an inert join with a 422, so ``inert`` is the
        # backstop for the case it cannot see (an anchor whose body_id was not
        # stamped when the guard ran). Without it a join that did nothing reads as
        # ``was_created: true, bodies_changed: 0``. ``suppressed`` is now always
        # False — separations are dormant (owner 2026-09-01), so the resolver never
        # suppresses a union — but the field is kept as a defensive backstop.
        pair = (layer_a_id, layer_b_id)
        suppressed = pair in result.suppressed_unions
        inert = pair in result.inert_unions
        logger.info(
            f"create_body_union: project={project_id} model={model_id} "
            f"joined ({layer_a_id}, {layer_b_id}) — bodies_changed={bodies_changed} "
            f"suppressed={suppressed} inert={inert}"
        )

    response = BodyUnionResponse(
        union_id=union_id,
        model_id=model_id,
        layer_a_id=layer_a_id,
        layer_b_id=layer_b_id,
        was_created=was_created,
        bodies_changed=bodies_changed,
        renamed=list(renamed),
        suppressed=suppressed,
        inert=inert,
    )
    if not was_created:
        return JSONResponse(  # type: ignore[return-value]
            content=response.model_dump(mode="json"),
            status_code=status.HTTP_200_OK,
        )
    return response


@router.get(
    "/models/{model_id}/body-unions",
    response_model=list[BodyUnionListItem],
    status_code=status.HTTP_200_OK,
    summary="List body unions with each anchor's current body (debt #278)",
)
async def list_body_unions(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[BodyUnionListItem]:
    """Return the model's unions, each with its two anchors' current bodies.

    The FE renders "Disjoin from <label>" from the server-resolved display info:
    each anchor's live ``litho_layer.body_id`` mapped to the body's name /
    ordinal / formation, so the FE never owns a resolution map.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The model whose unions are listed (path param).

    Returns
    -------
    list[BodyUnionListItem]
        Unions ordered by creation time, each carrying both anchors'
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
                select(BodyUnionOrm)
                .where(BodyUnionOrm.model_id == model_id)
                .order_by(BodyUnionOrm.created_at)
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

    def _anchor(layer_id: UUID) -> BodyUnionAnchorInfo:
        body_id = body_by_layer.get(layer_id)
        body = bodies.get(body_id) if body_id is not None else None
        return BodyUnionAnchorInfo(
            layer_id=layer_id,
            body_id=body_id,
            body_name=body.name if body is not None else None,
            body_ordinal=body.body_ordinal if body is not None else None,
            formation_id=body.formation_id if body is not None else None,
        )

    return [
        BodyUnionListItem(
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
    "/models/{model_id}/body-unions/{union_id}",
    response_model=BodyUnionDisjoinResponse,
    status_code=status.HTTP_200_OK,
    summary="Disjoin — lift a body union and re-resolve (debt #278)",
)
async def delete_body_union(
    project_id: UUID,
    model_id: UUID,
    union_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> BodyUnionDisjoinResponse:
    """Delete one union and re-run the resolver — the Disjoin.

    Lifting the must-link lets the two anchors fall back to whatever ties /
    geometry facts connect them; where none do, they split. Runs under the
    model's body-partition lock and re-resolves in the same request so the split
    is durable.

    Parameters
    ----------
    project_id : UUID
        Owning project (path param, scope guard).
    model_id : UUID
        The model the union belongs to (path param).
    union_id : UUID
        The union to lift (path param).

    Returns
    -------
    BodyUnionDisjoinResponse
        The re-resolve diff for the toast.

    Raises
    ------
    404
        When the model does not belong to ``project_id``, or the union does not
        exist on this model.
    """
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )

    await lock_body_partition(session, model_id=model_id, operation="body-unions/delete")

    union = (
        await session.execute(
            select(BodyUnionOrm).where(
                BodyUnionOrm.id == union_id,
                BodyUnionOrm.model_id == model_id,
            )
        )
    ).scalar_one_or_none()
    if union is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Body union not found",
        )

    await session.delete(union)
    await session.flush()
    result = await ResolveLithoInstances(session).execute(model_id=model_id, commit=True)
    logger.info(
        f"delete_body_union: project={project_id} model={model_id} union={union_id} "
        f"disjoined — bodies_changed={len(result.updated)} "
        f"suppressed_unions={len(result.suppressed_unions)} "
        f"inert_unions={len(result.inert_unions)}"
    )
    return BodyUnionDisjoinResponse(
        bodies_changed=len(result.updated),
        renamed=list(result.renamed),
        suppressed_unions=len(result.suppressed_unions),
        inert_unions=len(result.inert_unions),
    )
