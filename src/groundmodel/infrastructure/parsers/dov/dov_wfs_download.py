"""Shared async helper for DOV WFS parallel-download + cache + process.

Three of the five DOV WFS clients (`DovBoreholeClient`,
`DovInterpretationClient`, `DovGrainSizeClient`) follow the same Phase 2
pattern after the WFS bbox-collect finishes:

1. Decide how many parallel downloads (``DOV_DOWNLOAD_PARALLELISM`` slots
   on a single ``asyncio.Semaphore``).
2. For each row: cache lookup first, then bounded HTTP download, then
   inline ``process(row, xml_bytes)`` so parse work overlaps the freed
   slot starting the next download. Cache-misses are written through.
3. Collect ``(row, result)`` pairs, drop rows that raised, log per-row
   failures with a row-specific identity blurb.
4. Emit a hit/miss summary when a cache is configured.

Before this helper the three clients carried 50-line copies of step 2 +
a near-identical 30-line shell around it. The label string ("DOV" /
"DOV interpretation" / "DOV grain-size") was the only meaningful
difference — every change to the cache check, semaphore acquire,
progress reporting, or error wording had to be patched three times. The
last time it bit was the "stream-parse" optimisation (process runs
inside the task, outside the semaphore) — landed correctly in the
boring client and copied to the other two days later.

What this helper does NOT do
----------------------------
* Build the WFS row list — the caller already has it (typed differently
  per client). Pass rows in.
* Decide the cache directory — the caller passes a ``DovXmlCache`` that
  it constructed with the right ``boring/`` / ``interpretatie/`` /
  ``observatie/`` subdirectory so permkeys don't collide across DOV
  resource types.
* Know per-row error context — caller supplies ``error_id_of`` which
  returns the human-readable identity bit ("'2024-001234' (borehole
  '12345')") that lands in the per-row error log.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Sequence
from concurrent.futures import BrokenExecutor
from typing import TypeVar

import httpx

from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_DOWNLOAD_PARALLELISM
from groundmodel.infrastructure.parsers.dov.dov_http_retry import (
    DovRateLimitState,
    dov_get_with_retry,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.progress import ProgressCallback, fire_progress
from groundmodel.shared.timing import ms_since

RowT = TypeVar("RowT")
ResultT = TypeVar("ResultT")

XmlUrlFn = Callable[[RowT], str]
PermkeyFn = Callable[[RowT], str]
ProcessFn = Callable[[RowT, bytes], ResultT]
ProcessAsyncFn = Callable[[RowT, bytes], Awaitable[ResultT]]
ErrorIdFn = Callable[[RowT], str]


def classify_download_failure(exc: BaseException) -> str:
    """Categorise a per-row download/parse failure for the operator log.

    The three categories map to three different fixes: a network/HTTP
    failure means DOV was slow or unreachable (retry / check the endpoint);
    a broken parse-pool means a worker process crashed (an OOM or a native
    parser fault — reduce parallelism / investigate the offending XML); an
    XML parse/processing failure means the document itself was malformed
    (a parser bug or an upstream schema drift).

    Parameters
    ----------
    exc : BaseException
        The exception captured by ``asyncio.gather(return_exceptions=True)``.

    Returns
    -------
    str
        A short human-readable failure-class label for the log line.
    """
    if isinstance(exc, httpx.HTTPStatusError | httpx.RequestError):
        return "network/HTTP download failed"
    if isinstance(exc, BrokenExecutor):
        return "parse-pool worker crashed"
    return "XML parse/processing failed"


async def parallel_download_and_process(
    *,
    http: httpx.AsyncClient,
    cache: DovXmlCache | None,
    rows: Sequence[RowT],
    xml_url_of: XmlUrlFn[RowT],
    permkey_of: PermkeyFn[RowT],
    process: ProcessFn[RowT, ResultT] | None = None,
    process_async: ProcessAsyncFn[RowT, ResultT] | None = None,
    label: str,
    logger: GroundModelLogger,
    parallelism: int = DOV_DOWNLOAD_PARALLELISM,
    error_id_of: ErrorIdFn[RowT] | None = None,
    progress_cb: ProgressCallback | None = None,
    backoff: DovRateLimitState | None = None,
) -> list[tuple[RowT, ResultT]]:
    """Download every row's XML in parallel, run ``process`` on each.

    Cache lookup happens BEFORE the semaphore acquire — file reads are
    ~0.1 ms and cheaper than queueing on a contended import. On miss the
    fresh bytes are written through to the cache so the next import
    skips the round-trip. Process runs OUTSIDE the semaphore so parse
    blocks the event loop briefly while the freed slot starts the next
    download.

    Parameters
    ----------
    http
        Shared async HTTP client (HTTP/2 multiplexed by the DOV factory,
        ``follow_redirects=True`` for the rare proxy-prefix-mismatch
        fallback).
    cache
        Optional persistent cache for per-resource XMLs. Pass a cache
        rooted under the resource's subdirectory (e.g. ``boring/``,
        ``interpretatie/``, ``observatie/``) so permkeys never collide
        across DOV resource types.
    rows
        WFS rows to download. Empty input returns ``[]`` with no logs.
    xml_url_of
        Pure callable ``(row) -> str`` returning the XML URL to fetch.
    permkey_of
        Pure callable ``(row) -> str`` returning the cache key (DOV's
        ``YYYY-NNNNNN`` permkey for every resource type).
    process
        Callable ``(row, xml_bytes) -> result``. Invoked synchronously
        inside the download task so parse work overlaps the next
        download's semaphore acquire. Exactly one of ``process`` /
        ``process_async`` must be supplied.
    process_async
        Awaitable variant ``(row, xml_bytes) -> result`` for callers
        that offload parsing (e.g. the CPT client's process-pool
        offload for oversized XMLs). Runs outside the semaphore like
        ``process``.
    label
        Short log prefix (e.g. ``"DOV"``, ``"DOV interpretation"``,
        ``"DOV grain-size"``) so log scopes stay greppable across
        clients running in the same import.
    logger
        Caller's ``GroundModelLogger``. Lets log lines retain the
        calling module's name rather than this helper's.
    parallelism
        Maximum concurrent downloads. Defaults to
        ``DOV_DOWNLOAD_PARALLELISM`` (50 — DOV's per-IP throughput
        sweet spot).
    error_id_of
        Optional ``(row) -> str`` returning the row-specific identity
        blurb for per-row error logs. Defaults to the row's permkey
        when omitted; callers with richer context (parent IDs,
        observation type) supply their own.
    progress_cb
        Optional progress callback.  Receives ``("download", done, total)``
        every ``progress_step`` items.  Default ``None`` preserves the
        original no-callback behaviour for all callers that don't opt in.
    backoff
        Optional per-import rate-limit state. Threaded into each XML GET so a
        429/503 is retried (``Retry-After`` honoured) rather than failing the
        row, and a 429 halves the import's parallelism once. ``None`` disables
        both (retry still applies to plain non-2xx via the caller's handling).

    Returns
    -------
    list[tuple[RowT, ResultT]]
        ``(row, process_result)`` pairs — one per row that downloaded
        successfully and survived ``process()``. Per-row failures are
        logged at ERROR with full context and dropped from the result.
    """
    if (process is None) == (process_async is None):
        raise ValueError("supply exactly one of process / process_async")

    total = len(rows)
    if total == 0:
        return []

    cache_state = "with cache" if cache is not None else "no cache"
    logger.info(
        f"{label}: streaming download+process of {total} XMLs "
        f"(max {parallelism} parallel, {cache_state})"
    )
    sem = asyncio.Semaphore(parallelism)
    # Mutable counter shared across tasks — asyncio is single-threaded so
    # increments are atomic without a lock.
    progress = {"done": 0, "hits": 0}
    progress_step = max(50, total // 5)

    tasks: list[Awaitable[ResultT]] = [
        _download_one(
            row=row,
            http=http,
            cache=cache,
            xml_url_of=xml_url_of,
            permkey_of=permkey_of,
            process=process,
            process_async=process_async,
            sem=sem,
            label=label,
            logger=logger,
            progress=progress,
            total=total,
            progress_step=progress_step,
            error_id_of=error_id_of,
            progress_cb=progress_cb,
            backoff=backoff,
        )
        for row in rows
    ]
    raw = await asyncio.gather(*tasks, return_exceptions=True)

    out: list[tuple[RowT, ResultT]] = []
    for row, result in zip(rows, raw, strict=True):
        if isinstance(result, BaseException):
            ident = (error_id_of or permkey_of)(row)
            logger.error(
                f"{label}: {classify_download_failure(result)} for {ident}  "
                f"url={xml_url_of(row)}  "
                f"error={type(result).__name__}: {result}"
            )
        else:
            out.append((row, result))

    if cache is not None and progress["done"]:
        hits = progress["hits"]
        misses = progress["done"] - hits
        pct = hits * 100 // progress["done"]
        logger.info(f"{label} cache: {hits} hits, {misses} misses ({pct}% hit rate)")
    return out


async def _download_one(
    *,
    row: RowT,
    http: httpx.AsyncClient,
    cache: DovXmlCache | None,
    xml_url_of: XmlUrlFn[RowT],
    permkey_of: PermkeyFn[RowT],
    process: ProcessFn[RowT, ResultT] | None,
    process_async: ProcessAsyncFn[RowT, ResultT] | None,
    sem: asyncio.Semaphore,
    label: str,
    logger: GroundModelLogger,
    progress: dict[str, int],
    total: int,
    progress_step: int,
    error_id_of: ErrorIdFn[RowT] | None,
    progress_cb: ProgressCallback | None = None,
    backoff: DovRateLimitState | None = None,
) -> ResultT:
    """Cache check → semaphore-bounded HTTP → write-through → process.

    Lives at module level (not nested in ``parallel_download_and_process``)
    so each task closes over only its own arguments; nesting would have
    every task carry the outer function's frame on its event-loop stack.

    A cache hit that fails to ``process`` is treated as a poisoned entry: the
    cache file is invalidated and the download retried ONCE from the network,
    so a bit-rotted cached XML self-heals instead of failing every import. A
    FRESH (network) parse failure is a genuine bad XML and is not retried — it
    propagates so the row is dropped with a per-row error. The XML GET itself
    rides out a 429/503 via :func:`dov_get_with_retry`.

    Parameters
    ----------
    row : RowT
        WFS row descriptor for this download.
    http : httpx.AsyncClient
        Shared HTTP client.
    cache : DovXmlCache | None
        Optional XML cache.
    xml_url_of : XmlUrlFn[RowT]
        Extracts the download URL from a row.
    permkey_of : PermkeyFn[RowT]
        Extracts the cache key from a row.
    process : ProcessFn[RowT, ResultT] | None
        Invoked synchronously inside the task after download.
    process_async : ProcessAsyncFn[RowT, ResultT] | None
        Awaited variant; exactly one of the two is non-None (validated
        by the caller).
    sem : asyncio.Semaphore
        Bounded concurrency slot.
    label : str
        Log prefix.
    logger : GroundModelLogger
        Caller's logger.
    progress : dict[str, int]
        Shared mutable counter ``{"done": int, "hits": int}``.
    total : int
        Total rows in this batch.
    progress_step : int
        Fire log + callback every this many completions.
    error_id_of : ErrorIdFn[RowT] | None
        Optional row identity blurb for error messages.
    progress_cb : ProgressCallback | None
        Optional callback fired on each logging tick.
    backoff : DovRateLimitState | None
        Optional per-import rate-limit state forwarded to the XML GET.
    """
    xml_url = xml_url_of(row)
    permkey = permkey_of(row)
    ident = (error_id_of or permkey_of)(row)

    async def _fetch_over_network() -> bytes:
        """Semaphore-bounded GET (with 429/503 retry) + write-through to cache."""
        t0 = time.perf_counter()
        async with sem:
            try:
                resp = await dov_get_with_retry(
                    http, xml_url, logger=logger, label=label, backoff=backoff
                )
            except httpx.RequestError as exc:
                logger.error(f"{label}: network error fetching {ident} ({xml_url}): {exc}")
                raise
            if not resp.is_success:
                logger.error(
                    f"{label}: HTTP {resp.status_code} for {ident}  "
                    f"url={xml_url}  body={resp.text[:200]!r}"
                )
                resp.raise_for_status()
            fetched = resp.content
        # Per-item download size + latency — payload size is the dominant DOV
        # import cost (a typical CPT export decodes to ~0.5 MB; see
        # CLAUDE.local.md), and size + latency together point straight at a slow
        # oversized record. The timer spans the semaphore wait too, so it is the
        # total "how long did this item take" signal. TRACE (per-byte/per-row).
        logger.trace(f"{label}: fetched {ident} — {len(fetched)}B {ms_since(t0)}ms url={xml_url}")
        if cache is not None:
            cache.put(permkey, fetched)
        return fetched

    async def _run_process(payload: bytes) -> ResultT:
        # Process runs outside the semaphore — parse blocks the event loop
        # briefly while the freed slot starts the next download (the async
        # variant may instead await a parse-pool worker, freeing the loop).
        if process_async is not None:
            return await process_async(row, payload)
        assert process is not None  # caller validated exactly-one-of
        return process(row, payload)

    xml_bytes: bytes | None = None
    from_cache = False
    if cache is not None:
        xml_bytes = cache.get(permkey)
        from_cache = xml_bytes is not None
    if xml_bytes is None:
        xml_bytes = await _fetch_over_network()

    try:
        result = await _run_process(xml_bytes)
    except Exception:
        # A FRESH parse failure is a genuine bad XML — propagate so the row is
        # dropped with a per-row error. Only a CACHED parse failure is retried:
        # the on-disk bytes may have rotted (a flipped bit, a truncated write)
        # while the upstream XML is fine, so invalidate and re-fetch ONCE.
        if not (from_cache and cache is not None):
            raise
        logger.warning(
            f"{label}: cached XML for {ident} failed to parse — invalidating the "
            f"cache entry and re-fetching once from network"
        )
        cache.delete(permkey)
        xml_bytes = await _fetch_over_network()
        from_cache = False  # a network miss now, for hit/miss accounting
        # A second failure propagates → the row is dropped (no retry loop).
        result = await _run_process(xml_bytes)

    progress["done"] += 1
    if from_cache:
        progress["hits"] += 1
    if progress["done"] % progress_step == 0 or progress["done"] == total:
        logger.info(f"{label} progress: {progress['done']}/{total} downloaded+parsed")
        await fire_progress(progress_cb, "download", progress["done"], total)
    return result
