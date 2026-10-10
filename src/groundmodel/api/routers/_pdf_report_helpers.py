"""Shared plumbing of the PDF report import routes (CPT digitiser, borehole digitiser).

Both dialogs upload a report once, keyed by its SHA-256, and triage it as a
background job whose progress streams over SSE (the DOV import pattern). The
upload spool, the 404 shape the dialogs branch on and the job factory live
here once so the two routers cannot drift.

Module-level functions, not a class: routers are functions (documented
fallback for the logger too).
"""

from __future__ import annotations

import asyncio
import hashlib
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status

from groundmodel.shared.exceptions import CptPdfReportNotFoundError, TriageCancelled
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

# Every PDF starts with this marker (ISO 32000); anything else named .pdf is
# refused before it is spooled or opened.
PDF_MAGIC = b"%PDF-"

# ``run(progress, should_stop) -> result dict``: the triage a job runs in a
# worker thread; ``progress(phase, done, total, ocr=...)`` is thread-safe.
TriageRun = Callable[[Callable[..., None], Callable[[], bool]], dict[str, Any]]


def pdf_not_found(code: str, message: str) -> HTTPException:
    """Return the 404 a PDF import dialog branches on (``detail.code``).

    Parameters
    ----------
    code : str
        Machine-readable code (``cpt_pdf_report_unknown``, ...).
    message : str
        Human-readable message.

    Returns
    -------
    HTTPException
        Status 404.
    """
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail={"code": code, "message": message}
    )


async def spool_pdf_upload(file: UploadFile, directory: Path, max_bytes: int) -> tuple[Path, str]:
    """Stream an upload to a temp file under ``directory``, hashing it on the way.

    Parameters
    ----------
    file : UploadFile
        The upload.
    directory : pathlib.Path
        Where the temp file goes (the report store's project folder).
    max_bytes : int
        Upload cap (the caller passes its module constant at call time).

    Returns
    -------
    tuple
        ``(temp path, sha256 hex)``.

    Raises
    ------
    HTTPException(413)
        Past ``max_bytes``.
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
                if received > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"PDF upload exceeds the {max_bytes // (1024 * 1024)} MiB cap",
                    )
                if len(head) < len(PDF_MAGIC):
                    head += chunk[: len(PDF_MAGIC)]
                digest.update(chunk)
                tmp.write(chunk)
        except HTTPException:
            tmp.close()
            tmp_path.unlink(missing_ok=True)
            raise
    if not head.startswith(PDF_MAGIC):
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="the file is not a PDF")
    logger.debug(f"PDF upload spooled: {received} bytes, sha {digest.hexdigest()[:12]}")
    return tmp_path, digest.hexdigest()


def pdf_triage_job(
    run: TriageRun,
    file_sha: str,
    cancel: threading.Event,
    unknown_code: str,
) -> Callable[[Any], Any]:
    """Return the job factory: triage in a worker thread, progress onto the queue.

    ``cancel`` is the job's cooperative stop flag (the registry raises it when
    the dialog closes the stream): cancelling the awaiting task cannot stop
    the worker thread, so the triage checks the flag between pages and ends
    with ``TriageCancelled``.

    Parameters
    ----------
    run : callable
        ``run(progress, should_stop)`` -> the terminal result dict.
    file_sha : str
        The report's SHA-256 (for the log lines).
    cancel : threading.Event
        The job's stop flag.
    unknown_code : str
        The error-event code when the store no longer holds the report.

    Returns
    -------
    callable
        ``factory(queue) -> coroutine`` for ``JobRegistry.start``.
    """

    def factory(queue: Any) -> Any:
        async def job() -> None:
            loop = asyncio.get_running_loop()

            def progress(phase: str, done: int, total: int, ocr: bool = False) -> None:
                # Called on the worker thread: hand the tick to the event loop.
                # ``ocr`` is additive: older clients read phase / done / total.
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"phase": phase, "done": done, "total": total, "ocr": ocr},
                )

            try:
                result = await asyncio.to_thread(run, progress, cancel.is_set)
                await queue.put({"type": "done", "result": result})
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
                await queue.put({"type": "error", "code": unknown_code, "message": str(exc)})
            except Exception as exc:  # noqa: BLE001 -- the stream must end with an event
                logger.error(f"PDF triage {file_sha[:12]} failed: {type(exc).__name__}: {exc}")
                await queue.put({"type": "error", "message": "The report could not be read"})
            finally:
                await queue.put(None)

        return job()

    return factory
