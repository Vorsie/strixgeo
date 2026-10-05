"""CPT PDF import routes: triage a report, calibrate a sounding, import soundings.

Data -> Import -> "Import CPTs from a PDF report". The dialog uploads the
report once (``POST /cpt/pdf/triage``, a background job with progress, the DOV
stream pattern), then refers to it by its SHA-256: page thumbnails, a
sounding read through the calibration the user settles on (with an overlay per
page), and the import of the ticked soundings through the GEF import's own
door and consent flow.

The PDF machinery (PyMuPDF, the digitiser) is imported inside the handlers,
not at module load: the API boots without it (packaged cold start).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any
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
    dov_sse_stream_response,
    map_duplicate_import_job,
)
from groundmodel.api.schemas.cpt.cpt_pdf_digitise_request import CptPdfDigitiseRequest
from groundmodel.api.schemas.cpt.cpt_pdf_digitise_response import CptPdfDigitiseResponse
from groundmodel.api.schemas.cpt.cpt_pdf_import_request import CptPdfImportRequest
from groundmodel.api.schemas.cpt.cpt_pdf_import_response import CptPdfImportResponse
from groundmodel.api.schemas.cpt.cpt_pdf_import_result_item import CptPdfImportResultItem
from groundmodel.api.schemas.cpt.cpt_pdf_overlay import CptPdfOverlay
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    MAX_PDF_UPLOAD_BYTES,
    MAX_RENDER_DPI,
    MIN_RENDER_DPI,
    OVERLAY_DPI,
    PAGE_THUMBNAIL_DPI,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import (
    PdfReportStore,
    get_pdf_report_store,
)
from groundmodel.shared.exceptions import (
    CptPdfReportNotFoundError,
    DuplicateImportJobError,
    TriageCancelled,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

if TYPE_CHECKING:
    from groundmodel.application.pdf_sounding_view import PdfSoundingView
    from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

# Module-level logger: routers are functions, not classes (documented fallback).
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/cpt/pdf", tags=["cpt-pdf"])

# Every PDF starts with this marker (ISO 32000); anything else named .pdf is
# refused before it is spooled or opened.
_PDF_MAGIC = b"%PDF-"


def get_pdf_triager_factory() -> Callable[[], PdfReportTriager]:
    """Return the triager factory (FastAPI dependency; tests pass a fake).

    Returns
    -------
    callable
        ``PdfReportTriager`` (OCR used when the ``pdf-ocr`` extra is installed).
    """
    from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import (
        PdfReportTriager,
    )

    return PdfReportTriager


def _not_found(code: str, message: str) -> HTTPException:
    """Return the 404 the dialog branches on (``detail.code``)."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail={"code": code, "message": message}
    )


async def _spool(file: UploadFile, directory: Path) -> tuple[Path, str]:
    """Stream an upload to a temp file under ``directory``, hashing it on the way.

    Raises
    ------
    HTTPException(413)
        Past ``MAX_PDF_UPLOAD_BYTES``.
    HTTPException(400)
        When the bytes are not a PDF.
    """
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    received = 0
    head = b""
    with tempfile.NamedTemporaryFile(dir=directory, suffix=".part", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        try:
            while chunk := await file.read(1024 * 1024):
                received += len(chunk)
                if received > MAX_PDF_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"PDF upload exceeds the {MAX_PDF_UPLOAD_BYTES // (1024 * 1024)} "
                        "MiB cap",
                    )
                if len(head) < len(_PDF_MAGIC):
                    head += chunk[: len(_PDF_MAGIC)]
                digest.update(chunk)
                tmp.write(chunk)
        except HTTPException:
            tmp.close()
            tmp_path.unlink(missing_ok=True)
            raise
    if not head.startswith(_PDF_MAGIC):
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="the file is not a PDF")
    return tmp_path, digest.hexdigest()


