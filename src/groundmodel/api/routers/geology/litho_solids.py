"""Geology API — litho-3D solid cache endpoints.

Mounted under the shared ``/projects/{project_id}/geology`` prefix.

Endpoints
---------
GET  /models/{mid}/litho-solids
    List all cached ``LithoBodySolidOrm`` rows for the model.

POST /models/{mid}/litho-solids/build-voxel
    Trigger ``BuildVoxelLithoModel`` (on-click build) from the frontend's
    validated 2-D partitions and return the freshly built solid list
    alongside outcome counts.  (The retired implicit strat-field
    ``POST .../litho-solids/rebuild`` sibling was deleted with the
    strat_field builder — #237; git history has it.)

PATCH /models/{mid}/bodies/{body_id}/color
    Update ``BodyOrm.display_color`` for a body.  Additive endpoint —
    does not touch ``name``; the existing ``PATCH .../bodies/{body_id}``
    route requires a non-empty ``name`` which makes it unsuitable as a
    colour-only target without a breaking contract change.
GET  /models/{mid}/litho-solids/build-report
    Return the seven-clause gapless-gate report of the model's LATEST build
    generation (``None`` when no generation carries one — a model never
    built, or one built before the gate existed).  How reopening a project
    shows the last build's verdict without re-running the build.


GET  /models/{mid}/footprint
    Re-derive the model's footprint ring (the alpha hull the last voxel
    build clipped its labelling to) from the stored
    ``LithoBuildGeneration`` payload, via ``GetModelFootprint``.  The 3-D
    viewer draws it as a subtle closed ring so the model's edge reads as
    an edge, not a hole (owner ballot 2026-08-26, v1.0 MVP).  Never 404s
    for "nothing built yet" — see the handler docstring.

These are the litho analogue of the geological TIN surfaces endpoints
(``GET .../surfaces`` / ``POST .../surfaces/rebuild``).
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._dov_stream_helpers import sse_from_registry
from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.body.update_body_color_request import (
    UpdateBodyColorRequest,
    UpdateBodyColorResponse,
)
from groundmodel.api.schemas.project.gapless_build_report import GaplessBuildReportSchema
from groundmodel.api.schemas.project.litho_body_solid_response import LithoBodySolidResponse
from groundmodel.api.schemas.project.model_footprint_response import ModelFootprintResponse
from groundmodel.api.schemas.project.rebuild_litho_solids_response import (
    RebuildLithoSolidsResponse,
)
from groundmodel.api.schemas.project.voxel_build_request import VoxelBuildRequest
from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel
from groundmodel.application.get_model_footprint import GetModelFootprint
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.application.litho_solid_persistence import LithoSolidsOutcome
from groundmodel.domain.services.voxel_litho.voxel_types import SectionPartitionInput
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory, get_session
from groundmodel.shared.exceptions import (
    BuildCancelled,
    DuplicateImportJobError,
    VoxelGridTooLargeError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Private helper — join display_color from BodyOrm without lazy-loading
# ---------------------------------------------------------------------------


async def _body_attrs_by_body(
    session: AsyncSession, body_ids: list[UUID]
) -> dict[UUID, tuple[str | None, int]]:
    """Return each body's ``display_color`` and ``body_ordinal`` from ``BodyOrm``.

    A single bulk SELECT keyed on the body_ids seen in the solid rows —
    avoids lazy-loading ``BodyOrm`` from inside Pydantic serialisation
    (which would raise ``MissingGreenlet`` in an async context).

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    body_ids : list[UUID]
        The body ids whose attributes are needed.

    Returns
    -------
    dict[UUID, tuple[str | None, int]]
        ``body_id → (display_color, body_ordinal)``.  Bodies absent from the
        result set (not found in the DB) will be missing from the dict; callers
        default to ``(None, 0)`` in that case.
    """
    if not body_ids:
        return {}
    rows = (
        await session.execute(
            select(BodyOrm.id, BodyOrm.display_color, BodyOrm.body_ordinal).where(
                BodyOrm.id.in_(body_ids)
            )
        )
    ).all()
    return {row.id: (row.display_color, row.body_ordinal) for row in rows}


def _to_solid_response(
    solid: LithoBodySolidOrm,
    display_color: str | None,
    body_ordinal: int,
) -> LithoBodySolidResponse:
    """Build a :class:`LithoBodySolidResponse` from an ORM row + body attributes.

    Merges ``display_color`` and ``body_ordinal`` (both from ``BodyOrm``) into
    the response at construction time so Pydantic never touches a lazy
    attribute on the ``solid`` row.

    Parameters
    ----------
    solid : LithoBodySolidOrm
        The cached solid ORM row.
    display_color : str | None
        Colour override fetched from ``BodyOrm``; ``None`` falls back to the
        formation colour in the 3-D viewer.
    body_ordinal : int
        The body's ordinal within its formation's naming group, fetched from
        ``BodyOrm``; combined with the lithology gives a stable human handle
        such as "SILT #3".

    Returns
    -------
    LithoBodySolidResponse
        Fully populated response object.
    """
    return LithoBodySolidResponse(
        id=solid.id,
        model_id=solid.model_id,
        body_id=solid.body_id,
        formation_id=solid.formation_id,
        body_ordinal=body_ordinal,
        method=solid.method,
        vertices=solid.vertices,
        triangles=solid.triangles,
        is_stale=solid.is_stale,
        is_flagged=solid.is_flagged,
        display_color=display_color,
        created_at=solid.created_at,
        updated_at=solid.updated_at,
    )


# ---------------------------------------------------------------------------
# GET /models/{model_id}/litho-solids
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/litho-solids",
    response_model=list[LithoBodySolidResponse],
)
async def list_litho_solids(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[LithoBodySolidResponse]:
    """Return every cached 3-D solid in this lithostratigraphic model.

    The 3-D viewer fetches this once on load, indexes by ``body_id``,
    and renders each solid.  ``is_stale=True`` rows are rendered at
    lower opacity until the user clicks "Build 3-D model".

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model — must belong to ``project_id``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    list[LithoBodySolidResponse]
        All cached solid rows for this model (may be empty when no
        build has run yet).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(f"GET /projects/{project_id}/geology/models/{model_id}/litho-solids")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    repo = LithoLayerRepository(session)
    solids = await repo.list_litho_solids(model_id)

    # Bulk-load display_color + body_ordinal from BodyOrm to avoid lazy-load
    # during Pydantic serialisation (MissingGreenlet in async context).
    body_ids = [s.body_id for s in solids]
    body_attrs = await _body_attrs_by_body(session, body_ids)

    result = [_to_solid_response(s, *body_attrs.get(s.body_id, (None, 0))) for s in solids]
    logger.info(
        f"list_litho_solids: project={project_id} model={model_id} → {len(result)} solid(s)"
    )
    return result


