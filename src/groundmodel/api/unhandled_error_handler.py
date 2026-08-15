"""500 handler that keeps the CORS headers on, so the renderer can read it.

An exception that escapes a route is turned into a 500 by Starlette's
``ServerErrorMiddleware``, which sits OUTSIDE every middleware added with
``app.add_middleware`` — including ``CORSMiddleware``. The 500 therefore goes
out with no ``Access-Control-Allow-Origin`` header, and the browser refuses to
surface it: the renderer console shows ``net::ERR_FAILED`` plus *"No
'Access-Control-Allow-Origin' header is present"*, which reads like a CORS
misconfiguration and says nothing about the actual server error.

That is exactly how the 2026-08-15 dogfeed report arrived — a body-partition
race (see ``application/body_partition_lock``) surfaced to the owner as a CORS
failure on ``POST .../contact-correlations``. The race is fixed at the source;
this handler fixes the REPORTING, so the next unexpected backend error is
legible in the console instead of being disguised.

Nothing is swallowed: the exception is logged with its traceback and the status
stays 500. Only the headers and a JSON body are added.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.responses import Response

from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


def make_unhandled_error_handler(
    *,
    allowed_origins: list[str],
    allowed_origin_regex: str,
) -> Callable[[Request, Exception], Awaitable[Response]]:
    """Build the 500 handler, pinned to the same origins ``CORSMiddleware`` allows.

    The allow-list is passed in rather than re-declared so the handler can never
    drift into echoing an origin the real CORS policy rejects — the pinning in
    ``api/main.py`` is a deliberate defence against other browser tabs reading
    the loopback API, and a permissive error path would undo it.

    Parameters
    ----------
    allowed_origins : list[str]
        Exact origins the API accepts (e.g. ``["null"]``).
    allowed_origin_regex : str
        Regex for the remaining accepted origins (the dev renderer's port).

    Returns
    -------
    Callable
        An async Starlette exception handler for ``Exception``.
    """
    origin_pattern = re.compile(allowed_origin_regex)

    async def unhandled_error_handler(request: Request, exc: Exception) -> Response:
        """Log the escaped exception and answer 500 with CORS headers intact.

        Parameters
        ----------
        request : Request
            The request whose handler raised.
        exc : Exception
            The exception that escaped the route.

        Returns
        -------
        Response
            A 500 JSON response carrying the CORS headers when the request's
            ``Origin`` is one this API accepts.
        """
        logger.exception(
            f"Unhandled error on {request.method} {request.url.path}: {type(exc).__name__}: {exc}"
        )
        response = JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": {
                    "code": "internal_error",
                    "message": (
                        "The server failed to complete this request. The action was "
                        "not applied; see the backend log for the cause."
                    ),
                }
            },
        )
        origin = request.headers.get("origin")
        if origin is not None and (origin in allowed_origins or origin_pattern.fullmatch(origin)):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        return response

    return unhandled_error_handler
