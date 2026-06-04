"""Shared wrapper for DOV WFS/download fetches that maps httpx errors to logs.

Every DOV import use case (CPT, borehole, sample, grain-size, interpretation)
wraps its bbox fetch in the identical ``try: await … except
httpx.HTTPStatusError / httpx.RequestError: self.error(…); raise`` block,
varying only by a human-readable phase label. This module centralises that
block so the projection/error wording cannot drift across the import family
(debt #198). The timing + success INFO log stays in each caller — it differs
per phase and is not part of the error contract.
"""

from collections.abc import Awaitable
from typing import TypeVar

import httpx

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

T = TypeVar("T")


async def fetch_wfs_or_raise(coro: Awaitable[T], *, label: str, logger: GroundModelLogger) -> T:
    """Await a DOV WFS/download coroutine, logging then re-raising httpx errors.

    Parameters
    ----------
    coro : Awaitable[T]
        The pending DOV fetch (``fetch_bbox`` / ``fetch_bbox_processed``).
        Pass the *un-awaited* call expression; this helper awaits it once.
    label : str
        Phase label woven into the error log for context, e.g. ``"CPT"``,
        ``"borehole"``, ``"sample"``, ``"grain-size"``, ``"interpretation"``.
    logger : GroundModelLogger
        The calling use case's logger so the emitted line keeps the caller's
        module name (these use cases inherit ``GroundModelLogger`` and pass
        ``self``).

    Returns
    -------
    T
        Whatever the coroutine resolved to (the parsed fetch result).

    Raises
    ------
    httpx.HTTPStatusError
        On a non-2xx WFS/export response, after logging the status + body.
    httpx.RequestError
        On a network-level failure, after logging the error type.
    """
    try:
        return await coro
    except httpx.HTTPStatusError as exc:
        # Log the response body (truncated) so a non-2xx is debuggable from the
        # log alone without re-running — DoD §1 external-call rule.
        logger.error(
            f"DOV {label} WFS request failed with HTTP "
            f"{exc.response.status_code}: {exc}  "
            f"response body: {exc.response.text[:300]!r}"
        )
        raise
    except httpx.RequestError as exc:
        logger.error(
            f"DOV {label} network error during WFS/download phase: {type(exc).__name__}: {exc}"
        )
        raise