async def _build_rebuild_response(
    session: AsyncSession,
    project_id: UUID,
    model_id: UUID,
    outcome: LithoSolidsOutcome,
    *,
    log_label: str,
) -> RebuildLithoSolidsResponse:
    """Load the rebuilt solid list + assemble the bundled rebuild response.

    Tail of the ``build-voxel`` endpoint: after the build use case commits,
    load the freshly persisted solid rows (joining ``display_color`` /
    ``body_ordinal`` from ``BodyOrm``) and bundle them with the outcome
    counts so the frontend updates its cache in one round-trip.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Project scope (for the log line only — the caller already guarded it).
    model_id : UUID
        The lithostratigraphic model whose solids were rebuilt.
    outcome : LithoSolidsOutcome
        The build outcome (both the strat and voxel use cases return this).
    log_label : str
        Short label distinguishing the two endpoints in the log line.

    Returns
    -------
    RebuildLithoSolidsResponse
        Outcome counts + the freshly rebuilt solid list.
    """
    repo = LithoLayerRepository(session)
    solids = await repo.list_litho_solids(model_id)
    body_ids = [s.body_id for s in solids]
    body_attrs = await _body_attrs_by_body(session, body_ids)
    solid_responses = [_to_solid_response(s, *body_attrs.get(s.body_id, (None, 0))) for s in solids]

    logger.info(
        f"{log_label}_litho_solids: project={project_id} model={model_id} "
        f"considered={outcome.bodies_considered} built={outcome.bodies_built} "
        f"skipped={outcome.bodies_skipped_checksum} flagged={outcome.bodies_flagged} "
        f"orphans_deleted={outcome.orphans_deleted} "
        f"solids_returned={len(solid_responses)} "
        f"marked_tests={len(outcome.marked_test_ids)} "
        f"uncovered_tests={len(outcome.uncovered_test_ids)} "
        f"gapless_verdict={outcome.gapless_report['verdict'] if outcome.gapless_report else None}"
    )
    return RebuildLithoSolidsResponse(
        bodies_considered=outcome.bodies_considered,
        bodies_built=outcome.bodies_built,
        bodies_skipped_checksum=outcome.bodies_skipped_checksum,
        bodies_flagged=outcome.bodies_flagged,
        orphans_deleted=outcome.orphans_deleted,
        solids=solid_responses,
        marked_test_ids=outcome.marked_test_ids,
        # Investigations outside the model footprint. Carried out so the client
        # can downgrade the toast: the build succeeded, but not for these.
        uncovered_test_ids=outcome.uncovered_test_ids,
        # Why an empty build is empty. An empty build also CLEARED the stored
        # 3-D model, so the client must not read zero bodies as a plain success.
        empty_reason=outcome.empty_reason,
        # The seven-clause gapless gate for THIS build. The application layer
        # returns a plain dict (it must not import API schemas), so the
        # validation into the schema happens here, at the API boundary.
        gapless_report=(
            GaplessBuildReportSchema.model_validate(outcome.gapless_report)
            if outcome.gapless_report is not None
            else None
        ),
    )


