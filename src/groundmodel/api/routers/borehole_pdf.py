"""Borehole PDF import routes: triage a borehole-log report, import its boreholes.

Data -> Import -> Boring -> "Uit een pdf-rapport". The CPT digitiser's user
path (``cpt_pdf.py``) for borehole logs: the dialog uploads the report once
(``POST /borehole/pdf/triage``, a background job with progress and a
cooperative cancel, cached by SHA-256), lists one row per borehole with the
findings the import asks about, shows page thumbnails, and imports the ticked
boreholes with the user's confirmations through the DOV XML file import's
consent rule (``POST /borehole/pdf/import``).

The PDF machinery (PyMuPDF, the digitiser) is imported inside the handlers,
not at module load: the API boots without it (packaged cold start).
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Response, UploadFile, status
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
from groundmodel.api.schemas.borehole.borehole_pdf_import_request import (
    BoreholePdfImportRequest,
)
from groundmodel.api.schemas.borehole.import_borehole_file_response import (
    ImportBoreholeFileResponse,
)
from groundmodel.api.schemas.borehole.imported_boring_schema import ImportedBoringSchema
from groundmodel.api.schemas.validation_issue_schema import ValidationIssueSchema
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_report_store import (
    get_borehole_pdf_report_store,
)
from groundmodel.infrastructure.parsers.borehole.pdf.cached_borehole_pdf_report import (
    CachedBoreholePdfReport,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    MAX_PDF_UPLOAD_BYTES,
    MAX_RENDER_DPI,
    MIN_RENDER_DPI,
    PAGE_THUMBNAIL_DPI,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.shared.exceptions import (
    BoreholePdfImportRefusedError,
    BoreholeRefreshConfirmationRequiredError,
    BoreholeRefreshRefusedError,
    CptPdfReportNotFoundError,
    DuplicateImportJobError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

if TYPE_CHECKING:
    from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_triager import (
        BoreholePdfTriager,
    )

# Module-level logger: routers are functions, not classes (documented fallback).
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(prefix="/borehole/pdf", tags=["borehole-pdf"])

# The 404 codes the dialog branches on.
REPORT_UNKNOWN_CODE = "borehole_pdf_report_unknown"
PAGE_UNKNOWN_CODE = "borehole_pdf_page_unknown"


def get_borehole_pdf_triager_factory() -> Callable[[], BoreholePdfTriager]:
    """Return the triager factory (FastAPI dependency; tests pass one without OCR).

    Returns
    -------
    callable
        Builds a ``BoreholePdfTriager`` with OCR when the ``pdf-ocr`` extra is
        installed.
    """
    from groundmodel.application.triage_borehole_pdf_report import default_borehole_triager

    return default_borehole_triager


@router.post("/triage", status_code=status.HTTP_202_ACCEPTED)
async def triage_borehole_pdf(
    file: UploadFile,
    project_id: UUID = Form(...),
    store: PdfReportStore[CachedBoreholePdfReport] = Depends(get_borehole_pdf_report_store),
    registry: JobRegistry = Depends(get_job_registry),
    triager_factory: Callable[[], BoreholePdfTriager] = Depends(get_borehole_pdf_triager_factory),
) -> dict[str, str]:
    """Spool a borehole-log report and triage it as a background job.

    The upload is streamed to the project's temp store keyed by its SHA-256
    (the same report uploaded twice is stored once and, when already triaged,
    answers at once). The job classifies every page, sets identical repeat
    prints aside and parses every borehole a layout profile reads; the client
    attaches to ``GET /borehole/pdf/triage/{job_id}`` for the progress stream,
    whose terminal ``{"type": "done", "result": ...}`` event carries what the
    dialog lists (the digest + per borehole its counts, findings and
    ``importable``).

    Parameters
    ----------
    file : UploadFile
        The report (``.pdf``).
    project_id : UUID
        The project the boreholes are for.
    store : PdfReportStore
        The borehole report store, injected.
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
        When a triage of the same report for the project is already running
        (``detail.job_id`` names it: the dialog attaches to it).
    HTTPException(413)
        When the upload exceeds the byte cap.
    """
    file_name = Path(file.filename or "report.pdf").name
    logger.info(f"POST /borehole/pdf/triage: project {project_id}")
    logger.debug(f"POST /borehole/pdf/triage: file {file_name!r}")
    tmp_path, file_sha = await spool_pdf_upload(
        file, store.project_dir(project_id), MAX_PDF_UPLOAD_BYTES
    )
    store.put_file(project_id, file_sha, tmp_path)
    cancel = threading.Event()

    def run(progress: Callable[..., None], should_stop: Callable[[], bool]) -> dict[str, Any]:
        from groundmodel.application.triage_borehole_pdf_report import TriageBoreholePdfReport

        report = TriageBoreholePdfReport(store, triager_factory).run(
            project_id, file_sha, file_name, progress, should_stop
        )
        return report.to_triage_dict()

    factory = pdf_triage_job(run, file_sha, cancel, REPORT_UNKNOWN_CODE)
    try:
        job_id = registry.start(
            factory, key=f"borehole-pdf:{project_id}:{file_sha}", cancel_event=cancel
        )
    except DuplicateImportJobError as exc:
        raise map_duplicate_import_job(exc) from exc
    logger.info(f"borehole PDF triage job {job_id} spawned for report {file_sha[:12]}")
    return {"job_id": str(job_id), "file_sha": file_sha}


@router.get("/triage/{job_id}")
async def get_borehole_pdf_triage_stream(
    job_id: UUID,
    registry: JobRegistry = Depends(get_job_registry),
) -> StreamingResponse:
    """Drain the SSE progress stream of a borehole triage job.

    Events: ``{"phase": "classify"|"digitise", "done": n, "total": m, "ocr":
    bool}`` ticks, then ``{"type": "done", "result": ...}``, ``{"type":
    "error", ...}`` or ``{"type": "cancelled"}`` (closing the stream stops
    the triage).

    Parameters
    ----------
    job_id : UUID
        From ``POST /borehole/pdf/triage``.
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
async def get_borehole_pdf_page(
    file_sha: str,
    page_number: int,
    project_id: UUID = Query(...),
    dpi: float = Query(PAGE_THUMBNAIL_DPI, ge=MIN_RENDER_DPI, le=MAX_RENDER_DPI),
    store: PdfReportStore[CachedBoreholePdfReport] = Depends(get_borehole_pdf_report_store),
) -> Response:
    """Return one page of a stored borehole report as a PNG (the list's thumbnails).

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
        The borehole report store, injected.

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
        raise pdf_not_found(REPORT_UNKNOWN_CODE, str(exc)) from exc
    except ValueError as exc:
        raise pdf_not_found(PAGE_UNKNOWN_CODE, str(exc)) from exc
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@router.post(
    "/import", response_model=ImportBoreholeFileResponse, status_code=status.HTTP_201_CREATED
)
async def import_borehole_pdf(
    request: BoreholePdfImportRequest,
    response: Response,
    store: PdfReportStore[CachedBoreholePdfReport] = Depends(get_borehole_pdf_report_store),
    session: AsyncSession = Depends(get_session),
) -> ImportBoreholeFileResponse:
    """Import the ticked boreholes of a triaged report, one borehole each.

    The DOV XML file import's answer shape and consent rule:

    * only new boreholes -> **201**; one per row with its findings;
    * borehole(s) already in the project, no ``confirm_refresh`` -> **409**
      ``borehole_refresh_confirmation_required`` + ``diffs``; nothing written;
    * with ``confirm_refresh`` -> **200**, those boreholes ``refreshed``;
    * a borehole whose ``CRS_ASSUMED`` / ``WATER_UNIT_ASSUMED`` was not
      confirmed -> **422** ``borehole_pdf_assumption_unconfirmed`` (owner
      rulings 2026-10-08, 3 and 4); likewise ``borehole_pdf_crs_unsupported``,
      ``borehole_pdf_borehole_not_offered``, ``borehole_pdf_repeat_choose_one``
      and ``borehole_refresh_refused``; nothing written.

    Parameters
    ----------
    request : BoreholePdfImportRequest
        Report, ticked boreholes with their confirmations, consent.
    response : Response
        Injected so the handler can answer 200 (refreshed) instead of 201.
    store : PdfReportStore
        The borehole report store, injected.
    session : AsyncSession
        Database session, injected.

    Returns
    -------
    ImportBoreholeFileResponse
        One entry per borehole with its findings.

    Raises
    ------
    HTTPException(404)
        ``borehole_pdf_report_unknown`` when the report is not triaged.
    HTTPException(409)
        Boreholes already in the project and the refresh was not confirmed.
    HTTPException(422)
        A request the import cannot honour as asked (see above).
    """
    from groundmodel.application.borehole_pdf_import_request import (
        BoreholePdfImportRequest as ImportRequest,
    )
    from groundmodel.application.import_borehole_pdf import ImportBoreholePdf

    logger.info(
        f"POST /borehole/pdf/import: {len(request.boreholes)} borehole(s) of report "
        f"{request.file_sha[:12]} into project {request.project_id} "
        f"(confirm_refresh={request.confirm_refresh})"
    )
    requests = [
        ImportRequest(
            key=item.key,
            crs_epsg=item.crs.epsg if item.crs else None,
            crs_scope=item.crs.scope if item.crs else None,
            water_unit_confirmed=item.water_unit_confirmed,
        )
        for item in request.boreholes
    ]
    try:
        result = await ImportBoreholePdf(session, store).execute(
            request.project_id,
            request.file_sha,
            requests,
            confirm_refresh=request.confirm_refresh,
        )
    except CptPdfReportNotFoundError as exc:
        raise pdf_not_found(REPORT_UNKNOWN_CODE, str(exc)) from exc
    except BoreholeRefreshConfirmationRequiredError as exc:
        logger.info(
            f"POST /borehole/pdf/import: {len(exc.diffs)} refresh(es) await confirmation; "
            "nothing written"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "borehole_refresh_confirmation_required",
                "message": str(exc),
                "diffs": exc.diffs,
            },
        ) from exc
    except BoreholeRefreshRefusedError as exc:
        logger.warning(f"POST /borehole/pdf/import: refresh refused ({exc.reason})")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "borehole_refresh_refused", "reason": exc.reason, "message": str(exc)},
        ) from exc
    except BoreholePdfImportRefusedError as exc:
        logger.warning(f"POST /borehole/pdf/import: refused ({exc.code})")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": str(exc), "boreholes": exc.boreholes},
        ) from exc

    if any(b.refreshed for b in result.boreholes):
        response.status_code = status.HTTP_200_OK
    logger.info(
        f"POST /borehole/pdf/import: {len(result.boreholes)} borehole(s), "
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
                issues=[ValidationIssueSchema.from_issue(i) for i in b.issues],
                refreshed=b.refreshed,
                imported=b.imported,
            )
            for b in result.boreholes
        ],
        file_issues=[ValidationIssueSchema.from_issue(i) for i in result.issues],
    )
