"""CPT API route handlers."""

from __future__ import annotations

import asyncio
import tempfile
from collections.abc import AsyncGenerator
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING, Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._dov_stream_helpers import (
    DOV_UPSTREAM_ERRORS,
    dov_error_event,
    dov_import_job_key,
    dov_sse_stream_response,
    dov_too_large_event,
    map_dov_too_large_error,
    map_dov_upstream_error,
    map_duplicate_import_job,
)
from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.cpt.cpt_list_item import CptListItem
from groundmodel.api.schemas.cpt.cpt_plot_batch_request import CptPlotBatchRequest
from groundmodel.api.schemas.cpt.cpt_plot_response import CptPlotResponse
from groundmodel.api.schemas.cpt.cpt_response import CptResponse
from groundmodel.api.schemas.cpt.cpt_sbt_profile_response import CptSbtProfileResponse
from groundmodel.api.schemas.cpt.import_cpt_response import ImportCptResponse
from groundmodel.api.schemas.cpt.import_dov_request import ImportDovRequest
from groundmodel.api.schemas.cpt.import_dov_response import ImportDovResponse
from groundmodel.api.schemas.cpt.water_table_patch_request import WaterTablePatchRequest
from groundmodel.api.schemas.elevation_patch_request import ElevationPatchRequest
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov import ImportCptDov
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.application.stale_investigation_caches import StaleInvestigationCaches
from groundmodel.domain.services.cpt_corrections import calculate_qt_series
from groundmodel.domain.services.cpt_sbt_profile import compute_sbt_profile
from groundmodel.domain.services.gwt_resolution import resolve_gwt
from groundmodel.domain.services.robertson_2015 import ic_series_2015
from groundmodel.domain.services.robertson_2015_constants import (
    DEFAULT_GUNSAT_KNM3,
    DEFAULT_GWATER_KNM3,
    GUNSAT_KNM3_MAX,
    GUNSAT_KNM3_MIN,
    GWATER_KNM3_MAX,
    GWATER_KNM3_MIN,
)
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory, get_session
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import WfsIndexEntry
from groundmodel.shared.exceptions import (
    CptRefreshConfirmationRequiredError,
    CptRefreshRefusedError,
    DovImportTooLargeError,
    DuplicateCptError,
    DuplicateImportJobError,
    ParseError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

if TYPE_CHECKING:
    # Annotation-only — ``_plot_response_from_cpt`` takes a loaded CPT ORM row.
    # Imported under TYPE_CHECKING so the router doesn't pull the ORM model at
    # runtime (keeps mypy happy without widening the import surface).
    from groundmodel.infrastructure.db.models.cpt_orm import CptOrm

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
    response: Response,
    project_id: str | None = Form(None),
    confirm_refresh: bool = Form(False),
    session: AsyncSession = Depends(get_session),
) -> ImportCptResponse:
    """Import a CPT file and persist it, refreshing the row if it already exists.

    Re-importing a file that is already in this project (same GEF
    ``#PROJECTID`` + ``#TESTID``) does not have to fail: the existing row can be
    refreshed in place — new series, new header values, SAME ``cpt_id`` — so a
    parser fix reaches a project the user already imported into without them
    having to delete and re-import (which would destroy every interpretation
    anchored on the row).

    That overwrite is IRREVERSIBLE, so it is CONSENTED, never automatic:

    * duplicate + no ``confirm_refresh`` → **409** with
      ``code = "cpt_refresh_confirmation_required"`` and the old-vs-new diff
      (``old_/new_max_depth_m``, ``old_/new_n_rows``, ``n_errors``,
      ``n_warnings``). Nothing is written; the client shows the diff and asks.
    * duplicate + ``confirm_refresh=true`` → **200** with ``refreshed=true``.
    * a genuinely new CPT → **201**.
    * duplicate + a fresh parse with 0 rows or ERROR-level issues → **422**
      with ``code = "cpt_refresh_refused"`` and a named ``reason``, EVEN with
      confirmation: a broken file must never overwrite good data.

    Parameters
    ----------
    file:
        Uploaded CPT file.  GEF format is supported in Phase 1.
    response:
        Injected so the handler can answer 200 (refreshed) instead of the
        route's declared 201 (created).
    project_id:
        UUID of the active app-level project.  CPT is tagged with this ID so
        it only appears in that project's list.  None = unscoped (tests/admin).
    confirm_refresh:
        The user has seen the diff and asked for the replacement. Defaults to
        False, which is what makes the 409 the safe default.
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    ImportCptResponse
        UUID of the created (or refreshed) record plus any validation issues
        found during parsing.  The CPT is persisted even when ``has_errors``
        is True.

    Raises
    ------
    HTTPException(400)
        When the file extension is not supported or the file cannot be parsed.
    HTTPException(409)
        When the CPT already exists and the refresh was not confirmed.
    HTTPException(413)
        When the upload exceeds the per-file byte cap.
    HTTPException(422)
        When the fresh parse is too broken to replace the stored data.
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
        result = await ImportCpt(session).execute(
            tmp_path, app_project_uuid, confirm_refresh=confirm_refresh
        )
    # ``ImportCpt`` refreshes duplicates in place by default, so this branch is
    # only reachable if a future caller opts out (``refresh_existing=False``).
    # Kept so that choice still produces a 409 with the existing id rather than
    # a 500.
    except DuplicateCptError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"cpt_id": str(exc.existing_id), "message": str(exc)},
        )
    # The consent gate. ``cpt_id`` stays at the top level of the detail so the
    # client can still auto-load the existing row (the historical duplicate
    # contract), and the diff rides alongside for the confirmation dialog.
    except CptRefreshConfirmationRequiredError as exc:
        logger.info(
            f"POST /cpt/import: refresh of {exc.name!r} ({exc.existing_id}) "
            "awaits confirmation — nothing written"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "cpt_refresh_confirmation_required",
                "cpt_id": str(exc.existing_id),
                "name": exc.name,
                "message": str(exc),
                "old_max_depth_m": exc.old_max_depth_m,
                "new_max_depth_m": exc.new_max_depth_m,
                "old_n_rows": exc.old_n_rows,
                "new_n_rows": exc.new_n_rows,
                "n_errors": exc.n_errors,
                "n_warnings": exc.n_warnings,
            },
        )
    except CptRefreshRefusedError as exc:
        logger.warning(f"POST /cpt/import: refresh refused ({exc.reason}) — {exc}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "cpt_refresh_refused",
                "reason": exc.reason,
                "message": str(exc),
            },
        )
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)

    # 201 Created is the route default; a refresh created nothing, so it
    # answers 200 OK with the same body shape plus ``refreshed=true``.
    if result.refreshed:
        response.status_code = status.HTTP_200_OK
        logger.info(f"POST /cpt/import: refreshed existing CPT {result.cpt_id} in place")

    return ImportCptResponse(
        cpt_id=result.cpt_id,
        has_errors=result.has_errors,
        refreshed=result.refreshed,
        name=result.name,
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
    # Discovery found more records than the import ceiling — refuse with 422
    # (before any download happened) rather than run away.
    except DovImportTooLargeError as exc:
        raise map_dov_too_large_error(exc) from exc
    # On upstream failure, the user-facing ``detail`` carries only the
    # category + (when safe) the upstream HTTP status. Library class
    # names + exception messages are logged server-side so debugging
    # stays possible without leaking dependency versions or internal
    # topology to a future non-trusted caller (debt #43).
    except DOV_UPSTREAM_ERRORS as exc:
        raise map_dov_upstream_error(exc, logger=logger) from exc

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
                except DovImportTooLargeError as exc:
                    # Discovery ceiling hit — the download phase never started.
                    # Emit a terminal error event naming the count and the limit.
                    logger.warning(f"DOV stream import refused (too large): {exc}")
                    await queue.put(dov_too_large_event(exc))
                except DOV_UPSTREAM_ERRORS as exc:
                    await queue.put(
                        dov_error_event(exc, logger=logger, log_prefix="DOV stream import")
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"DOV stream import unexpected error: {type(exc).__name__}: {exc}")
                    await queue.put({"type": "error", "message": "Import failed unexpectedly"})
                finally:
                    # Sentinel: the SSE generator exits on None.
                    await queue.put(None)

        return run_import()

    return factory  # type: ignore[return-value]


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
    duration.  Aborting the SSE stream cancels the import server-side but
    leaves every XML already written to the on-disk cache intact, so
    subsequent imports of the same bbox are cache-warm.

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
    # De-dup key: refuse a second identical import (double-click / eager retry)
    # while the first is still running, handing back the running job-id so the
    # client attaches to the existing stream instead of racing it.
    key = dov_import_job_key(
        "cpt",
        west=request.west,
        south=request.south,
        east=request.east,
        north=request.north,
        project_id=request.project_id,
    )
    try:
        job_id = registry.start(factory, key=key)
    except DuplicateImportJobError as exc:
        raise map_duplicate_import_job(exc) from exc
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
    return dov_sse_stream_response(job_id, registry)


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

    Returns
    -------
    list[CptListItem]
        Lightweight per-CPT summary rows (id, name, type, depth, location,
        elevation, start date) for the list/sidebar view.

    Raises
    ------
    HTTPException(400)
        When ``project_id`` is provided but is not a valid UUID.
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
            # Pass-through: file_date is a raw String(20) column written by the
            # DOV/GEF parser. No re-parsing here — the frontend normalises via
            # parseInvestigationDate (Data Integrity Rule §2: pass-through values
            # are NOT derived; they are measurements and must not be re-expressed).
            start_date=c.file_date,
        )
        for c in cpts
    ]


def _cpt_response(cpt: CptOrm) -> CptResponse:
    """Build the full ``CptResponse`` from a loaded CPT ORM row.

    Shared by ``get_cpt`` and ``patch_cpt_elevation`` (extracted on the
    second copy) so adding a CPT header column is a one-place edit.
    The list endpoint uses ``CptListItem`` separately.

    Parameters
    ----------
    cpt : CptOrm
        Loaded CPT row.

    Returns
    -------
    CptResponse
        API-boundary mirror of the CPT header fields.
    """
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
        water_depth_m=cpt.water_depth_m,
        water_depth_source=cpt.water_depth_source,
        max_depth_m=cpt.max_depth_m,
        n_rows=cpt.n_rows,
    )


@router.get("/{cpt_id}", response_model=CptResponse)
async def get_cpt(
    cpt_id: UUID,
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptResponse:
    """Return full CPT metadata for a single record.

    Parameters
    ----------
    cpt_id : UUID
        Primary key of the CPT record.
    project_id : UUID
        Required project scope guard — the CPT must belong to this project.
        Prevents cross-project id enumeration (VULN-1).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CptResponse
        Full CPT header metadata.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given id exists, or it belongs to a different project.
    """
    repo = CptRepository(session)
    cpt = await get_in_project_or_404(repo.get_by_id(cpt_id), project_id, detail="CPT not found")

    return _cpt_response(cpt)


@router.patch("/{cpt_id}/elevation", response_model=CptResponse)
async def patch_cpt_elevation(
    cpt_id: UUID,
    project_id: UUID,
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

    Parameters
    ----------
    cpt_id : UUID
        Primary key of the CPT record.
    project_id : UUID
        Required project scope guard (VULN-2).

    Raises
    ------
    HTTPException(404)
        When no CPT with the given id exists, or it belongs to a different project.
    """
    logger.info(
        f"PATCH /cpt/{cpt_id}/elevation: elevation_m={request.elevation_m} z_epsg={request.z_epsg}"
    )
    repo = CptRepository(session)
    # Scope guard before any mutation: reject cross-project ids (VULN-2).
    await get_in_project_or_404(repo.get_by_id(cpt_id), project_id, detail="CPT not found")
    # The repository derives the canonical vertical CRS from the row's
    # horizontal EPSG when ``z_epsg`` is None (e.g. 31370 → 5710 mTAW for
    # Belgium, 28992 → 5709 NAP for the Netherlands). The desktop UI
    # doesn't expose a CRS picker today, so this is the path taken in
    # practice; multi-country imports just work.
    cpt = await repo.set_elevation(cpt_id, request.elevation_m, request.z_epsg)
    if cpt is None:
        logger.warning(f"PATCH /cpt/{cpt_id}/elevation → 404 (not found)")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")
    # Debt #34: a contact's absolute z is elevation_m − depth_top_m, so changing
    # this CPT's elevation invalidates every cached geometry with a contact
    # anchored here — the geological TINs AND the 3-D litho/geotech solids. Flip
    # both stale in the SAME transaction as the elevation write so the section
    # editor / 3-D viewer show "needs rebuild" instead of rendering the old
    # geometry as fresh.
    stale = await StaleInvestigationCaches(session).execute(cpt_id=cpt_id)
    if stale.surfaces or stale.solids:
        logger.info(
            f"PATCH /cpt/{cpt_id}/elevation: staled {stale.surfaces} dependent surface(s) "
            f"and {stale.solids} 3-D solid(s)"
        )
    await session.commit()
    return _cpt_response(cpt)