def _triage_job(
    store: PdfReportStore,
    project_id: UUID,
    file_sha: str,
    file_name: str,
    triager_factory: Callable[[], PdfReportTriager],
    cancel: threading.Event,
) -> Callable[[Any], Any]:
    """Return the job factory: triage in a worker thread, progress onto the queue.

    ``cancel`` is the job's cooperative stop flag (the registry raises it when
    the dialog closes the stream): cancelling the awaiting task cannot stop
    the worker thread, so the triage checks the flag between pages, sheets and
    OCR strips and ends with ``TriageCancelled``.
    """

    def factory(queue: Any) -> Any:
        async def run() -> None:
            from groundmodel.application.triage_cpt_pdf_report import TriageCptPdfReport

            loop = asyncio.get_running_loop()

            def progress(phase: str, done: int, total: int, ocr: bool = False) -> None:
                # Called on the worker thread: hand the tick to the event loop.
                # ``ocr`` is additive: older clients read phase / done / total.
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"phase": phase, "done": done, "total": total, "ocr": ocr},
                )

            try:
                digest = await asyncio.to_thread(
                    TriageCptPdfReport(store, triager_factory).run,
                    project_id,
                    file_sha,
                    file_name,
                    progress,
                    cancel.is_set,
                )
                await queue.put({"type": "done", "result": digest.to_dict()})
            except asyncio.CancelledError:
                # The awaiting task is gone; stop the thread too.
                cancel.set()
                raise
            except TriageCancelled as exc:
                # A cancel is the user's choice, not a failure: no error event.
                logger.info(f"PDF triage {file_sha[:12]} cancelled: {exc}")
                await queue.put({"type": "cancelled"})
            except CptPdfReportNotFoundError as exc:
                logger.warning(f"PDF triage {file_sha[:12]}: {exc}")
                await queue.put(
                    {"type": "error", "code": "cpt_pdf_report_unknown", "message": str(exc)}
                )
            except Exception as exc:  # noqa: BLE001 -- the stream must end with an event
                logger.error(f"PDF triage {file_sha[:12]} failed: {type(exc).__name__}: {exc}")
                await queue.put({"type": "error", "message": "The report could not be read"})
            finally:
                await queue.put(None)

        return run()

    return factory


@router.post("/triage", status_code=status.HTTP_202_ACCEPTED)
async def triage_cpt_pdf(
    file: UploadFile,
    project_id: UUID = Form(...),
    store: PdfReportStore = Depends(get_pdf_report_store),
    registry: JobRegistry = Depends(get_job_registry),
    triager_factory: Callable[[], PdfReportTriager] = Depends(get_pdf_triager_factory),
) -> dict[str, str]:
    """Spool a PDF report and triage it as a background job.

    The upload is streamed to the project's temp store keyed by its SHA-256
    (the same report uploaded twice is stored once and, when already triaged,
    answers at once). The job classifies every page, sets desk-study reprints
    and repeated sheets aside, and digitises the campaign's soundings; the
    client attaches to ``GET /cpt/pdf/triage/{job_id}`` for the progress
    stream, whose terminal ``{"type": "done", "result": <digest>}`` event
    carries what the dialog lists. Vector reports take ~30 s; with OCR up to
    3 min.

    Parameters
    ----------
    file : UploadFile
        The report (``.pdf``).
    project_id : UUID
        The project the soundings are for.
    store : PdfReportStore
        The report store, injected.
    registry : JobRegistry
        The job registry, injected.
    triager_factory : callable
        Builds the triager, injected.

    Returns
    -------
    dict
        ``{"job_id": ..., "file_sha": ...}``.

    Raises
    ------
    HTTPException(400)
        When the file is not a PDF.
    HTTPException(409)
        When a triage of the same report for the project is already running.
    HTTPException(413)
        When the upload exceeds the byte cap.
    """
    file_name = Path(file.filename or "report.pdf").name
    logger.info(f"POST /cpt/pdf/triage: project {project_id}")
    logger.debug(f"POST /cpt/pdf/triage: file {file_name!r}")
    tmp_path, file_sha = await _spool(file, store.project_dir(project_id))
    store.put_file(project_id, file_sha, tmp_path)
    cancel = threading.Event()
    factory = _triage_job(store, project_id, file_sha, file_name, triager_factory, cancel)
    try:
        job_id = registry.start(
            factory, key=f"cpt-pdf:{project_id}:{file_sha}", cancel_event=cancel
        )
    except DuplicateImportJobError as exc:
        raise map_duplicate_import_job(exc) from exc
    logger.info(f"PDF triage job {job_id} spawned for report {file_sha[:12]}")
    return {"job_id": str(job_id), "file_sha": file_sha}


