"""CPT API route handlers."""

from __future__ import annotations

import asyncio
import json
import tempfile
from collections.abc import AsyncGenerator
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.cpt.cpt_list_item import CptListItem
from groundmodel.api.schemas.cpt.cpt_plot_batch_request import CptPlotBatchRequest
from groundmodel.api.schemas.cpt.cpt_plot_response import CptPlotResponse
from groundmodel.api.schemas.cpt.cpt_response import CptResponse
from groundmodel.api.schemas.cpt.import_cpt_response import ImportCptResponse
from groundmodel.api.schemas.cpt.import_dov_request import ImportDovRequest
from groundmodel.api.schemas.cpt.import_dov_response import ImportDovResponse
from groundmodel.api.schemas.elevation_patch_request import ElevationPatchRequest
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.domain.services.cpt_corrections import calculate_qt_series
from groundmodel.domain.services.cpt_interpretation import calculate_ic_series
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory, get_session
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import WfsIndexEntry
from groundmodel.shared.exceptions import DuplicateCptError, ParseError
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are functions, not classes, so the
# ``GroundModelLogger`` inheritance pattern doesn't apply. The
# documented fallback for stateless module functions is a single
# module-level logger via ``LoggerFactory``.
logger = LoggerFactory.get_logger(__name__)

# Cap on a single GEF upload's byte count (debt #39). A 100k-row CPT
# weighs ~4 MB on disk; 200 MiB is two orders of magnitude past that
# and still small enough to stream through ``tempfile`` without OOM.
_MAX_GEF_UPLOAD_BYTES = 200 * 1024 * 1024

router = APIRouter(prefix="/cpt", tags=["cpt"])


@router.post("/import", response_model=ImportCptResponse, status_code=status.HTTP_201_CREATED)
async def import_cpt(
    file: UploadFile,
    project_id: str | None = Form(None),
    session: AsyncSession = Depends(get_session),
) -> ImportCptResponse:
    """Import a CPT file and persist it to the database.

    Parameters
    ----------
    file:
        Uploaded CPT file.  GEF format is supported in Phase 1.
    project_id:
        UUID of the active app-level project.  CPT is tagged with this ID so
        it only appears in that project's list.  None = unscoped (tests/admin).
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ImportCptResponse
        UUID of the created record plus any validation issues found during
        parsing.  The CPT is persisted even when ``has_errors`` is True.

    Raises
    ------
    HTTPException(400)
        When the file extension is not supported, or the file is a duplicate
        (same contract number + test number already in the database).
    """
    logger.info(f"POST /cpt/import: file={file.filename!r} project_id={project_id}")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".gef"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Supported: .gef",
        )

    app_project_uuid: UUID | None = None
    if project_id:
        try:
            app_project_uuid = UUID(project_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid project_id: {project_id!r}",
            )

    # Stream-copy with a byte counter so a 5-GB "GEF" file can't OOM
    # the API by being slurped wholesale (debt #39). The cap is well
    # above any plausible real GEF (a 100k-row CPT is ~4 MB); the
    # outer BodySizeLimitMiddleware caps the request envelope at
    # 256 MiB but UploadFile streams chunk-by-chunk so we need the
    # per-upload guard here too.
    received = 0
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        while True:
            chunk = await file.read(1024 * 1024)  # 1 MiB
            if not chunk:
                break
            received += len(chunk)
            if received > _MAX_GEF_UPLOAD_BYTES:
                tmp_path = Path(tmp.name)
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"GEF upload exceeds the {_MAX_GEF_UPLOAD_BYTES // (1024 * 1024)} MiB cap"
                    ),
                )
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    try:
        result = await ImportCpt(session).execute(tmp_path, app_project_uuid)
    except DuplicateCptError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"cpt_id": str(exc.existing_id), "message": str(exc)},
        )
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)

    return ImportCptResponse(
        cpt_id=result.cpt_id,
        has_errors=result.has_errors,
        issues=[
            ValidationIssueSchema(
                level=i.level.value,
                code=i.code,
                message=i.message,
                rows=i.rows,
            )
            for i in result.issues
        ],
    )


