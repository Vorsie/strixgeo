"""Shared DOV upstream-error mapping + SSE plumbing for import routers.

The CPT and borehole DOV import routers carry the exact same four
``httpx`` failure arms (timeout / connect / upstream-status / generic
request error) in two forms — an ``HTTPException`` for the synchronous
import endpoint and a ``{"type": "error", ...}`` queue event for the
SSE background-import path — plus the identical SSE drain generator
and stream-response guard. Before this module the blocks lived
verbatim in both routers (4 duplicated block pairs); per the
Maintenance Rules ("extract on the second copy") they converge here.

Module is private (``_``-prefixed): only routers import from here.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse

from groundmodel.shared.exceptions import DovImportTooLargeError, DuplicateImportJobError

if TYPE_CHECKING:
    from groundmodel.application.job_registry import JobRegistry
    from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

#: Exception classes the DOV import paths map to user-facing errors.
#: ``HTTPStatusError`` is NOT a ``RequestError`` subclass, so both are
#: needed to cover the original four except-arms.
DOV_UPSTREAM_ERRORS = (httpx.HTTPStatusError, httpx.RequestError)

#: ``detail.code`` for the "bbox holds too many records" refusal (422 on the
#: synchronous path, an SSE error event with the same code on the stream path).
DOV_IMPORT_TOO_LARGE_CODE = "dov_import_too_large"

#: ``detail.code`` for the "an import for this scope is already running" refusal
#: (409 on the import-stream POST endpoints).
DOV_IMPORT_ALREADY_RUNNING_CODE = "dov_import_already_running"


def dov_import_job_key(
    kind: str,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    project_id: object | None,
) -> str:
    """Build the de-duplication key for a DOV import-stream job.

    The key folds the resource kind, the project scope, and the bbox corners so
    that a second identical import launched while the first is still running is
    refused (see :meth:`JobRegistry.start`). Corners are rounded to 6 decimal
    places (~0.1 m at Belgian latitudes) so floating-point noise in an otherwise
    identical redraw still collides; the ``kind`` prefix keeps a CPT import and a
    borehole import of the same box in separate scopes.

    Parameters
    ----------
    kind : str
        Resource kind, ``"cpt"`` or ``"borehole"``.
    west, south, east, north : float
        Bounding box corners in WGS84 decimal degrees.
    project_id : object | None
        The target project id (or ``None`` for the project-less path).

    Returns
    -------
    str
        A stable scope key.
    """
    return (
        f"{kind}:{project_id}:{round(west, 6)},{round(south, 6)},{round(east, 6)},{round(north, 6)}"
    )


def map_dov_too_large_error(exc: DovImportTooLargeError) -> HTTPException:
    """Map a discovery-ceiling refusal to the ``422`` for the synchronous path."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": DOV_IMPORT_TOO_LARGE_CODE, "message": str(exc)},
    )


def dov_too_large_event(exc: DovImportTooLargeError) -> dict[str, str]:
    """Map a discovery-ceiling refusal to a terminal SSE ``error`` event."""
    return {"type": "error", "code": DOV_IMPORT_TOO_LARGE_CODE, "message": str(exc)}