@router.get("/triage/{job_id}")
async def get_cpt_pdf_triage_stream(
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> StreamingResponse:
    """Drain the SSE progress stream of a triage job.

    Events: ``{"phase": "classify"|"digitise", "done": n, "total": m,
    "ocr": bool}`` ticks (``ocr`` True while OCR is what the triage is doing),
    then ``{"type": "done", "result": <digest>}``, ``{"type": "error",
    "message": ...}`` or ``{"type": "cancelled"}`` (the triage was stopped;
    closing the stream stops it).

    Parameters
    ----------
    job_id : UUID
        From ``POST /cpt/pdf/triage``.
    registry : JobRegistry
        The job registry, injected.

    Returns
    -------
    StreamingResponse
        ``text/event-stream``.

    Raises
    ------
    HTTPException(404)
        When no such job is registered.
    """
    return dov_sse_stream_response(job_id, registry)


@router.get("/page/{file_sha}/{page_number}.png")
async def get_cpt_pdf_page(
    file_sha: str,
    page_number: int,
    project_id: UUID = Query(...),
    dpi: float = Query(PAGE_THUMBNAIL_DPI, ge=MIN_RENDER_DPI, le=MAX_RENDER_DPI),
    store: PdfReportStore = Depends(get_pdf_report_store),
) -> Response:
    """Return one page of a stored report as a PNG (the triage list's thumbnails).

    Parameters
    ----------
    file_sha : str
        SHA-256 of the report.
    page_number : int
        1-based page.
    project_id : UUID
        The project the report was uploaded into.
    dpi : float
        Render resolution (default 80).
    store : PdfReportStore
        The report store, injected.

    Returns
    -------
    Response
        ``image/png``.

    Raises
    ------
    HTTPException(404)
        When the report or the page does not exist.
    """
    from groundmodel.infrastructure.parsers.cpt.pdf.pdf_page_renderer import PdfPageRenderer

    def render() -> bytes:
        with store.opened(project_id, file_sha) as doc:
            return PdfPageRenderer().page_png(doc, page_number, dpi)

    try:
        png = await asyncio.to_thread(render)
    except CptPdfReportNotFoundError as exc:
        raise _not_found("cpt_pdf_report_unknown", str(exc)) from exc
    except ValueError as exc:
        raise _not_found("cpt_pdf_page_unknown", str(exc)) from exc
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


def _digitise_response(view: PdfSoundingView, key: str) -> CptPdfDigitiseResponse:
    """Build the digitise answer from the use case's view."""
    series: dict[str, list[Any]] = {}
    if view.table is not None:
        for name in view.table.columns:
            column = view.table[name]
            if name.endswith("_clipped"):
                column = column.fill_null(False)
            series[name] = column.to_list()
    assumptions: list[str] = []
    for cal in view.sounding.calibrations:
        for text in (*cal.assumptions, *(a for p in cal.panels for a in p.assumptions)):
            if text not in assumptions:
                assumptions.append(text)
    overlays = [
        CptPdfOverlay(
            page_number=page,
            dpi=view.overlay_dpi,
            width=int.from_bytes(png[16:20], "big"),
            height=int.from_bytes(png[20:24], "big"),
            png_base64=base64.b64encode(png).decode("ascii"),
        )
        for page, png in view.overlays.items()
    ]
    listed = view.listed
    return CptPdfDigitiseResponse(
        sounding_id=key,
        page_numbers=list(view.sounding.page_numbers),
        series=series,
        sampling=view.sampling,
        calibrations=[c.to_dict() for c in view.sounding.calibrations],
        assumptions=assumptions,
        clipped_count=sum(int(c.clipped.sum()) for c in view.sounding.curves.values()),
        printed_values=[[round(d, 3), t] for d, t in view.sounding.annotations],
        header={
            "x": listed.x,
            "y": listed.y,
            "epsg": listed.epsg,
            "ground_level_m": listed.ground_level_m,
            "z_epsg": listed.z_epsg,
            "test_date": listed.test_date,
        },
        warnings=list(listed.warnings),
        notes=[n.to_dict() for n in listed.notes],
        overlays=overlays,
    )


@router.post("/digitise", response_model=CptPdfDigitiseResponse)
async def digitise_cpt_pdf_sounding(
    request: CptPdfDigitiseRequest,
    store: PdfReportStore = Depends(get_pdf_report_store),
) -> CptPdfDigitiseResponse:
    """Read one sounding through the calibration the user settled on.

    Called when a sounding is opened in the calibration overlay and again on
    every "Re-extract" (fast for vector sheets): the series, the calibration
    used, the assumptions, and one overlay PNG per page with the digitised
    curve in orange over the page.

    Parameters
    ----------
    request : CptPdfDigitiseRequest
        Report, sounding, optional edited calibrations and ground level.
    store : PdfReportStore
        The report store, injected.

    Returns
    -------
    CptPdfDigitiseResponse
        The sounding as the overlay shows it.

    Raises
    ------
    HTTPException(404)
        ``cpt_pdf_report_unknown`` / ``cpt_pdf_sounding_unknown``.
    HTTPException(422)
        When a calibration dict is malformed or cannot be read through.
    """
    from groundmodel.application.digitise_cpt_pdf_sounding import DigitiseCptPdfSounding

    logger.info(
        f"POST /cpt/pdf/digitise: report {request.file_sha[:12]} sounding "
        f"{request.sounding_id} ({len(request.calibrations or [])} edited page(s))"
    )
    try:
        view = await asyncio.to_thread(
            DigitiseCptPdfSounding(store).run,
            request.project_id,
            request.file_sha,
            request.sounding_id,
            request.calibrations,
            request.ground_level_m,
            OVERLAY_DPI,
        )
    except CptPdfReportNotFoundError as exc:
        raise _not_found("cpt_pdf_report_unknown", str(exc)) from exc
    except KeyError as exc:
        raise _not_found(
            "cpt_pdf_sounding_unknown",
            f"sounding {request.sounding_id} is not one of this report's soundings",
        ) from exc
    except (ValueError, TypeError) as exc:
        logger.warning(f"POST /cpt/pdf/digitise: calibration refused: {exc}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "cpt_pdf_calibration_invalid", "message": str(exc)},
        ) from exc
    return _digitise_response(view, request.sounding_id)


@router.post("/import", response_model=CptPdfImportResponse)
async def import_cpt_pdf(
    request: CptPdfImportRequest,
    store: PdfReportStore = Depends(get_pdf_report_store),
    session: AsyncSession = Depends(get_session),
) -> CptPdfImportResponse:
    """Import the ticked soundings, one CPT each, through the GEF import's door.

    Answers 200 with one outcome per sounding: ``imported`` (new CPT),
    ``refreshed`` (replaced with consent), ``confirmation_required`` (already
    in the project: nothing written, the GEF import's own
    ``cpt_refresh_confirmation_required`` code + the old-vs-new diff; the
    client asks and re-posts the agreed ones with ``confirm_refresh``),
    ``refused`` (``pdf_no_xy``: no position printed and none typed;
    ``cpt_refresh_refused``; ``pdf_sounding_not_offered``) or ``failed``.

    Parameters
    ----------
    request : CptPdfImportRequest
        Report, ticked soundings, calibrations, typed headers, consent.
    store : PdfReportStore
        The report store, injected.
    session : AsyncSession
        Database session, injected.

    Returns
    -------
    CptPdfImportResponse
        One outcome per sounding.

    Raises
    ------
    HTTPException(404)
        ``cpt_pdf_report_unknown`` when the report is not triaged.
    """
    from groundmodel.application.import_cpt_pdf import ImportCptPdf
    from groundmodel.application.pdf_sounding_import_request import PdfSoundingImportRequest

    logger.info(
        f"POST /cpt/pdf/import: {len(request.sounding_ids)} sounding(s) of report "
        f"{request.file_sha[:12]} into project {request.project_id} "
        f"(confirm_refresh={request.confirm_refresh})"
    )
    headers = request.headers or {}
    calibrations = request.calibrations or {}
    requests = []
    for key in request.sounding_ids:
        typed = headers.get(key)
        requests.append(
            PdfSoundingImportRequest(
                key=key,
                calibrations=calibrations.get(key),
                x=typed.x if typed else None,
                y=typed.y if typed else None,
                epsg=typed.epsg if typed else None,
                ground_level_m=typed.ground_level_m if typed else None,
                test_date=typed.test_date if typed else None,
            )
        )
    try:
        outcomes = await ImportCptPdf(session, store).execute(
            request.project_id, request.file_sha, requests, request.confirm_refresh
        )
    except CptPdfReportNotFoundError as exc:
        raise _not_found("cpt_pdf_report_unknown", str(exc)) from exc
    return CptPdfImportResponse(
        results=[
            CptPdfImportResultItem(
                sounding_id=o.key,
                status=o.status,
                name=o.name,
                cpt_id=o.cpt_id,
                code=o.code,
                message=o.message,
                diff=o.diff,
                issues=[ValidationIssueSchema.from_issue(i) for i in o.issues],
            )
            for o in outcomes
        ]
    )
