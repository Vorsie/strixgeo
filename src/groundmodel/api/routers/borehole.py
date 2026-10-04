"""Borehole API route handlers."""

from __future__ import annotations

import asyncio
import tempfile
from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    Form,
    HTTPException,
    Query,
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
from groundmodel.api.schemas.borehole.borehole_detail_batch_request import (
    BoreholeDetailBatchRequest,
)
from groundmodel.api.schemas.borehole.borehole_detail_response import (
    BoreholeDetailResponse,
)
from groundmodel.api.schemas.borehole.borehole_list_item import BoreholeListItem
from groundmodel.api.schemas.borehole.import_borehole_dov_request import (
    ImportBoreholeDovRequest,
)
from groundmodel.api.schemas.borehole.import_borehole_dov_response import (
    ImportBoreholeDovResponse,
)
from groundmodel.api.schemas.borehole.import_borehole_file_response import (
    ImportBoreholeFileResponse,
)
from groundmodel.api.schemas.borehole.imported_boring_schema import ImportedBoringSchema
from groundmodel.api.schemas.elevation_patch_request import ElevationPatchRequest
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.import_borehole_dov import ImportBoreholeDov
from groundmodel.application.import_borehole_file import ImportBoreholeFile
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.application.stale_investigation_caches import StaleInvestigationCaches
from groundmodel.domain.services.track_preference import order_by_track_preference
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    LAB_TEST_RELATIONSHIPS,
    BoreholeRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory, get_session
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.shared.exceptions import (
    BoreholeRefreshConfirmationRequiredError,
    BoreholeRefreshRefusedError,
    DovImportTooLargeError,
    DuplicateImportJobError,
    ParseError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Friendly URL aliases for the ``?include=`` query param. The URL form
# uses the short / domain-natural name (``grain_size``); the value is
# the ORM relationship attribute name the repository expects. Adding a
# typed lab-test family means appending one entry here AND one to
# ``LAB_TEST_RELATIONSHIPS`` in the repository.
LAB_TEST_INCLUDE_ALIASES: dict[str, str] = {
    "grain_size": "grain_sizes",
    "atterberg": "atterberg_limits_tests",
    "caco3": "caco3_content_tests",
    "organic": "organic_content_tests",
    "water_content": "water_content_tests",
    "scalar": "scalar_lab_tests",
}

# Module-level logger — routers are stateless functions, not classes.
# See CLAUDE.md § Code Conventions for the rationale.
logger = LoggerFactory.get_logger(__name__)

router = APIRouter()

# Cap on one borehole XML upload. A DOV borehole file is ~10-30 KB (the owner's
# five: 13-29 KB); 50 MiB is three orders of magnitude past a multi-boring
# export and still streams through ``tempfile`` without OOM. The outer
# BodySizeLimitMiddleware caps the envelope at 256 MiB, but ``UploadFile``
# streams chunk by chunk, so the per-upload guard lives here (as for GEF).
MAX_BOREHOLE_XML_UPLOAD_BYTES = 50 * 1024 * 1024


def _issue_schemas(issues: list[ValidationIssue]) -> list[ValidationIssueSchema]:
    """Serialise parse / import findings for the response."""
    return [
        ValidationIssueSchema(
            level=i.level.value, code=i.code, message=i.message, rows=i.rows, params=i.params
        )
        for i in issues
    ]


@router.post(
    "/import", response_model=ImportBoreholeFileResponse, status_code=status.HTTP_201_CREATED
)
async def import_borehole_file(
    file: UploadFile,
    response: Response,
    project_id: str | None = Form(None),
    confirm_refresh: bool = Form(False),
    session: AsyncSession = Depends(get_session),
) -> ImportBoreholeFileResponse:
    """Import a LOCAL DOV borehole XML file (one or several borings).

    Every ``<boring>`` becomes a borehole (identity ``project_id="DOV"`` +
    DOV identificatie, the same key the bbox import uses) with every
    interpretation the file holds for it, and a list of flags naming
    everything worth checking. One commit per file.

    A boring already in the project follows the CPT re-import rule — refresh
    in place (same borehole id), but CONSENTED:

    * duplicate(s) + no ``confirm_refresh`` → **409** with
      ``code = "borehole_refresh_confirmation_required"`` and ``diffs`` (per
      boring: old/new total depth, old/new lithology layer count). Nothing is
      written for the file.
    * duplicate(s) + ``confirm_refresh=true`` → **200**, those borings
      ``refreshed=true``.
    * only new borings → **201**.
    * a duplicate whose fresh parse has errors → **422** with
      ``code = "borehole_refresh_refused"``, even when confirmed.

    Parameters
    ----------
    file:
        The uploaded ``.xml`` file.
    response:
        Injected so the handler can answer 200 (refreshed) instead of 201.
    project_id:
        UUID of the active app-level project. None = unscoped (tests/admin).
    confirm_refresh:
        The user has seen the diff and asked for the replacement.
    session:
        Database session injected by FastAPI.

    Returns
    -------
    ImportBoreholeFileResponse
        One entry per boring with its flags, plus file-level findings.

    Raises
    ------
    HTTPException(400)
        Wrong suffix, bad ``project_id``, or a file that is not a DOV
        borehole XML.
    HTTPException(409)
        Borings already in the project and the refresh was not confirmed.
    HTTPException(413)
        The upload exceeds ``MAX_BOREHOLE_XML_UPLOAD_BYTES``.
    HTTPException(422)
        A boring's fresh parse is too broken to replace the stored one.
    """
    logger.info(f"POST /borehole/import: project_id={project_id} confirm={confirm_refresh}")
    logger.debug(f"POST /borehole/import: file={file.filename!r}")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix != ".xml":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{suffix}'. Supported: .xml (DOV borehole export)",
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

    received = 0
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        while True:
            chunk = await file.read(1024 * 1024)  # 1 MiB
            if not chunk:
                break
            received += len(chunk)
            if received > MAX_BOREHOLE_XML_UPLOAD_BYTES:
                tmp_path = Path(tmp.name)
                tmp.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=(
                        "Borehole XML upload exceeds the "
                        f"{MAX_BOREHOLE_XML_UPLOAD_BYTES // (1024 * 1024)} MiB cap"
                    ),
                )
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    try:
        result = await ImportBoreholeFile(session).execute(
            tmp_path,
            app_project_uuid,
            confirm_refresh=confirm_refresh,
            file_name=file.filename or tmp_path.name,
        )
    except BoreholeRefreshConfirmationRequiredError as exc:
        logger.info(
            f"POST /borehole/import: {len(exc.diffs)} refresh(es) await confirmation; "
            "nothing written"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "borehole_refresh_confirmation_required",
                "message": str(exc),
                "diffs": exc.diffs,
            },
        )
    except BoreholeRefreshRefusedError as exc:
        logger.warning(f"POST /borehole/import: refresh refused ({exc.reason})")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "borehole_refresh_refused",
                "reason": exc.reason,
                "message": str(exc),
            },
        )
    except ParseError as exc:
        logger.warning(f"POST /borehole/import: parse error: {exc}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)

    if any(b.refreshed for b in result.boreholes):
        response.status_code = status.HTTP_200_OK
    logger.info(
        f"POST /borehole/import: {len(result.boreholes)} boring(s), "
        f"{sum(1 for b in result.boreholes if b.refreshed)} refreshed, "
        f"{sum(1 for b in result.boreholes if not b.imported)} skipped"
    )
    return ImportBoreholeFileResponse(
        boreholes=[
            ImportedBoringSchema(
                borehole_id=b.borehole_id,
                name=b.name,
                test_id=b.test_id,
                has_errors=b.has_errors,
                issues=_issue_schemas(b.issues),
                refreshed=b.refreshed,
                imported=b.imported,
            )
            for b in result.boreholes
        ],
        file_issues=_issue_schemas(result.issues),
    )


@router.post("/import-dov", response_model=ImportBoreholeDovResponse)
async def import_borehole_dov(
    request: ImportBoreholeDovRequest,
    session: AsyncSession = Depends(get_session),
) -> ImportBoreholeDovResponse:
    """Import boreholes from DOV within a WGS84 bounding box.

    Mirrors the CPT-side ``POST /cpt/import-dov`` endpoint exactly: same
    request shape, same upstream-error → HTTP-status mapping, same
    "imported / duplicates / failed + ids" response.

    Parameters
    ----------
    request:
        Bounding box (west, south, east, north in decimal degrees) and an
        optional ``project_id``. The backend queries the DOV WFS for the
        ``dov-pub:Boringen`` layer, downloads every borehole's XML in
        parallel (with persistent on-disk cache), parses it, and persists
        the row to the project.

    Returns
    -------
    ImportBoreholeDovResponse
        Counts of imported / duplicate / failed boreholes plus all
        borehole IDs the project now sees (new + pre-existing).

    Raises
    ------
    HTTPException(503)
        DOV unreachable (DNS / connection refused / no network).
    HTTPException(504)
        DOV did not respond within the timeout.
    HTTPException(502)
        DOV returned an unexpected response (4xx / 5xx from upstream).
    """
    try:
        result = await ImportBoreholeDov(session).execute(
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
    # Same hardening as the CPT DOV path — library class names +
    # exception messages stay server-side; user-facing detail carries
    # only the category + (when safe) the upstream HTTP status.
    # Debt #43.
    except DOV_UPSTREAM_ERRORS as exc:
        raise map_dov_upstream_error(exc, logger=logger) from exc

    return ImportBoreholeDovResponse(
        imported=result.imported,
        duplicates=result.duplicates,
        failed=result.failed,
        interpretations_attached=result.interpretations_attached,
        interpretations_failed=result.interpretations_failed,
        interpretations_wfs_gaps=result.interpretations_wfs_gaps,
        samples_attached=result.samples_attached,
        samples_failed=result.samples_failed,
        grain_sizes_attached=result.grain_sizes_attached,
        grain_sizes_failed=result.grain_sizes_failed,
        atterberg_attached=result.atterberg_attached,
        atterberg_failed=result.atterberg_failed,
        caco3_attached=result.caco3_attached,
        caco3_failed=result.caco3_failed,
        organic_attached=result.organic_attached,
        organic_failed=result.organic_failed,
        water_content_attached=result.water_content_attached,
        water_content_failed=result.water_content_failed,
        scalar_lab_tests_attached=result.scalar_lab_tests_attached,
        scalar_lab_tests_failed=result.scalar_lab_tests_failed,
        borehole_ids=result.borehole_ids,
    )


def _make_borehole_dov_import_coro(
    request: ImportBoreholeDovRequest,
) -> AsyncGenerator[asyncio.Queue[dict | None], None]:
    """Return a coroutine-factory for the borehole DOV import background task.

    Mirrors ``_make_cpt_dov_import_coro`` in ``cpt.py``.  The factory
    accepts an ``asyncio.Queue`` and returns a coroutine that creates
    its own ``AsyncSession``, runs the import, and puts events + a
    terminal ``None`` sentinel on the queue.

    Parameters
    ----------
    request : ImportBoreholeDovRequest
        Bounding box + optional project_id.

    Returns
    -------
    Callable[[asyncio.Queue], Coroutine[None]]
        Factory suitable for ``JobRegistry.start``.
    """

    def factory(queue: asyncio.Queue) -> object:  # -> Coroutine
        async def run_import() -> None:
            async def progress_cb(phase: str, done: int, total: int) -> None:
                await queue.put({"phase": phase, "done": done, "total": total})

            async with AsyncSessionFactory() as session:
                try:
                    result = await ImportBoreholeDov(session).execute(
                        west=request.west,
                        south=request.south,
                        east=request.east,
                        north=request.north,
                        app_project_id=request.project_id,
                        progress_cb=progress_cb,
                    )
                    await queue.put(
                        {
                            "type": "done",
                            "imported": result.imported,
                            "duplicates": result.duplicates,
                            "failed": result.failed,
                            "borehole_ids": [str(bid) for bid in result.borehole_ids],
                            "interpretations_attached": result.interpretations_attached,
                            "interpretations_failed": result.interpretations_failed,
                            "interpretations_wfs_gaps": result.interpretations_wfs_gaps,
                            "samples_attached": result.samples_attached,
                            "samples_failed": result.samples_failed,
                            "grain_sizes_attached": result.grain_sizes_attached,
                            "grain_sizes_failed": result.grain_sizes_failed,
                            "atterberg_attached": result.atterberg_attached,
                            "atterberg_failed": result.atterberg_failed,
                            "caco3_attached": result.caco3_attached,
                            "caco3_failed": result.caco3_failed,
                            "organic_attached": result.organic_attached,
                            "organic_failed": result.organic_failed,
                            "water_content_attached": result.water_content_attached,
                            "water_content_failed": result.water_content_failed,
                            "scalar_lab_tests_attached": result.scalar_lab_tests_attached,
                            "scalar_lab_tests_failed": result.scalar_lab_tests_failed,
                        }
                    )
                except DovImportTooLargeError as exc:
                    logger.warning(f"DOV borehole stream refused (too large): {exc}")
                    await queue.put(dov_too_large_event(exc))
                except DOV_UPSTREAM_ERRORS as exc:
                    await queue.put(
                        dov_error_event(exc, logger=logger, log_prefix="DOV borehole stream")
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        f"DOV borehole stream unexpected error: {type(exc).__name__}: {exc}"
                    )
                    await queue.put({"type": "error", "message": "Import failed unexpectedly"})
                finally:
                    await queue.put(None)

        return run_import()

    return factory  # type: ignore[return-value]


@router.post("/import-dov/stream", status_code=status.HTTP_202_ACCEPTED)
async def import_borehole_dov_stream(
    request: ImportBoreholeDovRequest,
    registry: JobRegistry = Depends(get_job_registry),
) -> dict:
    """Spawn a borehole DOV import as a background task and return its job-id.

    Mirrors ``POST /cpt/import-dov/stream``.  The import runs in its own
    ``asyncio.Task`` with an independent ``AsyncSession`` so the spawning
    request completes immediately with ``202 Accepted``.  Connect to
    ``GET /borehole/import-dov/stream/{job_id}`` to receive the SSE stream.

    Parameters
    ----------
    request : ImportBoreholeDovRequest
        Bounding box + optional project_id.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    dict
        ``{"job_id": "<uuid>"}``
    """
    factory = _make_borehole_dov_import_coro(request)
    # De-dup key: refuse a second identical import while the first still runs,
    # handing back the running job-id so the client attaches to it.
    key = dov_import_job_key(
        "borehole",
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
    logger.info(f"DOV borehole import job {job_id} spawned")
    return {"job_id": str(job_id)}


@router.get("/import-dov/stream/{job_id}")
async def get_borehole_dov_stream(
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> StreamingResponse:
    """Drain the SSE event queue for a running borehole DOV import job.

    Parameters
    ----------
    job_id : UUID
        Job-id returned by ``POST /borehole/import-dov/stream``.
    registry : JobRegistry
        In-process job registry, injected.

    Returns
    -------
    StreamingResponse
        ``Content-Type: text/event-stream``.

    Raises
    ------
    HTTPException(404)
        When no job with that id is registered.
    """
    return dov_sse_stream_response(job_id, registry)


@router.get("/", response_model=list[BoreholeListItem])
async def list_boreholes(
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[BoreholeListItem]:
    """Return a lightweight summary list of boreholes.

    Mirrors the CPT-side ``GET /cpt/`` endpoint exactly. Only header columns
    + denormalised counts are included so the desktop app can render the
    sidebar list + map markers from a single call without firing one
    ``GET /borehole/{id}`` per row.

    Parameters
    ----------
    project_id:
        When provided, only return boreholes belonging to this app-level
        project UUID. When absent, return all boreholes (used by tests
        and admin tools — production frontend always passes a project_id).
    session:
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[BoreholeListItem]
        Lightweight per-borehole summaries (header columns + denormalised
        counts), scoped to ``project_id`` when provided.

    Raises
    ------
    HTTPException(400)
        When ``project_id`` is provided but isn't a parseable UUID.
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

    repo = BoreholeRepository(session)
    boreholes = await repo.list_all(app_project_uuid)
    # Pydantic ``from_attributes=True`` config on BoreholeListItem maps the
    # ORM columns by name — no manual field forwarding needed.
    return [BoreholeListItem.model_validate(b) for b in boreholes]


@router.get("/{borehole_id}", response_model=BoreholeDetailResponse)
async def get_borehole(
    borehole_id: UUID,
    project_id: UUID,
    include: str | None = Query(
        None,
        description=(
            "Comma-separated lab-test families to load on each sample. "
            "Omitting the parameter loads every family (the original "
            "always-load behaviour). Valid values: "
            "``grain_size``, ``atterberg``, ``caco3``, ``organic``, "
            "``water_content``, ``scalar``. Unrequested families come "
            "back as empty lists, NOT omitted keys — the response "
            "shape is unchanged so clients keep working unmodified "
            "(debt #2)."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> BoreholeDetailResponse:
    """Retrieve full borehole detail (header + drill segments + field log + observations).

    Default (no ``?include=``) returns the full tree — preserves the
    pre-debt-#2 behaviour. Pass ``?include=grain_size,atterberg`` to
    skip the four unrequested lab-test families' SELECT queries; the
    JSON shape stays the same (skipped families render as ``[]``).

    Parameters
    ----------
    borehole_id : UUID
        Primary key of the borehole record.
    project_id : UUID
        Required project scope guard — the borehole must belong to this
        project (VULN-6).
    include : str | None
        Comma-separated lab-test family aliases — see the ``Query``
        description above. Whitespace around entries is tolerated.

    Returns
    -------
    BoreholeDetailResponse
        Full borehole tree, with observations sorted by observation_date
        and layers sorted by ``layer_index`` (per the ORM ``order_by``).

    Raises
    ------
    HTTPException(400)
        When ``include`` contains an alias that isn't in
        ``LAB_TEST_INCLUDE_ALIASES``.
    HTTPException(404)
        When no borehole with that id exists, or it belongs to a different project.
    """
    include_relationships: list[str] | None = None
    if include is not None:
        aliases = [token.strip() for token in include.split(",") if token.strip()]
        unknown = [a for a in aliases if a not in LAB_TEST_INCLUDE_ALIASES]
        if unknown:
            valid = sorted(LAB_TEST_INCLUDE_ALIASES.keys())
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(f"Unknown include value(s): {unknown!r}. Valid: {valid!r}"),
            )
        include_relationships = [LAB_TEST_INCLUDE_ALIASES[a] for a in aliases]
        logger.debug(
            f"GET /borehole/{borehole_id} include={aliases} "
            f"(→ relationships {include_relationships})"
        )

    repo = BoreholeRepository(session)
    borehole = await repo.get_by_id(
        borehole_id,
        include_lab_tests=include_relationships,
        app_project_id=project_id,
    )
    # Scope guard: the project predicate is fused into the fetch above
    # (M1), so a cross-project id already returns None here. The explicit
    # check is kept as cheap defence-in-depth (VULN-6).
    if borehole is None or borehole.app_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Borehole {borehole_id} not found",
        )
    # Sanity check — the relationship-stamping path SHOULD have populated
    # every excluded family with ``[]``. If a future refactor breaks the
    # stamping, ``model_validate`` would silently lazy-load and crash
    # under async with ``MissingGreenlet``; assertively reading the
    # relationships keeps the failure mode loud.
    assert sorted(LAB_TEST_INCLUDE_ALIASES.values()) == sorted(LAB_TEST_RELATIONSHIPS), (
        "Router aliases drifted from repository relationships — update both lists together."
    )
    return _detail_response(borehole)


def _detail_response(borehole: object) -> BoreholeDetailResponse:
    """Build the detail response with each kind's preferred track first.

    Consumers that want ONE track of a kind (the section columns, the
    borelog, ``.find`` on the renderer side) take the first match; ordering
    the list with the single track-preference helper (manual, then newest
    edited, then today's date order) makes that first match the right one
    without a second copy of the rule in TypeScript.
    """
    response = BoreholeDetailResponse.model_validate(borehole)
    response.observations = order_by_track_preference(response.observations)
    return response


@router.post("/detail-batch", response_model=list[BoreholeDetailResponse])
async def post_borehole_detail_batch(
    request: BoreholeDetailBatchRequest,
    session: AsyncSession = Depends(get_session),
) -> list[BoreholeDetailResponse]:
    """Batch the per-borehole detail endpoint into one round-trip (debt #39).

    Section open used to fire N parallel ``GET /borehole/{id}`` calls
    (one per in-buffer borehole), each loading 12+ selectinload chains.
    A dense corridor (50+ boreholes) was 50+ round-trips of full
    lab-test trees the section never renders. This endpoint folds them
    into one query — the repository's ``IN (...)`` predicate +
    selectinload chains issue ONE child query per relationship for ALL
    N parents, so cost is constant in N, not 12 * N.

    ``include`` mirrors the per-id endpoint's query parameter; the
    section caller passes ``include=[]`` to skip every lab family
    (further reducing the load). Unknown ids and unknown ``include``
    aliases follow the same conventions as the single endpoint:
    unknown ids drop silently from the response, unknown aliases
    raise 400.

    Body cap: 500 ids (matches CPT plot-batch). Project scope guard
    fused into the repository query so a crafted batch can't pull
    foreign-project boreholes.

    Parameters
    ----------
    request : BoreholeDetailBatchRequest
        Batch request: the borehole ``ids`` to load, the ``app_project_id``
        scope guard, and an optional ``include`` list of lab-test family
        aliases (``include=[]`` skips every family).
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    list[BoreholeDetailResponse]
        Full borehole trees for the requested ids that exist within the
        given project. Unknown or foreign-project ids drop silently, so the
        result may be shorter than ``request.ids``.

    Raises
    ------
    HTTPException(400)
        When ``include`` contains an alias not in
        ``LAB_TEST_INCLUDE_ALIASES``.
    """
    include_relationships: list[str] | None = None
    if request.include is not None:
        aliases = [token.strip() for token in request.include if token.strip()]
        unknown = [a for a in aliases if a not in LAB_TEST_INCLUDE_ALIASES]
        if unknown:
            valid = sorted(LAB_TEST_INCLUDE_ALIASES.keys())
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown include value(s): {unknown!r}. Valid: {valid!r}",
            )
        include_relationships = [LAB_TEST_INCLUDE_ALIASES[a] for a in aliases]

    logger.info(
        f"POST /borehole/detail-batch: {len(request.ids)} ids, "
        f"scope={request.app_project_id}, include={request.include!r}"
    )
    repo = BoreholeRepository(session)
    boreholes = await repo.get_many(
        request.ids,
        include_lab_tests=include_relationships,
        app_project_id=request.app_project_id,
    )
    out = [_detail_response(bh) for bh in boreholes]
    logger.info(f"POST /borehole/detail-batch → {len(out)}/{len(request.ids)} returned")
    return out


@router.patch("/{borehole_id}/elevation", response_model=BoreholeListItem)
async def patch_borehole_elevation(
    borehole_id: UUID,
    project_id: UUID,
    request: ElevationPatchRequest,
    session: AsyncSession = Depends(get_session),
) -> BoreholeListItem:
    """Update the manually-entered surface elevation for a borehole.

    Mirrors ``PATCH /cpt/{id}/elevation``. The desktop frontend's Phase 3a
    ``ElevationEditor`` calls this when the user fills in the missing Z for
    a DOV row that came in without one. Setting ``elevation_m`` to ``null``
    clears the value so the user can undo a typo.

    Returns the lightweight ``BoreholeListItem`` shape (rather than the full
    detail tree) since the frontend only needs the header columns to refresh
    its sidebar list and badge state. The detail-cache entry can be patched
    in place client-side without re-fetching the heavy children.

    Parameters
    ----------
    borehole_id : UUID
        Primary key of the borehole record.
    project_id : UUID
        Required project scope guard (VULN-7).

    Raises
    ------
    HTTPException(404)
        When no borehole with the given id exists, or it belongs to a different project.
    """
    logger.info(
        f"PATCH /borehole/{borehole_id}/elevation: "
        f"elevation_m={request.elevation_m} z_epsg={request.z_epsg}"
    )
    repo = BoreholeRepository(session)
    # Scope guard before any mutation: reject cross-project ids (VULN-7).
    await get_in_project_or_404(
        repo.get_by_id(borehole_id),
        project_id,
        detail=f"Borehole {borehole_id} not found",
    )
    # The repository derives the canonical vertical CRS from the row's
    # horizontal EPSG when ``z_epsg`` is None — see ``vertical_crs.py``
    # for the table. Belgian DOV imports map to mTAW; future Dutch BRO
    # imports map to NAP without further router changes.
    borehole = await repo.set_elevation(borehole_id, request.elevation_m, request.z_epsg)
    if borehole is None:
        logger.warning(f"PATCH /borehole/{borehole_id}/elevation → 404 (not found)")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Borehole {borehole_id} not found",
        )
    # Debt #34: changing this borehole's elevation shifts the absolute z of
    # every contact anchored here (z = elevation_m − depth_top_m), so flip the
    # dependent TIN surfaces AND the cached 3-D solids stale in the same
    # transaction — otherwise the viewer keeps rendering the old geometry as
    # fresh. Same use case as the CPT handler so the two cannot drift.
    stale = await StaleInvestigationCaches(session).execute(borehole_id=borehole_id)
    if stale.surfaces or stale.solids:
        logger.info(
            f"PATCH /borehole/{borehole_id}/elevation: staled {stale.surfaces} dependent "
            f"surface(s) and {stale.solids} 3-D solid(s)"
        )
    await session.commit()
    return BoreholeListItem.model_validate(borehole)