# ---------------------------------------------------------------------------
# POST /models/{model_id}/litho-solids/build-voxel
# ---------------------------------------------------------------------------


@router.post(
    "/models/{model_id}/litho-solids/build-voxel",
    response_model=RebuildLithoSolidsResponse,
)
async def build_voxel_litho_solids(
    project_id: UUID,
    model_id: UUID,
    request: VoxelBuildRequest,
    force: bool = Query(
        default=True,
        description=(
            "When true (the on-click Build default) always rebuild; when false "
            "the model-level partition checksum short-circuits an unchanged payload."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> RebuildLithoSolidsResponse:
    """Build the 3-D litho-solid cache from the validated 2-D voxel partitions.

    The PRIMARY way the user materialises the lithostratigraphic model into a
    3-D solid mesh.  Takes the frontend's validated ``computeSectionFill``
    partitions (the source of truth) and labels a 3-D voxel grid from them,
    then extracts each body's watertight greedy-meshed boundary — watertight
    AND faithful by construction (a labelling of space is a partition, so
    interfingering / pinch-out is representable).

    The Pydantic request is converted to the frozen domain value objects before
    the use case runs (the clean-architecture boundary).  ``force`` defaults to
    ``True`` (the on-click Build), so an explicit Build always re-meshes; pass
    ``force=false`` to let the partition-payload checksum skip an unchanged build.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model — must belong to ``project_id``.
    request : VoxelBuildRequest
        The per-section 2-D partitions + grid spacing (the build payload).
    force : bool, default ``True``
        Skip the checksum short-circuit when ``True``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    RebuildLithoSolidsResponse
        Outcome counts + the freshly built solid list (equivalent to calling
        ``GET .../litho-solids`` immediately after, bundled to save a
        round-trip).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(422)
        When the requested spacing resolves to more voxels than one build may
        allocate.  The detail is ``{"code": "voxel_grid_too_large", "message":
        ..., "suggested_horizontal_m": <float>}`` — the retry spacing stays a
        number so the client can offer the retry instead of parsing it out of
        prose or making the engineer guess.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/litho-solids/build-voxel "
        f"sections={len(request.sections)} "
        f"horizontal_spacing={request.effective_horizontal_spacing_m} "
        f"vertical_spacing={request.effective_vertical_spacing_m} force={force}"
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    # Convert the Pydantic request → frozen domain value objects (the domain
    # layer takes value objects, not Pydantic — clean-architecture boundary).
    # The effective spacings resolve the optional anisotropic fields against the
    # cubic ``grid_spacing_m`` fallback: the horizontal spacing is passed as the
    # use case's ``grid_spacing_m`` (the X/Y edge length), and the vertical
    # spacing is passed only when it differs from the horizontal so a cubic
    # payload keeps the byte-stable cubic checksum (``None`` → cubic).
    domain_sections = request.to_domain_sections()
    horizontal_m = request.effective_horizontal_spacing_m
    vertical_m = request.effective_vertical_spacing_m
    try:
        outcome = await BuildVoxelLithoModel(session).execute(
            model_id,
            domain_sections,
            grid_spacing_m=horizontal_m,
            vertical_spacing_m=(None if vertical_m == horizontal_m else vertical_m),
            force=force,
            gapless_2d=request.to_gapless_2d_dicts(),
        )
    except VoxelGridTooLargeError as err:
        # A spacing the engineer can simply retype — 422, never a 500 and never
        # the destructive "unbuildable model" path (which clears the stored 3-D
        # solids).  The stored model is untouched: nothing was written yet.
        logger.warning(
            f"build_voxel refused: project={project_id} model={model_id} — {err} "
            f"(suggested horizontal spacing {err.suggested_horizontal_m} m)"
        )
        # Structured, because the exception deliberately carries the retry
        # spacing as a NUMBER: prose would force the renderer to parse it back
        # out of a sentence to offer "retry at 3.0 m".
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "voxel_grid_too_large",
                "message": str(err),
                "suggested_horizontal_m": err.suggested_horizontal_m,
            },
        ) from err

    return await _build_rebuild_response(
        session, project_id, model_id, outcome, log_label="build_voxel"
    )


# ---------------------------------------------------------------------------
# Background voxel build: POST jobs / GET jobs/{id} (SSE) / POST jobs/{id}/cancel
#
# The synchronous endpoint above blocks until the three CPU phases finish, with
# no phase-name progress and no way to cancel a long build (debt #282). These
# three routes add exactly that, reusing the in-process job registry that already
# backs the DOV import stream: POST spawns a background task and answers a job-id
# at once; GET drains its progress as SSE; POST .../cancel sets the cooperative
# cancel flag the worker polls. The synchronous endpoint STAYS — some callers
# (and its tests) still want the one-shot form.
# ---------------------------------------------------------------------------

#: ``detail.code`` for a second concurrent build of the SAME model (409).
VOXEL_BUILD_ALREADY_RUNNING_CODE = "voxel_build_already_running"
#: Terminal SSE ``error`` code emitted when a build is cancelled by the user.
VOXEL_BUILD_CANCELLED_CODE = "build_cancelled"
#: Terminal SSE ``error`` code for an unexpected build failure.
VOXEL_BUILD_FAILED_CODE = "build_failed"


def _voxel_build_job_key(model_id: UUID) -> str:
    """De-duplication scope key — at most one live 3-D build per model."""
    return f"build-voxel:{model_id}"


async def _run_voxel_build_job(
    queue: Any,
    *,
    project_id: UUID,
    model_id: UUID,
    domain_sections: list[SectionPartitionInput],
    horizontal_m: float,
    vertical_m: float,
    force: bool,
    gapless_2d: list[dict[str, Any]] | None,
    cancel_event: threading.Event,
) -> None:
    """Run one background voxel build, emitting SSE events onto ``queue``.

    Mirrors the DOV import coroutine: it owns its OWN ``AsyncSession`` (the
    spawning request's session is closed when the ``202`` returns) and puts
    ``dict`` events plus a terminal ``None`` sentinel on the queue. Progress is
    bridged from the CPU worker thread onto the event loop with
    ``loop.call_soon_threadsafe`` — the labeller's per-column ticks fire inside
    ``asyncio.to_thread``, so a plain call would touch the queue from the wrong
    thread. On success it emits the SAME payload the synchronous endpoint
    returns (a ``RebuildLithoSolidsResponse``), so the renderer refreshes
    identically. On cancel the use case has already rolled back — the model is
    untouched — and this emits ``build_cancelled``.

    Parameters
    ----------
    queue : _BoundedJobQueue
        The job's event channel (from ``JobRegistry.start``).
    project_id, model_id : UUID
        Scope of the build (already 404-guarded by the spawning endpoint).
    domain_sections : list of SectionPartitionInput
        The frozen domain partitions (converted from the Pydantic request in the
        endpoint, so this coroutine never sees a schema object).
    horizontal_m, vertical_m : float
        The resolved X/Y and Z spacings; ``vertical_m == horizontal_m`` means a
        cubic grid (passed to the use case as ``vertical_spacing_m=None``).
    force : bool
        Skip the checksum short-circuit (the on-click Build passes ``True``).
    gapless_2d : list of dict, or None
        The renderer's clause 1-4 findings, or ``None``.
    cancel_event : threading.Event
        The cooperative-cancel flag; its ``.is_set`` is the build's
        ``should_cancel`` predicate.
    """
    loop = asyncio.get_running_loop()

    def emit(phase: str, done: int, total: int) -> None:
        """Marshal one progress event onto the loop (safe from any thread)."""
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {"type": "progress", "phase": phase, "done": done, "total": total},
        )

    async with AsyncSessionFactory() as session:
        try:
            outcome = await BuildVoxelLithoModel(session).execute(
                model_id,
                domain_sections,
                grid_spacing_m=horizontal_m,
                vertical_spacing_m=(None if vertical_m == horizontal_m else vertical_m),
                force=force,
                gapless_2d=gapless_2d,
                should_cancel=cancel_event.is_set,
                progress=emit,
            )
            response = await _build_rebuild_response(
                session, project_id, model_id, outcome, log_label="build_voxel_job"
            )
            # Same payload the synchronous endpoint returns, so the renderer's
            # done handler refreshes exactly what the one-shot path refreshed.
            await queue.put({"type": "done", **response.model_dump(mode="json")})
        except BuildCancelled:
            # ``execute`` has already rolled back — the stored model is untouched.
            logger.info(
                f"build_voxel_job cancelled: project={project_id} model={model_id} "
                "— nothing written"
            )
            await queue.put(
                {
                    "type": "error",
                    "code": VOXEL_BUILD_CANCELLED_CODE,
                    "message": "Build cancelled",
                }
            )
        except VoxelGridTooLargeError as exc:
            logger.warning(
                f"build_voxel_job refused: project={project_id} model={model_id} — {exc} "
                f"(suggested horizontal spacing {exc.suggested_horizontal_m} m)"
            )
            await queue.put(
                {
                    "type": "error",
                    "code": "voxel_grid_too_large",
                    "message": str(exc),
                    "suggested_horizontal_m": exc.suggested_horizontal_m,
                }
            )
        except Exception as exc:  # noqa: BLE001 — a background task must report, never crash
            # The traceback matters here: a background job has no request to
            # surface it on, and the terminal event carries only the message.
            logger.exception(
                f"build_voxel_job unexpected error: project={project_id} model={model_id} — "
                f"{type(exc).__name__}: {exc}"
            )
            await queue.put(
                {
                    "type": "error",
                    "code": VOXEL_BUILD_FAILED_CODE,
                    "message": "Build failed unexpectedly",
                }
            )
        finally:
            # Sentinel: the SSE generator exits on None.
            await queue.put(None)


def _voxel_build_factory(
    *,
    project_id: UUID,
    model_id: UUID,
    domain_sections: list[SectionPartitionInput],
    horizontal_m: float,
    vertical_m: float,
    force: bool,
    gapless_2d: list[dict[str, Any]] | None,
    cancel_event: threading.Event,
) -> Any:
    """Bind the build arguments into a ``JobRegistry.start`` coroutine factory.

    ``JobRegistry.start`` calls the returned factory with the freshly created
    queue and expects a coroutine back. The factory resolves
    ``_run_voxel_build_job`` by module-global name at call time, so a test can
    monkeypatch it with a fake build.

    Parameters
    ----------
    project_id, model_id, domain_sections, horizontal_m, vertical_m, force, \
gapless_2d, cancel_event
        Forwarded verbatim to :func:`_run_voxel_build_job`.

    Returns
    -------
    Callable[[_BoundedJobQueue], Coroutine]
        A factory suitable for ``JobRegistry.start``.
    """

    def factory(queue: Any) -> object:
        return _run_voxel_build_job(
            queue,
            project_id=project_id,
            model_id=model_id,
            domain_sections=domain_sections,
            horizontal_m=horizontal_m,
            vertical_m=vertical_m,
            force=force,
            gapless_2d=gapless_2d,
            cancel_event=cancel_event,
        )

    return factory


@router.post(
    "/models/{model_id}/litho-solids/build-voxel/jobs",
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_voxel_build_job(
    project_id: UUID,
    model_id: UUID,
    request: VoxelBuildRequest,
    force: bool = Query(
        default=True,
        description=(
            "When true (the on-click Build default) always rebuild; when false "
            "the model-level partition checksum short-circuits an unchanged payload."
        ),
    ),
    session: AsyncSession = Depends(get_session),
    registry: JobRegistry = Depends(get_job_registry),
) -> dict[str, str]:
    """Spawn a 3-D voxel build in the background and return its job-id at once.

    The build runs in its own ``asyncio.Task`` (with an independent session)
    under the same per-process CPU lock the synchronous endpoint uses, so a
    second Build still waits for memory rather than competing for it. The client
    connects to ``GET .../build-voxel/jobs/{job_id}`` for the SSE progress stream
    and can stop it with ``POST .../build-voxel/jobs/{job_id}/cancel``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic / geotech model — must belong to ``project_id``.
    request : VoxelBuildRequest
        The per-section 2-D partitions + grid spacing (the build payload).
    force : bool, default ``True``
        Skip the checksum short-circuit when ``True``.
    session : AsyncSession
        Database session provided by DI (used only for the 404 scope guard; the
        build task opens its own).
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    dict
        ``{"job_id": "<uuid>"}``.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    HTTPException(409)
        When a 3-D build for this model is already running; the detail carries
        ``code = "voxel_build_already_running"`` and the running ``job_id`` so
        the client can attach to the existing stream.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}/litho-solids/build-voxel/jobs "
        f"sections={len(request.sections)} "
        f"horizontal_spacing={request.effective_horizontal_spacing_m} "
        f"vertical_spacing={request.effective_vertical_spacing_m} force={force}"
    )
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    cancel_event = threading.Event()
    factory = _voxel_build_factory(
        project_id=project_id,
        model_id=model_id,
        domain_sections=request.to_domain_sections(),
        horizontal_m=request.effective_horizontal_spacing_m,
        vertical_m=request.effective_vertical_spacing_m,
        force=force,
        gapless_2d=request.to_gapless_2d_dicts(),
        cancel_event=cancel_event,
    )
    try:
        job_id = registry.start(
            factory, key=_voxel_build_job_key(model_id), cancel_event=cancel_event
        )
    except DuplicateImportJobError as exc:
        # Reworded from the exception's DOV-flavoured default ("import for this
        # area"): a build is per-model, not per-bbox.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": VOXEL_BUILD_ALREADY_RUNNING_CODE,
                "message": f"a 3-D build for this model is already running (job {exc.job_id})",
                "job_id": str(exc.job_id),
            },
        ) from exc
    logger.info(f"voxel build job {job_id} spawned: project={project_id} model={model_id}")
    return {"job_id": str(job_id)}


