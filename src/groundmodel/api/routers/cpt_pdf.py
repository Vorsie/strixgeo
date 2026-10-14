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
from groundmodel.api.routers._pdf_report_helpers import (
    pdf_not_found,
    pdf_triage_job,
    spool_pdf_upload,
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
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
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
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

if TYPE_CHECKING:
    from groundmodel.application.pdf_sounding_view import PdfSoundingView
    from groundmodel.infrastructure.parsers.cpt.pdf.cpt_pdf_digitiser import CptPdfDigitiser
    from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_triager import PdfReportTriager

# Module-level logger: routers are functions, not classes (documented fallback).
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/cpt/pdf", tags=["cpt-pdf"])


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


def get_pdf_graph_detector_factory() -> Callable[[], CptPdfDigitiser]:
    """Return the factory of the digitiser that reads graph sheets (FastAPI dependency).

    Returns
    -------
    callable
        Builds a ``CptPdfDigitiser`` with OCR (used when the ``pdf-ocr``
        extra is installed); tests pass a no-OCR one.
    """
    from groundmodel.application.cpt_pdf_graph_twin_reader import graph_sheet_detector

    return graph_sheet_detector


def _graph_twin_job(
    store: PdfReportStore[CachedPdfReport],
    project_id: UUID,
    file_sha: str,
    detector_factory: Callable[[], CptPdfDigitiser],
    cancel: threading.Event,
) -> Callable[[Any], Any]:
    """Return the job factory: the background graph-sheet read in a worker thread."""

    def run(progress: Callable[..., None], should_stop: Callable[[], bool]) -> dict[str, Any]:
        from groundmodel.application.read_cpt_pdf_graph_twins import ReadCptPdfGraphTwins

        return ReadCptPdfGraphTwins(store, detector_factory).run(
            project_id, file_sha, progress, should_stop
        )

    return pdf_triage_job(run, file_sha, cancel, "cpt_pdf_report_unknown")


def _spawn_graph_twin_read(
    registry: JobRegistry,
    store: PdfReportStore[CachedPdfReport],
    project_id: UUID,
    file_sha: str,
    detector_factory: Callable[[], CptPdfDigitiser],
) -> str | None:
    """Start the background read of a triaged report's graph sheets, if it has any.

    Owner 2026-10-14 ("sondering wordt gelezen is traag"): the graph sheets
    of the printed-table soundings are read right after the triage, so the
    calibration overlay opens at once. Runs on the event loop. A read of the
    same report still running is reused (its id is answered).

    Returns
    -------
    str or None
        The job id, or None when nothing is left to read (no printed-table
        graph sheet, or all read already).
    """
    from groundmodel.application.read_cpt_pdf_graph_twins import ReadCptPdfGraphTwins

    pending = ReadCptPdfGraphTwins(store, detector_factory).pending(project_id, file_sha)
    if not pending:
        logger.debug(f"PDF report {file_sha[:12]}: no graph sheet left to read")
        return None
    cancel = threading.Event()
    factory = _graph_twin_job(store, project_id, file_sha, detector_factory, cancel)
    try:
        job_id = registry.start(
            factory, key=f"cpt-pdf-graph:{project_id}:{file_sha}", cancel_event=cancel
        )
    except DuplicateImportJobError as exc:
        logger.info(f"PDF report {file_sha[:12]}: graph sheet read already running as {exc.job_id}")
        return str(exc.job_id)
    logger.info(
        f"PDF graph sheet job {job_id} spawned for report {file_sha[:12]}: "
        f"{len(pending)} sounding(s)"
    )
    return str(job_id)


def _triage_job(
    store: PdfReportStore[CachedPdfReport],
    project_id: UUID,
    file_sha: str,
    file_name: str,
    triager_factory: Callable[[], PdfReportTriager],
    cancel: threading.Event,
    registry: JobRegistry,
    detector_factory: Callable[[], CptPdfDigitiser],
) -> Callable[[Any], Any]:
    """Return the job factory: the CPT triage in a worker thread (shared plumbing).

    When the triage is done, the background read of the graph sheets is
    spawned and its job id added to the result (``graph_job_id``, additive:
    present only when there is something to read).
    """

    def run(progress: Callable[..., None], should_stop: Callable[[], bool]) -> dict[str, Any]:
        from groundmodel.application.triage_cpt_pdf_report import TriageCptPdfReport

        digest = TriageCptPdfReport(store, triager_factory).run(
            project_id, file_sha, file_name, progress, should_stop
        )
        return digest.to_dict()

    def after(result: dict[str, Any]) -> dict[str, Any]:
        try:
            job_id = _spawn_graph_twin_read(registry, store, project_id, file_sha, detector_factory)
        except Exception as exc:  # noqa: BLE001 -- the triage succeeded; the overlay reads on demand
            logger.warning(
                f"PDF report {file_sha[:12]}: background graph sheet read not started "
                f"({type(exc).__name__}: {exc}); the overlay reads them on demand"
            )
            return result
        return result if job_id is None else {**result, "graph_job_id": job_id}

    return pdf_triage_job(run, file_sha, cancel, "cpt_pdf_report_unknown", after=after)


@router.post("/triage", status_code=status.HTTP_202_ACCEPTED)
async def triage_cpt_pdf(
    file: UploadFile,
    project_id: UUID = Form(...),
    store: PdfReportStore[CachedPdfReport] = Depends(get_pdf_report_store),
    registry: JobRegistry = Depends(get_job_registry),
    triager_factory: Callable[[], PdfReportTriager] = Depends(get_pdf_triager_factory),
    detector_factory: Callable[[], CptPdfDigitiser] = Depends(get_pdf_graph_detector_factory),
) -> dict[str, str]:
    """Spool a PDF report and triage it as a background job.

    The upload is streamed to the project's temp store keyed by its SHA-256
    (the same report uploaded twice is stored once and, when already triaged,
    answers at once). The job classifies every page, sets desk-study reprints
    and repeated sheets aside, and digitises the campaign's soundings; the
    client attaches to ``GET /cpt/pdf/triage/{job_id}`` for the progress
    stream, whose terminal ``{"type": "done", "result": <digest>}`` event
    carries what the dialog lists (plus ``graph_job_id`` when a background
    read of printed-table graph sheets follows; attach to it the same way).
    Vector reports take ~30 s; with OCR up to 3 min.

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
    detector_factory : callable
        Builds the digitiser of the background graph-sheet read, injected.

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
    tmp_path, file_sha = await spool_pdf_upload(
        file, store.project_dir(project_id), MAX_PDF_UPLOAD_BYTES
    )
    store.put_file(project_id, file_sha, tmp_path)
    cancel = threading.Event()
    factory = _triage_job(
        store, project_id, file_sha, file_name, triager_factory, cancel, registry, detector_factory
    )
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
    """Drain the SSE progress stream of a triage job (or of its graph-sheet read).

    Events: ``{"phase": "classify"|"digitise", "done": n, "total": m,
    "ocr": bool}`` ticks (``ocr`` True while OCR is what the triage is doing),
    then ``{"type": "done", "result": <digest>}``, ``{"type": "error",
    "message": ...}`` or ``{"type": "cancelled"}`` (the triage was stopped;
    closing the stream stops it). The background graph-sheet read named by
    the digest's ``graph_job_id`` streams ``{"phase": "graph", "done": n,
    "total": m, "ocr": false, "key": <sounding>}`` (no ``key`` on the first
    tick), then ``{"type": "done", "result": {"read": [...], "total": m}}``.

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
    store: PdfReportStore[CachedPdfReport] = Depends(get_pdf_report_store),
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
        raise pdf_not_found("cpt_pdf_report_unknown", str(exc)) from exc
    except ValueError as exc:
        raise pdf_not_found("cpt_pdf_page_unknown", str(exc)) from exc
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