def map_duplicate_import_job(exc: DuplicateImportJobError) -> HTTPException:
    """Map a duplicate-scope refusal to the ``409`` naming the running job-id."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": DOV_IMPORT_ALREADY_RUNNING_CODE,
            "message": str(exc),
            "job_id": str(exc.job_id),
        },
    )


def _dov_error_message(
    exc: httpx.HTTPStatusError | httpx.RequestError,
    logger: GroundModelLogger,
    log_prefix: str,
) -> tuple[int, str]:
    """Log a DOV upstream failure and derive its user-facing message.

    The user-facing message carries only the failure category + (when
    safe) the upstream HTTP status. Library class names + exception
    messages stay server-side so debugging remains possible without
    leaking dependency versions or internal topology to a future
    non-trusted caller (debt #43).

    Dispatch order mirrors the original except-arm order: the specific
    ``TimeoutException`` / ``ConnectError`` subclasses before the
    ``RequestError`` catch-all.

    Parameters
    ----------
    exc
        The caught ``httpx`` exception.
    logger
        The calling router's module logger (helpers take the logger as
        a parameter; they never own one).
    log_prefix
        Prefix for the server-side warning, e.g. ``"DOV import"`` or
        ``"DOV borehole stream"`` — preserves each caller's original
        log wording.

    Returns
    -------
    tuple[int, str]
        ``(http_status_code, user_facing_message)``.
    """
    if isinstance(exc, httpx.TimeoutException):
        logger.warning(f"{log_prefix} timeout: {type(exc).__name__}: {exc}")
        return (status.HTTP_504_GATEWAY_TIMEOUT, "DOV did not respond in time")
    if isinstance(exc, httpx.ConnectError):
        logger.warning(f"{log_prefix} connect error: {type(exc).__name__}: {exc}")
        return (
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Cannot reach DOV — check your internet connection",
        )
    if isinstance(exc, httpx.HTTPStatusError):
        logger.warning(
            f"{log_prefix} upstream {exc.response.status_code}: {type(exc).__name__}: {exc}",
        )
        return (
            status.HTTP_502_BAD_GATEWAY,
            f"DOV returned HTTP {exc.response.status_code}",
        )
    logger.warning(f"{log_prefix} request error: {type(exc).__name__}: {exc}")
    return (status.HTTP_502_BAD_GATEWAY, "DOV request failed")


def map_dov_upstream_error(
    exc: httpx.HTTPStatusError | httpx.RequestError,
    *,
    logger: GroundModelLogger,
    log_prefix: str = "DOV import",
) -> HTTPException:
    """Map a DOV ``httpx`` failure to the ``HTTPException`` to raise.

    Synchronous-import form: the caller catches
    ``DOV_UPSTREAM_ERRORS`` and re-raises the returned exception
    (``raise map_dov_upstream_error(exc, logger=logger) from exc``).

    Parameters
    ----------
    exc
        The caught ``httpx`` exception.
    logger
        The calling router's module logger.
    log_prefix
        Server-side warning prefix; defaults to the wording both
        synchronous endpoints already used.

    Returns
    -------
    fastapi.HTTPException
        504 on timeout, 503 on connect failure, 502 otherwise.
    """
    status_code, message = _dov_error_message(exc, logger, log_prefix)
    return HTTPException(status_code=status_code, detail=message)


def dov_error_event(
    exc: httpx.HTTPStatusError | httpx.RequestError,
    *,
    logger: GroundModelLogger,
    log_prefix: str,
) -> dict:
    """Map a DOV ``httpx`` failure to an SSE ``error`` queue event.

    Background-import form: the import coroutine catches
    ``DOV_UPSTREAM_ERRORS`` and puts the returned dict on its event
    queue instead of raising.

    Parameters
    ----------
    exc
        The caught ``httpx`` exception.
    logger
        The calling router's module logger.
    log_prefix
        Server-side warning prefix, e.g. ``"DOV stream import"``.

    Returns
    -------
    dict
        ``{"type": "error", "message": <user-facing message>}``.
    """
    _, message = _dov_error_message(exc, logger, log_prefix)
    return {"type": "error", "message": message}


async def sse_from_registry(
    job_id: UUID,
    registry: JobRegistry,
) -> AsyncGenerator[str, None]:
    """Drain a job's event queue as SSE-formatted frames.

    Parameters
    ----------
    job_id : UUID
        Job-id registered by the import-stream POST endpoint.
    registry : JobRegistry
        The shared in-process job registry.

    Yields
    ------
    str
        SSE frames ``data: <json>\\n\\n``.
    """
    async for event in registry.stream(job_id):
        yield f"data: {json.dumps(event)}\n\n"


def dov_sse_stream_response(job_id: UUID, registry: JobRegistry) -> StreamingResponse:
    """Build the SSE ``StreamingResponse`` for a registered import job.

    Wraps the 404 guard + response construction shared by the CPT and
    borehole ``GET /import-dov/stream/{job_id}`` endpoints.

    Parameters
    ----------
    job_id : UUID
        Job-id returned by the matching POST endpoint.
    registry : JobRegistry
        In-process job registry.

    Returns
    -------
    StreamingResponse
        ``Content-Type: text/event-stream`` with proxy-buffering off.

    Raises
    ------
    fastapi.HTTPException
        Status 404 when no job with that id is registered (already
        finished and cleaned up, or never existed).
    """
    if job_id not in registry._jobs:  # noqa: SLF001 — registry is a plain dict wrapper
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active import job with id {job_id}",
        )
    return StreamingResponse(
        sse_from_registry(job_id, registry),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