@router.get("/models/{model_id}/litho-solids/build-voxel/jobs/{job_id}")
async def stream_voxel_build_job(
    project_id: UUID,
    model_id: UUID,
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> StreamingResponse:
    """Drain a running voxel build's event queue as an SSE stream.

    Event shapes (the envelope the renderer's shared stream hook consumes):

    Progress tick:
        ``{"type": "progress", "phase": "label"|"reconcile"|"extract"|"persist",
        "done": int, "total": int}``

    Completion (the ``RebuildLithoSolidsResponse`` shape, spread under ``done``):
        ``{"type": "done", "bodies_built": int, "solids": [...], ...}``

    Error:
        ``{"type": "error", "code": "build_cancelled"|"voxel_grid_too_large"
        |"build_failed", "message": str, ...}``

    Parameters
    ----------
    project_id : UUID
        Project scope (path only — the job-id is the capability, matching the DOV
        stream GET).
    model_id : UUID
        Model scope (path only).
    job_id : UUID
        Job-id returned by ``POST .../build-voxel/jobs``.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    StreamingResponse
        ``Content-Type: text/event-stream``.

    Raises
    ------
    HTTPException(404)
        When no job with that id is registered (already finished and cleaned up,
        or never existed).
    """
    logger.info(
        f"GET /projects/{project_id}/geology/models/{model_id}"
        f"/litho-solids/build-voxel/jobs/{job_id}"
    )
    if job_id not in registry._jobs:  # noqa: SLF001 — registry is a plain dict wrapper
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active build job with id {job_id}",
        )
    return StreamingResponse(
        sse_from_registry(job_id, registry),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/models/{model_id}/litho-solids/build-voxel/jobs/{job_id}/cancel",
    status_code=status.HTTP_202_ACCEPTED,
)
async def cancel_voxel_build_job(
    project_id: UUID,
    model_id: UUID,
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> dict[str, bool]:
    """Request cancellation of a running voxel build.

    Sets the cooperative cancel flag the worker thread polls; the build then
    stops between columns, rolls back (leaving the model as it was), and emits a
    terminal ``build_cancelled`` event on its SSE stream. Best-effort: an unknown
    or already-finished job answers ``404`` rather than hanging.

    Parameters
    ----------
    project_id, model_id : UUID
        Scope (path only — the job-id is the capability).
    job_id : UUID
        Job-id returned by ``POST .../build-voxel/jobs``.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    dict
        ``{"cancelling": true}``.

    Raises
    ------
    HTTPException(404)
        When no cancellable job with that id exists.
    """
    logger.info(
        f"POST /projects/{project_id}/geology/models/{model_id}"
        f"/litho-solids/build-voxel/jobs/{job_id}/cancel"
    )
    if not registry.request_cancel(job_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "voxel_build_job_not_found",
                "message": f"No cancellable build job with id {job_id}",
            },
        )
    return {"cancelling": True}


