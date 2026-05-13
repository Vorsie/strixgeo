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
from collections.abc import Awaitable, Callable, Sequence
from typing import TypeVar

import httpx

from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_DOWNLOAD_PARALLELISM
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

RowT = TypeVar("RowT")
ResultT = TypeVar("ResultT")

XmlUrlFn = Callable[[RowT], str]
PermkeyFn = Callable[[RowT], str]
ProcessFn = Callable[[RowT, bytes], ResultT]
ErrorIdFn = Callable[[RowT], str]


async def parallel_download_and_process(
    *,
    http: httpx.AsyncClient,
    cache: DovXmlCache | None,
    rows: Sequence[RowT],
    xml_url_of: XmlUrlFn[RowT],
    permkey_of: PermkeyFn[RowT],
    process: ProcessFn[RowT, ResultT],
    label: str,
    logger: GroundModelLogger,
    parallelism: int = DOV_DOWNLOAD_PARALLELISM,
    error_id_of: ErrorIdFn[RowT] | None = None,
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
        download's semaphore acquire.
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

    Returns
    -------
    list[tuple[RowT, ResultT]]
        ``(row, process_result)`` pairs — one per row that downloaded
        successfully and survived ``process()``. Per-row failures are
        logged at ERROR with full context and dropped from the result.
    """
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
            sem=sem,
            label=label,
            logger=logger,
            progress=progress,
            total=total,
            progress_step=progress_step,
            error_id_of=error_id_of,
        )
        for row in rows
    ]
    raw = await asyncio.gather(*tasks, return_exceptions=True)

    out: list[tuple[RowT, ResultT]] = []
    for row, result in zip(rows, raw, strict=True):
        if isinstance(result, BaseException):
            ident = (error_id_of or permkey_of)(row)
            logger.error(
                f"{label}: download/process failed for {ident}  "
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
    process: ProcessFn[RowT, ResultT],
    sem: asyncio.Semaphore,
    label: str,
    logger: GroundModelLogger,
    progress: dict[str, int],
    total: int,
    progress_step: int,
    error_id_of: ErrorIdFn[RowT] | None,
) -> ResultT:
    """Cache check → semaphore-bounded HTTP → write-through → process.

    Lives at module level (not nested in ``parallel_download_and_process``)
    so each task closes over only its own arguments; nesting would have
    every task carry the outer function's frame on its event-loop stack.
    """
    xml_url = xml_url_of(row)
    permkey = permkey_of(row)
    ident = (error_id_of or permkey_of)(row)

    xml_bytes: bytes | None = None
    from_cache = False

    if cache is not None:
        xml_bytes = cache.get(permkey)
        from_cache = xml_bytes is not None

    if xml_bytes is None:
        async with sem:
            try:
                resp = await http.get(xml_url)
            except httpx.RequestError as exc:
                logger.error(f"{label}: network error fetching {ident} ({xml_url}): {exc}")
                raise
            if not resp.is_success:
                logger.error(
                    f"{label}: HTTP {resp.status_code} for {ident}  "
                    f"url={xml_url}  body={resp.text[:200]!r}"
                )
                resp.raise_for_status()
            xml_bytes = resp.content
        if cache is not None:
            cache.put(permkey, xml_bytes)

    # Process runs outside the semaphore — parse blocks the event loop
    # briefly while the freed slot starts the next download.
    result = process(row, xml_bytes)
    progress["done"] += 1
    if from_cache:
        progress["hits"] += 1
    if progress["done"] % progress_step == 0 or progress["done"] == total:
        logger.info(f"{label} progress: {progress['done']}/{total} downloaded+parsed")
    return result