def _series(table: Any) -> dict[str, list[Any]]:
    """Return a stored-rows frame as JSON lists (flag columns without nulls)."""
    series: dict[str, list[Any]] = {}
    if table is not None:
        for name in table.columns:
            column = table[name]
            if name.endswith("_clipped"):
                column = column.fill_null(False)
            series[name] = column.to_list()
    return series


def _digitise_response(view: PdfSoundingView, key: str) -> CptPdfDigitiseResponse:
    """Build the digitise answer from the use case's view.

    A printed-table sounding answers its printed table as ``series`` and its
    graph sheet as the calibrations / overlays the overlay edits, with the
    picture's rows apart in ``graph_series`` (owner 2026-10-12).
    """
    series = _series(view.table)
    drawn = view.graph if view.graph is not None else view.sounding
    assumptions: list[str] = []
    for cal in drawn.calibrations:
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
        calibrations=[c.to_dict() for c in drawn.calibrations],
        assumptions=assumptions,
        clipped_count=sum(int(c.clipped.sum()) for c in drawn.curves.values()),
        printed_values=[[round(d, 3), t] for d, t in drawn.annotations],
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
        graph_series=_series(view.graph_table) if view.graph_table is not None else None,
        graph_comparison=view.comparison,
        # A printed-table sounding stores its table unless told otherwise
        # (SERIES_SOURCE_TABLE; the pdf package is not imported at module load).
        series_source_default="table" if view.graph is not None else None,
    )


@router.post("/digitise", response_model=CptPdfDigitiseResponse)
async def digitise_cpt_pdf_sounding(
    request: CptPdfDigitiseRequest,
    store: PdfReportStore[CachedPdfReport] = Depends(get_pdf_report_store),
    detector_factory: Callable[[], CptPdfDigitiser] = Depends(get_pdf_graph_detector_factory),
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
    detector_factory : callable
        Builds the digitiser of a graph sheet not read yet, injected.

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
            DigitiseCptPdfSounding(store, detector_factory=detector_factory).run,
            request.project_id,
            request.file_sha,
            request.sounding_id,
            request.calibrations,
            request.ground_level_m,
            OVERLAY_DPI,
        )
    except CptPdfReportNotFoundError as exc:
        raise pdf_not_found("cpt_pdf_report_unknown", str(exc)) from exc
    except KeyError as exc:
        raise pdf_not_found(
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
    store: PdfReportStore[CachedPdfReport] = Depends(get_pdf_report_store),
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
                project_number=typed.project_number if typed else None,
                series_source=(request.series_source or {}).get(key),
            )
        )
    try:
        outcomes = await ImportCptPdf(session, store).execute(
            request.project_id, request.file_sha, requests, request.confirm_refresh
        )
    except CptPdfReportNotFoundError as exc:
        raise pdf_not_found("cpt_pdf_report_unknown", str(exc)) from exc
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