@router.post("/import-dov", response_model=ImportDovResponse)
async def import_cpt_dov(
    request: ImportDovRequest,
    session: AsyncSession = Depends(get_session),
) -> ImportDovResponse:
    """Import CPTs from DOV within a WGS84 bounding box.

    Parameters
    ----------
    request:
        Bounding box (west, south, east, north in decimal degrees) and optional
        project_id.  The backend queries the DOV WFS, downloads CPT XMLs in
        parallel, and persists each one.

    Returns
    -------
    ImportDovResponse
        Counts of imported, duplicate, and failed CPTs plus all CPT IDs.

    Raises
    ------
    HTTPException(503)
        DOV unreachable (DNS / connection refused / no network).
    HTTPException(504)
        DOV did not respond within the timeout.
    HTTPException(502)
        DOV returned an unexpected error response (4xx/5xx from upstream).
    """
    try:
        result = await ImportCptDov(session).execute(
            west=request.west,
            south=request.south,
            east=request.east,
            north=request.north,
            app_project_id=request.project_id,
        )
    # On upstream failure, the user-facing ``detail`` carries only the
    # category + (when safe) the upstream HTTP status. Library class
    # names + exception messages are logged server-side so debugging
    # stays possible without leaking dependency versions or internal
    # topology to a future non-trusted caller (debt #43).
    except httpx.TimeoutException as exc:
        logger.warning(f"DOV import timeout: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="DOV did not respond in time",
        ) from exc
    except httpx.ConnectError as exc:
        logger.warning(f"DOV import connect error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot reach DOV — check your internet connection",
        ) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            f"DOV import upstream {exc.response.status_code}: {type(exc).__name__}: {exc}",
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DOV returned HTTP {exc.response.status_code}",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning(f"DOV import request error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DOV request failed",
        ) from exc

    return ImportDovResponse(
        imported=result.imported,
        duplicates=result.duplicates,
        failed=result.failed,
        cpt_ids=result.cpt_ids,
    )


def _make_cpt_dov_import_coro(
    request: ImportDovRequest,
    pool: ProcessPoolExecutor | None = None,
) -> AsyncGenerator[asyncio.Queue[dict | None], None]:
    """Return a coroutine-factory for the CPT DOV import background task.

    The returned factory accepts an ``asyncio.Queue`` and returns a
    coroutine.  ``JobRegistry.start`` calls it to create the task.
    The import coroutine:

    * Creates its own ``AsyncSession`` (independent of the spawning
      request's session — that session is closed when the ``202``
      response is sent).
    * Puts progress event dicts + a terminal ``None`` sentinel on the queue.

    Parameters
    ----------
    request : ImportDovRequest
        Bounding box + optional project_id.
    pool : ProcessPoolExecutor | None
        Optional process pool for offloading CPU-bound XML parsing.
        Passed through to ``ImportCptDov.execute()``.  ``None`` keeps
        the original single-process behaviour.

    Returns
    -------
    Callable[[asyncio.Queue], Coroutine[None]]
        Factory suitable for ``JobRegistry.start``.
    """

    def factory(queue: asyncio.Queue) -> object:  # -> Coroutine
        async def run_import() -> None:
            async def progress_cb(phase: str, done: int, total: int) -> None:
                await queue.put({"phase": phase, "done": done, "total": total})

            async def pins_cb(index: list[WfsIndexEntry]) -> None:
                # Emit a structured "pins" event so the frontend can render all N
                # pending map markers before any XML download has started.
                await queue.put(
                    {
                        "type": "pins",
                        "items": [
                            {
                                "permkey": e.permkey,
                                "name": e.name,
                                "x_lambert72": e.x_lambert72,
                                "y_lambert72": e.y_lambert72,
                            }
                            for e in index
                        ],
                    }
                )

            # Background task owns its own session so the spawning request's
            # session can be closed immediately (with the 202 response) without
            # holding a DB connection for the full import duration (~60 s cold).
            async with AsyncSessionFactory() as session:
                try:
                    result = await ImportCptDov(session).execute(
                        west=request.west,
                        south=request.south,
                        east=request.east,
                        north=request.north,
                        app_project_id=request.project_id,
                        progress_cb=progress_cb,
                        pins_cb=pins_cb,
                        pool=pool,
                    )
                    await queue.put(
                        {
                            "type": "done",
                            "imported": result.imported,
                            "duplicates": result.duplicates,
                            "failed": result.failed,
                            "cpt_ids": [str(cid) for cid in result.cpt_ids],
                        }
                    )
                except httpx.TimeoutException as exc:
                    logger.warning(f"DOV stream import timeout: {type(exc).__name__}: {exc}")
                    await queue.put({"type": "error", "message": "DOV did not respond in time"})
                except httpx.ConnectError as exc:
                    logger.warning(f"DOV stream import connect error: {type(exc).__name__}: {exc}")
                    await queue.put(
                        {
                            "type": "error",
                            "message": "Cannot reach DOV — check your internet connection",
                        }
                    )
                except httpx.HTTPStatusError as exc:
                    logger.warning(
                        f"DOV stream import upstream {exc.response.status_code}: "
                        f"{type(exc).__name__}: {exc}"
                    )
                    await queue.put(
                        {
                            "type": "error",
                            "message": f"DOV returned HTTP {exc.response.status_code}",
                        }
                    )
                except httpx.RequestError as exc:
                    logger.warning(f"DOV stream import request error: {type(exc).__name__}: {exc}")
                    await queue.put({"type": "error", "message": "DOV request failed"})
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"DOV stream import unexpected error: {type(exc).__name__}: {exc}")
                    await queue.put({"type": "error", "message": "Import failed unexpectedly"})
                finally:
                    # Sentinel: the SSE generator exits on None.
                    await queue.put(None)

        return run_import()

    return factory  # type: ignore[return-value]