@router.patch("/{cpt_id}/water-table", response_model=CptResponse)
async def patch_cpt_water_table(
    cpt_id: UUID,
    project_id: UUID,
    request: WaterTablePatchRequest,
    session: AsyncSession = Depends(get_session),
) -> CptResponse:
    """Set (or clear) the engineer's depth to groundwater for a CPT.

    Called by the Parameters stage's per-CPT inspector when the engineer clicks
    the water-table line and types a value. Setting a depth stamps
    ``WaterDepthSource.ENGINEER``, which a later re-import of the same file will
    NOT overwrite — the whole Robertson normalisation hangs off this number, so
    engineer judgement outranks a re-parse. The FIRST override of a recorded
    depth snapshots it, so sending ``water_depth_m = null`` RESTORES the file's
    value; with no snapshot (a DOV CPT) it returns the CPT to "nothing
    recorded" and consumers fall back to the assumption and say so.

    No cached geometry is staled: the water table moves only DERIVED-ON-READ
    values (the Ic curve, the SBT strips, future segmenter suggestions).
    Contacts, litho layers and the 3-D solids are anchored on depths the
    engineer already committed, and re-deriving them is his gesture to make.

    Parameters
    ----------
    cpt_id : UUID
        Primary key of the CPT record.
    project_id : UUID
        Required project scope guard (VULN-2 class).
    request : WaterTablePatchRequest
        Body carrying ``water_depth_m`` (metres below ground surface) or null.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CptResponse
        The updated CPT header, so the client can refresh its detail cache
        without a follow-up GET.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given id exists, or it belongs to a different
        project.
    """
    logger.info(f"PATCH /cpt/{cpt_id}/water-table: water_depth_m={request.water_depth_m}")
    repo = CptRepository(session)
    # Scope guard before any mutation: reject cross-project ids.
    await get_in_project_or_404(repo.get_by_id(cpt_id), project_id, detail="CPT not found")
    cpt = await repo.set_water_table(cpt_id, request.water_depth_m)
    if cpt is None:
        logger.warning(f"PATCH /cpt/{cpt_id}/water-table → 404 (not found)")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CPT not found")
    await session.commit()
    return _cpt_response(cpt)


