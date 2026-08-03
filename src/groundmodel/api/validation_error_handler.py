"""422 handler that survives a non-finite number in the rejected body.

FastAPI's default ``RequestValidationError`` handler echoes the offending input
back to the client. Starlette renders that echo with ``json.dumps(...,
allow_nan=False)``, so when the input IS a ``NaN`` — which JSON permits on the
way in — rendering the 422 raises, the original validation error escapes the
handler, and the engineer gets a 500 for what the API had already correctly
identified as bad input. The write is refused either way; what is lost is the
answer telling him which field to fix.

This handler scrubs non-finite floats out of the echo (replacing them with their
literal spelling, e.g. ``"NaN"``) and returns the same 422 shape as FastAPI's
default, so clients that read ``detail[].loc`` keep working.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.responses import Response


def json_safe(value: Any) -> Any:
    """Return ``value`` with every non-finite float replaced by its spelling.

    Walks dicts, lists and tuples recursively. ``NaN`` becomes ``"NaN"``,
    ``inf`` becomes ``"Infinity"`` — visible to the reader, and renderable by a
    strict JSON encoder. Everything else is returned untouched (the caller has
    already passed the structure through ``jsonable_encoder`` where needed).

    Parameters
    ----------
    value : Any
        Any JSON-ish structure — typically ``RequestValidationError.errors()``.

    Returns
    -------
    Any
        The same structure with non-finite floats stringified.
    """
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "NaN"
        return "Infinity" if value > 0 else "-Infinity"
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(v) for v in value]
    return value


async def validation_error_handler(_request: Request, exc: Exception) -> Response:
    """Answer 422 with a renderable body, whatever the client sent.

    Parameters
    ----------
    _request : Request
        Unused; required by the FastAPI exception-handler signature.
    exc : Exception
        The ``RequestValidationError`` raised while validating the request.

    Returns
    -------
    Response
        422 with ``{"detail": [...]}`` — the same shape FastAPI produces by
        default, minus the raw ``body`` echo (which can carry the same
        non-finite values and adds nothing the per-field errors do not).
    """
    errors = exc.errors() if isinstance(exc, RequestValidationError) else []
    # ``jsonable_encoder`` first (an error's ``ctx`` can hold a raw exception
    # object), then the non-finite scrub — the encoder leaves NaN a float.
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": json_safe(jsonable_encoder(errors))},
    )