async def _sse_from_registry(
    job_id: UUID,
    registry: JobRegistry,
) -> AsyncGenerator[str, None]:
    """Drain a job's event queue as SSE-formatted frames.

    Parameters
    ----------
    job_id : UUID
        Job-id registered by ``POST /import-dov/stream``.
    registry : JobRegistry
        The shared in-process job registry.

    Yields
    ------
    str
        SSE frames ``data: <json>\\n\\n``.
    """
    async for event in registry.stream(job_id):
        yield f"data: {json.dumps(event)}\n\n"


@router.post("/import-dov/stream", status_code=status.HTTP_202_ACCEPTED)
async def import_cpt_dov_stream(
    request: ImportDovRequest,
    http_request: Request,
    registry: JobRegistry = Depends(get_job_registry),
) -> dict:
    """Spawn a CPT DOV import as a background task and return its job-id.

    The import runs in the same asyncio event loop but in its own
    ``asyncio.Task`` with an independent ``AsyncSession``.  The spawning
    request completes immediately with ``202 Accepted``; the client
    connects to ``GET /cpt/import-dov/stream/{job_id}`` to receive the
    SSE progress stream.

    Decoupling the session from the connection lifetime means the import
    no longer holds a DB connection open for the full ~60 s cold-cache
    duration.  Cancellation via ``DELETE /jobs/{job_id}`` leaves every
    XML already written to the on-disk cache intact so subsequent imports
    of the same bbox are cache-warm.

    Parameters
    ----------
    request : ImportDovRequest
        Bounding box (west, south, east, north) + optional project_id.
    http_request : Request
        FastAPI ``Request`` object; used to access ``app.state.parse_pool``.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    dict
        ``{"job_id": "<uuid>"}``
    """
    # Retrieve the parse pool from app state (set in lifespan). Falls back to
    # None gracefully if the attribute is absent (e.g. in unit tests that don't
    # go through lifespan).
    pool: ProcessPoolExecutor | None = getattr(http_request.app.state, "parse_pool", None)
    factory = _make_cpt_dov_import_coro(request, pool=pool)
    job_id = registry.start(factory)
    logger.info(f"DOV CPT import job {job_id} spawned")
    return {"job_id": str(job_id)}