@router.delete("/{cpt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cpt(
    cpt_id: UUID,
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a CPT and its series data.

    Parameters
    ----------
    cpt_id : UUID
        UUID of the CPT to delete.
    project_id : UUID
        Required project scope guard — the CPT must belong to this project
        before deletion is permitted (VULN-3).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    None
        Responds with ``204 No Content`` on success.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given ID exists, or it belongs to a different project.
    """
    logger.info(f"DELETE /cpt/{cpt_id}")
    repo = CptRepository(session)
    # Scope guard only — the 404 side effect is the point (VULN-2 class).
    await get_in_project_or_404(repo.get_by_id(cpt_id), project_id, detail="CPT not found")
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

    # Debt #22 reconciliation (2026-05-21): Ic now comes from Robertson
    # 2015/2009 via ``ic_series_2015`` instead of the frozen Robertson
    # 1990 preview in ``cpt_interpretation.calculate_ic_series``.  The
    # litho segmenter has used the 2015 method since slice 3; switching
    # the chart's plot endpoint to the same path keeps the whole app
    # consistent on Daniel Verastegui's method (no more two-method
    # divergence at zone boundaries).  Response shape unchanged.
    ic = (
        ic_series_2015(
            depths_m=s.depths_m,
            qc_mpa=s.qc_mpa,
            fs_mpa=s.fs_mpa,
            # No recorded water table → the ONE project-wide assumption, shared
            # with the litho segmenter (``suggest_litho_contacts``) and the SBT
            # profile endpoint via ``resolve_gwt``. Two different defaults would
            # put the Ic curve the engineer validates against and the ghost
            # boundaries he is offered on different effective-stress profiles.
            gwt_m=resolve_gwt(cpt.water_depth_m, cpt.water_depth_source).gwt_m,
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
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> CptPlotResponse:
    """Return raw depth-series arrays for plotting qc, fs, and u2 vs depth.

    Parameters
    ----------
    cpt_id : UUID
        Primary key of the CPT record.
    project_id : UUID
        Required project scope guard (VULN-4).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CptPlotResponse
        Raw depth-series arrays (qc, fs, u2, rf, qt, q_total) plus the
        on-read-derived Ic series for plotting.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given id exists, belongs to a different project,
        or has no series data.
    """
    repo = CptRepository(session)
    cpt = await get_in_project_or_404(repo.get_by_id(cpt_id), project_id, detail="CPT not found")
    try:
        return _plot_response_from_cpt(cpt)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err


@router.get("/{cpt_id}/sbt-profile", response_model=CptSbtProfileResponse)
async def get_cpt_sbt_profile(
    cpt_id: UUID,
    project_id: UUID,
    # ``Annotated[...] = <plain default>`` rather than ``= Query(default=...)``:
    # the parity gate calls this handler DIRECTLY (no FastAPI dependency
    # resolution), and a bare ``Query`` default would reach ``stress_profile``
    # as a Query object instead of a float.
    gunsat_kNm3: Annotated[
        float, Query(ge=GUNSAT_KNM3_MIN, le=GUNSAT_KNM3_MAX)
    ] = DEFAULT_GUNSAT_KNM3,
    gwater_kNm3: Annotated[
        float, Query(ge=GWATER_KNM3_MIN, le=GWATER_KNM3_MAX)
    ] = DEFAULT_GWATER_KNM3,
    session: AsyncSession = Depends(get_session),
) -> CptSbtProfileResponse:
    """Return both Robertson SBT classifications per depth point for one CPT.

    Drives the Parameters stage's per-CPT plot surface (owner ruling, dogfeed
    2026-08-03): the full normalised Robertson-2015 pipeline's zone strip — the
    one that carries the extended organic/peat boundary — AND the non-normalised
    ``I_SBT`` strip alongside it, so the engineer can see where
    stress-normalisation changes the answer.

    The normalised columns are computed under the SAME effective-stress profile
    the litho segmenter uses: the same water table (``resolve_gwt``) AND the
    same unit weights, which the client passes from Settings → Litho segmenter.
    Anything less is not parity — moving γ_unsat 16 → 19 moves SBTn zones, and
    the strip would attribute that shift to normalisation instead. The response
    says which water table it used and where that number came from (Data
    Integrity Rule 1). Nothing is stored — the profile is derived on read.

    Parameters
    ----------
    cpt_id : UUID
        Primary key of the CPT record.
    project_id : UUID
        Required project scope guard — the CPT must belong to this project.
        Prevents cross-project id enumeration (VULN-1 class).
    gunsat_kNm3 : float
        Unit weight of soil above the water table in kN/m³. Defaults and bounds
        mirror ``LithoSuggestionRequest`` (both read the same domain constants),
        so a value the segmenter accepts is a value this endpoint accepts.
    gwater_kNm3 : float
        Unit weight of water in kN/m³, same defaults and bounds.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    CptSbtProfileResponse
        Ic + zone series (normalised), I_SBT + zone series (non-normalised),
        and the water-table provenance.

    Raises
    ------
    HTTPException(404)
        When no CPT with the given id exists, it belongs to a different
        project, or it has no series data.
    """
    repo = CptRepository(session)
    cpt = await get_in_project_or_404(repo.get_by_id(cpt_id), project_id, detail="CPT not found")
    series = cpt.series
    if series is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Series data not found for this CPT",
        )

    gwt = resolve_gwt(cpt.water_depth_m, cpt.water_depth_source)
    # A CPTM has no friction sleeve at all, so the column is NULL rather than an
    # array of NULLs. Widening it here keeps the classifier's "no fs → no zone"
    # path the single place that decides what an unmeasurable point looks like.
    fs = series.fs_mpa if series.fs_mpa is not None else [None] * len(series.depths_m)
    profile = compute_sbt_profile(
        depths_m=series.depths_m,
        qc_mpa=series.qc_mpa,
        fs_mpa=fs,
        gwt=gwt,
        gunsat_kNm3=gunsat_kNm3,
        gwater_kNm3=gwater_kNm3,
    )
    logger.info(
        f"GET /cpt/{cpt_id}/sbt-profile → {len(profile.depths_m)} points, "
        f"gwt={profile.gwt_m} m ({profile.gwt_source}), "
        f"γunsat={gunsat_kNm3} γwater={gwater_kNm3} kN/m³"
    )
    return CptSbtProfileResponse(
        cpt_id=cpt.id,
        depths_m=profile.depths_m,
        ic=profile.ic,
        zone_normalised=profile.zone_normalised,
        i_sbt=profile.i_sbt,
        zone_non_normalised=profile.zone_non_normalised,
        gwt_m=profile.gwt_m,
        gwt_source=profile.gwt_source,
    )


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

    Parameters
    ----------
    request : CptPlotBatchRequest
        Body carrying the list of CPT ids to plot (capped at 500) and an
        optional ``app_project_id`` scope guard.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[CptPlotResponse]
        One plot-response per resolvable CPT that has series data; unknown
        ids and series-less CPTs are silently omitted.
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