# ---------------------------------------------------------------------------
# GET /models/{model_id}/litho-solids/build-report
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/litho-solids/build-report",
    response_model=GaplessBuildReportSchema | None,
)
async def get_litho_build_report(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> GaplessBuildReportSchema | None:
    """Return the seven-clause gapless-gate report of the model's LATEST build.

    Lets reopening a project show the last build's verdict without re-running
    the build — the report was assembled and stored on the generation row at
    build time (``BuildVoxelLithoModel``), so this is a plain read.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model — must belong to ``project_id``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    GaplessBuildReportSchema or None
        ``None`` when the model has never been built, or its latest
        generation predates the gate (carries no ``gapless_report``).

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(f"GET /projects/{project_id}/geology/models/{model_id}/litho-solids/build-report")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )
    row = (
        await session.execute(
            select(LithoBuildGenerationOrm.gapless_report)
            .where(LithoBuildGenerationOrm.model_id == model_id)
            .order_by(LithoBuildGenerationOrm.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        logger.info(f"get_litho_build_report: model={model_id} — no report available")
        return None
    logger.info(f"get_litho_build_report: model={model_id} — verdict={row['verdict']}")
    return GaplessBuildReportSchema.model_validate(row)


# ---------------------------------------------------------------------------
# PATCH /models/{model_id}/bodies/{body_id}/color
# ---------------------------------------------------------------------------


@router.patch(
    "/models/{model_id}/bodies/{body_id}/color",
    response_model=UpdateBodyColorResponse,
)
async def update_body_color(
    project_id: UUID,
    model_id: UUID,
    body_id: UUID,
    request: UpdateBodyColorRequest,
    session: AsyncSession = Depends(get_session),
) -> UpdateBodyColorResponse:
    """Update the per-body display colour override for the 3-D viewer.

    Additive endpoint — does not touch the body ``name``.  The existing
    ``PATCH .../bodies/{body_id}`` route requires a non-empty ``name``
    field, making it unsuitable as a colour-only target without a
    breaking contract change.

    ``display_color=null`` clears the override; the 3-D viewer then
    falls back to the formation (lithology) colour.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        Model scope guard.
    body_id : UUID
        Primary key of the ``BodyOrm`` row to update.
    request : UpdateBodyColorRequest
        ``display_color`` (hex string or ``None``).
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    UpdateBodyColorResponse
        The body id and persisted colour value.

    Raises
    ------
    HTTPException(404)
        When the body does not exist or belongs to a different
        project / model.
    """
    logger.info(
        f"PATCH /projects/{project_id}/geology/models/{model_id}"
        f"/bodies/{body_id}/color display_color={request.display_color!r}"
    )
    body = await session.get(BodyOrm, body_id)
    if body is None or body.app_project_id != project_id or body.model_id != model_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "body_not_found", "message": f"Body {body_id} not found."},
        )

    body.display_color = request.display_color
    await session.flush()
    await session.commit()

    logger.info(f"update_body_color: body={body_id} display_color={request.display_color!r}")
    return UpdateBodyColorResponse(body_id=body_id, display_color=body.display_color)


# ---------------------------------------------------------------------------
# GET /models/{model_id}/footprint
# ---------------------------------------------------------------------------


@router.get(
    "/models/{model_id}/footprint",
    response_model=ModelFootprintResponse,
)
async def get_model_footprint(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ModelFootprintResponse:
    """Return the model's footprint ring, re-derived from its last voxel build.

    The 3-D viewer draws this as a subtle closed ring so the model's edge
    reads as an edge, not a hole (owner ballot 2026-08-26, v1.0 MVP). The ring
    is re-derived from the persisted ``LithoBuildGeneration`` payload rather
    than recomputed on the frontend, so it always matches the exact alpha hull
    the build clipped its labelling to.

    Never answers 404/500 for "nothing built yet" — a model that has not been
    built, whose stored payload cannot frame a footprint, or whose payload was
    written by an older/foreign builder all answer 200 with an empty
    ``polygon`` and a plain-English ``unavailable_reason``. Only a model that
    does not belong to the project is a 404.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    model_id : UUID
        The lithostratigraphic model — must belong to ``project_id``.
    session : AsyncSession
        Database session provided by DI.

    Returns
    -------
    ModelFootprintResponse
        The ring (possibly empty) plus provenance / reason.

    Raises
    ------
    HTTPException(404)
        When the model does not belong to the project.
    """
    logger.info(f"GET /projects/{project_id}/geology/models/{model_id}/footprint")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id),
        project_id,
        detail="Model not found",
    )

    outcome = await GetModelFootprint(session).execute(model_id)

    logger.info(
        f"get_model_footprint: project={project_id} model={model_id} — "
        f"{len(outcome.polygon)}-vertex ring generation={outcome.generation_id} "
        f"reason={outcome.unavailable_reason!r}"
    )
    return ModelFootprintResponse(
        polygon=[[x, y] for x, y in outcome.polygon],
        generation_id=outcome.generation_id,
        built_at=outcome.built_at,
        unavailable_reason=outcome.unavailable_reason,
    )
