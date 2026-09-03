"""Retry + rate-limit handling for DOV HTTP requests.

DOV's GeoServer answers a per-IP rate limit with ``429 Too Many Requests`` and a
restart / overload with ``503 Service Unavailable``. Before this module either
was a hard failure: a recursive bbox split that fires hundreds of ``resultType=
hits`` requests in a burst could trip the 429 and abort an otherwise-fine import.

Two mechanisms live here:

* :func:`dov_get_with_retry` — a thin wrapper around ``httpx.AsyncClient.get``
  that, on a retryable status (:data:`DOV_RETRY_STATUS_CODES`), honours the
  ``Retry-After`` header and otherwise falls back to a bounded exponential
  back-off, for up to :data:`DOV_MAX_HTTP_ATTEMPTS` attempts. A non-retryable
  response (2xx or a genuine error) is returned unchanged on the first attempt,
  so the caller's existing success / ``raise_for_status`` handling is untouched.
* :class:`DovRateLimitState` — a small mutable object threaded through one
  import. The first time a 429 is seen it halves the download parallelism for
  the rest of that import (a one-time reduction), so a throttled import backs
  off its own concurrency instead of hammering DOV into more 429s.

Constants live in ``dov_common.py`` per the project's "constants in a dedicated
file" convention.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_DOWNLOAD_PARALLELISM,
    DOV_MAX_HTTP_ATTEMPTS,
    DOV_RETRY_BASE_DELAY_S,
    DOV_RETRY_MAX_DELAY_S,
    DOV_RETRY_STATUS_CODES,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Sleep seam so tests can drive the back-off schedule without wall-clock waits.
SleepFn = Callable[[float], Awaitable[None]]


@dataclass
class DovRateLimitState:
    """Per-import rate-limit bookkeeping — halves parallelism once on a 429.

    One instance is created per DOV import and threaded through the WFS request
    layer and the parallel download helper. It is intentionally mutable and
    single-event-loop (asyncio, no locking).

    Attributes
    ----------
    parallelism : int
        The download concurrency to use. Starts at
        :data:`DOV_DOWNLOAD_PARALLELISM`; halved once the first time a 429 is
        observed (floored at 1).
    throttled : bool
        Whether a 429 has been seen this import — guards the one-time halving.
    """

    parallelism: int = DOV_DOWNLOAD_PARALLELISM
    throttled: bool = False

    def note_throttle(self, logger: GroundModelLogger) -> None:
        """Record that DOV rate-limited us and halve parallelism (once).

        Idempotent after the first call: parallelism is a one-time reduction so
        a burst of 429s does not spiral concurrency down to nothing.

        Parameters
        ----------
        logger : GroundModelLogger
            Caller's logger, so the WARNING is attributed to the calling module.
        """
        if self.throttled:
            return
        self.throttled = True
        reduced = max(1, self.parallelism // 2)
        logger.warning(
            f"DOV rate-limited this import (HTTP 429) — halving download "
            f"parallelism {self.parallelism} -> {reduced} for the rest of the import"
        )
        self.parallelism = reduced


def _parse_retry_after(value: str | None) -> float | None:
    """Return the ``Retry-After`` delay in seconds, or ``None`` if not a number.

    Only the integer-seconds form is parsed; the HTTP-date form falls back to
    ``None`` (the exponential back-off takes over) rather than pulling in a date
    parser for a header DOV sends as seconds in practice.
    """
    if value is None:
        return None
    value = value.strip()
    try:
        return float(int(value))
    except ValueError:
        return None


def _retry_delay(resp: httpx.Response, attempt: int) -> float:
    """Compute the wait before the next attempt, honouring ``Retry-After``.

    ``Retry-After`` (when a plain number) wins; otherwise an exponential
    schedule ``base * 2**(attempt-1)`` is used. Either way the result is capped
    at :data:`DOV_RETRY_MAX_DELAY_S` so a hostile / mis-set header cannot freeze
    the import.
    """
    retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
    if retry_after is not None:
        return min(max(retry_after, 0.0), DOV_RETRY_MAX_DELAY_S)
    # 2.0 (not 2) keeps this a float: ``int ** int`` is typed Any by mypy because a
    # negative exponent would return a float; a float base makes the type concrete.
    exponential = DOV_RETRY_BASE_DELAY_S * (2.0 ** (attempt - 1))
    return min(exponential, DOV_RETRY_MAX_DELAY_S)


async def dov_get_with_retry(
    http: httpx.AsyncClient,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    logger: GroundModelLogger,
    label: str,
    backoff: DovRateLimitState | None = None,
    sleep: SleepFn = asyncio.sleep,
) -> httpx.Response:
    """GET *url*, retrying on DOV throttling (429/503) with a bounded back-off.

    A response whose status is NOT in :data:`DOV_RETRY_STATUS_CODES` is returned
    on the first attempt untouched — the caller keeps ownership of success and
    error handling. A 429/503 is retried up to :data:`DOV_MAX_HTTP_ATTEMPTS`
    times, waiting :func:`_retry_delay` between attempts; when all attempts are
    exhausted the last (still-throttled) response is returned so the caller's
    existing non-2xx handling raises with full context.

    Network errors (``httpx.RequestError``) are NOT retried here — they
    propagate to the caller unchanged, preserving the existing error mapping.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async client.
    url : str
        Absolute URL to GET.
    params : dict[str, Any] | None
        Query parameters. When ``None`` the call omits ``params`` entirely so
        test doubles with a bare ``get(url)`` signature keep working.
    logger : GroundModelLogger
        Caller's logger for the throttle / give-up WARNINGs.
    label : str
        Short log prefix (e.g. ``"sonderingen"``, ``"DOV"``).
    backoff : DovRateLimitState | None
        Optional shared rate-limit state; on a 429 its parallelism is halved
        once. ``None`` disables the concurrency reduction (retry still happens).
    sleep : SleepFn
        Awaitable sleep, injectable for tests. Defaults to ``asyncio.sleep``.

    Returns
    -------
    httpx.Response
        The first non-retryable response, or the last throttled response after
        the attempts are exhausted.
    """
    attempt = 0
    while True:
        attempt += 1
        resp = await http.get(url, params=params) if params is not None else await http.get(url)
        if resp.status_code not in DOV_RETRY_STATUS_CODES:
            return resp

        # Throttled. A 429 (rate limit) also trims this import's concurrency.
        if resp.status_code == 429 and backoff is not None:
            backoff.note_throttle(logger)

        if attempt >= DOV_MAX_HTTP_ATTEMPTS:
            logger.warning(
                f"{label}: DOV returned HTTP {resp.status_code} on all "
                f"{attempt} attempts — giving up retry, surfacing the error"
            )
            return resp

        delay = _retry_delay(resp, attempt)
        logger.warning(
            f"{label}: DOV returned HTTP {resp.status_code} "
            f"(attempt {attempt}/{DOV_MAX_HTTP_ATTEMPTS}) — retrying in {delay:.1f}s"
        )
        await sleep(delay)