@router.get("/import-dov/stream/{job_id}")
async def get_cpt_dov_stream(
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> StreamingResponse:
    """Drain the SSE event queue for a running CPT DOV import job.

    The client opens this endpoint after receiving the job-id from
    ``POST /cpt/import-dov/stream``.  Events are identical in shape to
    the former inline SSE stream:

    Pins (once, immediately after WFS discovery):
        ``{"type": "pins", "items": [...]}``

    Progress tick:
        ``{"phase": "...", "done": int, "total": int}``

    Completion:
        ``{"type": "done", "imported": int, ...}``

    Error:
        ``{"type": "error", "message": str}``

    Parameters
    ----------
    job_id : UUID
        Job-id returned by ``POST /cpt/import-dov/stream``.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    StreamingResponse
        ``Content-Type: text/event-stream``.

    Raises
    ------
    HTTPException(404)
        When no job with that id is registered (already finished and
        cleaned up, or never existed).
    """
    if job_id not in registry._jobs:  # noqa: SLF001 — registry is a plain dict wrapper
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active import job with id {job_id}",
        )
    return StreamingResponse(
        _sse_from_registry(job_id, registry),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/", response_model=list[CptListItem])
async def list_cpts(
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[CptListItem]:
    """Return a lightweight summary list of CPTs.

    Parameters
    ----------
    project_id:
        When provided, only return CPTs belonging to this app-level project UUID.
        When absent, return all CPTs (used by tests and admin tools).
    session:
        Database session injected by FastAPI dependency injection.
    """
    app_project_uuid: UUID | None = None
    if project_id:
        try:
            app_project_uuid = UUID(project_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid project_id: {project_id!r}",
            )

    repo = CptRepository(session)
    cpts = await repo.list_all(app_project_uuid)
    return [
        CptListItem(
            id=c.id,
            name=c.name,
            cpt_type=c.cpt_type,
            max_depth_m=c.max_depth_m,
            n_rows=c.n_rows,
            location_x=c.location_x,
            location_y=c.location_y,
            epsg=c.epsg,
            elevation_m=c.elevation_m,
            z_epsg=c.z_epsg,
            elevation_source=c.elevation_source,
        )
        for c in cpts
    ]


@router.get("/{cpt_id}", response_model=CptResponse)
async def get_cpt(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptResponse:
    """Return full CPT metadata for a single record."""
    repo = CptRepository(session)
    cpt = await repo.get_by_id(cpt_id)
    if cpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")

    return CptResponse(
        id=cpt.id,
        name=cpt.name,
        cpt_type=cpt.cpt_type,
        location_x=cpt.location_x,
        location_y=cpt.location_y,
        epsg=cpt.epsg,
        elevation_m=cpt.elevation_m,
        z_epsg=cpt.z_epsg,
        elevation_source=cpt.elevation_source,
        pre_drill_m=cpt.pre_drill_m,
        cone_area_ratio=cpt.cone_area_ratio,
        max_depth_m=cpt.max_depth_m,
        n_rows=cpt.n_rows,
    )


@router.patch("/{cpt_id}/elevation", response_model=CptResponse)
async def patch_cpt_elevation(
    cpt_id: UUID,
    request: ElevationPatchRequest,
    session: AsyncSession = Depends(get_session),
) -> CptResponse:
    """Update the manually-entered surface elevation for a CPT.

    The desktop frontend's Phase 3a ``ElevationEditor`` calls this when the
    user fills in the missing Z for a DOV/GEF row that came in without one.
    Setting ``elevation_m`` to ``null`` clears the value (returns the row to
    the "needs Z" state) so the user can undo a typo.

    Returns the full ``CptResponse`` so the frontend can update its detail
    cache without firing a second ``GET`` after save.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given id exists.
    """
    logger.info(
        f"PATCH /cpt/{cpt_id}/elevation: elevation_m={request.elevation_m} z_epsg={request.z_epsg}"
    )
    repo = CptRepository(session)
    # The repository derives the canonical vertical CRS from the row's
    # horizontal EPSG when ``z_epsg`` is None (e.g. 31370 → 5710 mTAW for
    # Belgium, 28992 → 5709 NAP for the Netherlands). The desktop UI
    # doesn't expose a CRS picker today, so this is the path taken in
    # practice; multi-country imports just work.
    cpt = await repo.set_elevation(cpt_id, request.elevation_m, request.z_epsg)
    if cpt is None:
        logger.warning(f"PATCH /cpt/{cpt_id}/elevation → 404 (not found)")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")
    # Debt #34: a contact's absolute z is elevation_m − depth_top_m, so
    # changing this CPT's elevation invalidates every cached TIN that
    # has a contact anchored here. Flip those surfaces stale in the SAME
    # transaction as the elevation write so the section editor / 3D
    # viewer correctly show "needs rebuild" instead of rendering the
    # old geometry as fresh.
    flipped = await GeologyRepository(session).stale_surfaces_for_investigation(cpt_id=cpt_id)
    if flipped:
        logger.info(f"PATCH /cpt/{cpt_id}/elevation: staled {flipped} dependent surface(s)")
    await session.commit()
    return CptResponse(
        id=cpt.id,
        name=cpt.name,
        cpt_type=cpt.cpt_type,
        location_x=cpt.location_x,
        location_y=cpt.location_y,
        epsg=cpt.epsg,
        elevation_m=cpt.elevation_m,
        z_epsg=cpt.z_epsg,
        elevation_source=cpt.elevation_source,
        pre_drill_m=cpt.pre_drill_m,
        cone_area_ratio=cpt.cone_area_ratio,
        max_depth_m=cpt.max_depth_m,
        n_rows=cpt.n_rows,
    )


@router.delete("/{cpt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cpt(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a CPT and its series data.

    Parameters
    ----------
    cpt_id:
        UUID of the CPT to delete.
    session:
        Database session injected by FastAPI dependency injection.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given ID exists.
    """
    logger.info(f"DELETE /cpt/{cpt_id}")
    repo = CptRepository(session)
    cpt = await repo.get_by_id(cpt_id)
    if cpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")
    # Cascade-drop the polymorphic review row for this CPT before the
    # CPT itself goes away — investigation_review has no DB-side FK
    # to cpt, so without this call the review row dangles and shows
    # up as an orphan in the bundle on Save (debt #21).
    review_repo = InvestigationReviewRepository(session)
    await review_repo.delete_for_target("cpt", cpt_id)
    await repo.delete(cpt_id)
    await session.commit()
    logger.info(f"DELETE /cpt/{cpt_id} → deleted")


def _plot_response_from_cpt(cpt: CptOrm) -> CptPlotResponse:
    """Build a ``CptPlotResponse`` from a CPT row whose ``series`` is loaded.

    Shared between ``GET /cpt/{id}/plot`` (single) and ``POST /cpt/plot-batch``
    (many — used by the cross-section panel to fetch all in-buffer CPTs in
    one round-trip). Both Ic and qt are derived on-read per the Data
    Integrity Rules — never stored.

    Raises ``ValueError`` when ``cpt.series`` is None so the caller can
    decide how to surface it (404 for the single endpoint, skip-with-
    flag in the batch path).
    """
    s = cpt.series
    if s is None:
        raise ValueError("Series data not found for this CPT")

    ic = (
        calculate_ic_series(
            depths_m=s.depths_m,
            qc_mpa=s.qc_mpa,
            fs_mpa=s.fs_mpa,
            gwt_m=cpt.water_depth_m if cpt.water_depth_m is not None else 1.0,
        )
        if s.fs_mpa is not None
        else None
    )

    # qt (CPTU corrected cone resistance) is recomputed on every read from the
    # persisted qc, u2, and cone_area_ratio. Returns None when any input is
    # missing — never invents a value (see Data Integrity Rules §1).
    qt_mpa = calculate_qt_series(
        qc_mpa=s.qc_mpa,
        u2_mpa=s.u2_mpa,
        cone_area_ratio=cpt.cone_area_ratio,
    )

    return CptPlotResponse(
        cpt_id=cpt.id,
        depths_m=s.depths_m,
        qc_mpa=s.qc_mpa,
        fs_mpa=s.fs_mpa,
        u2_mpa=s.u2_mpa,
        rf_pct=s.rf_pct,
        qt_mpa=qt_mpa,
        q_total_mpa=s.q_total_mpa,
        ic=ic,
        rf_source=s.rf_source,
    )


@router.get("/{cpt_id}/plot", response_model=CptPlotResponse)
async def get_cpt_plot(
    cpt_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptPlotResponse:
    """Return raw depth-series arrays for plotting qc, fs, and u2 vs depth."""
    repo = CptRepository(session)
    cpt = await repo.get_by_id(cpt_id)
    if cpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")
    try:
        return _plot_response_from_cpt(cpt)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err


@router.post("/plot-batch", response_model=list[CptPlotResponse])
async def post_cpt_plot_batch(
    request: CptPlotBatchRequest,
    session: AsyncSession = Depends(get_session),
) -> list[CptPlotResponse]:
    """Batch the per-CPT plot endpoint into one round-trip.

    Used by the cross-section panel: a section with N in-buffer CPTs
    folds N HTTP calls into one. Unknown ids and series-less CPTs are
    silently skipped from the response — the caller's render path
    already gates on "plot data exists for this CPT" before drawing
    the qc / Rf channels, so a missing row is indistinguishable from
    "not yet imported".

    Body cap: 500 ids per request — guards against a runaway caller
    DOS'ing the API with one giant batch. The cross-section view's
    typical N is <30 today; 500 leaves headroom for very dense
    project bboxes.
    """
    logger.info(f"POST /cpt/plot-batch: {len(request.ids)} ids, scope={request.app_project_id}")
    repo = CptRepository(session)
    cpts = await repo.get_many_with_series(request.ids, app_project_id=request.app_project_id)
    out: list[CptPlotResponse] = []
    for cpt in cpts:
        try:
            out.append(_plot_response_from_cpt(cpt))
        except ValueError:
            # Series rowless — same drop-from-response policy as the
            # single endpoint's 404, except batch can't 404 per item.
            continue
    logger.info(f"POST /cpt/plot-batch → {len(out)}/{len(request.ids)} plots returned")
    return out
