"""Use case: import CPTs from DOV within a WGS84 bounding box."""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.dov_wfs_fetch import fetch_wfs_or_raise
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov_result import ImportCptDovResult
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import DovClient, WfsIndexEntry
from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.crs_bounds_constants import (
    COORDINATES_OUTSIDE_CRS_BOUNDS_CODE,
)
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_MAX_IMPORT_FEATURES
from groundmodel.infrastructure.parsers.dov.dov_http import make_dov_async_client
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.shared.config import settings
from groundmodel.shared.exceptions import DovImportTooLargeError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.progress import ProgressCallback, fire_progress
from groundmodel.shared.timing import ms_since

# Callback fired with the full WFS index immediately after discovery, before any
# XML download starts.  The SSE event generator uses this to emit the structured
# ``{"type": "pins", "items": [...]}`` event to the frontend.
# Errors from this callback are silently suppressed — a broken SSE connection
# must not abort the import (same contract as ProgressCallback).
PinsCallback = Callable[[list[WfsIndexEntry]], object]


async def _fire_pins(
    cb: PinsCallback | None,
    index: list[WfsIndexEntry],
    logger: GroundModelLogger,
) -> None:
    """Invoke the pins callback when supplied; await it when async.

    Callback errors are logged as warnings but do not abort the import —
    a broken SSE connection (the most common cause) must not roll back
    the download phase that follows.

    Parameters
    ----------
    cb : PinsCallback | None
        Callback receiving the full WFS index.  ``None`` is a no-op.
    index : list[WfsIndexEntry]
        The WFS index entries to pass to the callback.
    logger : GroundModelLogger
        Logger of the owning use-case instance, used to surface callback
        failures without silently swallowing them.
    """
    if cb is None:
        return
    try:
        result = cb(index)
        if inspect.isawaitable(result):
            await asyncio.ensure_future(result)  # type: ignore[arg-type]
    except Exception as exc:  # noqa: BLE001 — callback errors must not abort the import
        logger.warning(
            f"pins callback raised (SSE connection may be broken) — import continues: "
            f"{type(exc).__name__}: {exc}"
        )


class ImportCptDov(GroundModelLogger):
    """Use case: query DOV WFS for a bbox, download CPT XMLs, and persist them.

    Reuses ImportCpt.persist() so all validation, duplicate detection, and ORM
    mapping logic is shared with the GEF import path.

    The import runs in two explicit phases:

    1. **WFS index phase** — ``fetch_wfs_index`` resolves the full recursive
       bbox-split and returns a list of ``WfsIndexEntry`` objects.  The caller
       (or the SSE generator in the router) emits a ``"pins"`` event here so
       the map can render all N pending markers immediately, before any XML is
       downloaded.

    2. **Download + parse + persist phase** — ``fetch_bbox_processed`` takes
       the pre-resolved index so the WFS round-trips are not repeated.

    Parameters
    ----------
    session : AsyncSession
        Database session. All parsed CPTs are staged without committing during
        the persist loop and flushed in a single ``session.commit()`` at the
        final phase — the deliberate atomic-import contract: a per-CPT parse or
        persist failure rolls the whole batch back rather than leaving a
        partially-imported project (see docs/parsers-dov.md).
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session
        self._import = ImportCpt(session)
        self._repo = CptRepository(session)
        # Persistent on-disk XML cache shared across imports — DOV measurement data
        # is historical so cached entries are valid forever. Path comes from
        # settings (overridable via DOV_CACHE_DIR env var). Constructed once per
        # use case rather than per request so directory creation only logs once.
        self._cache = DovXmlCache(
            settings.dov_cache_dir,
            max_bytes=settings.dov_cache_max_bytes or None,
        )

    async def execute(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        app_project_id: UUID | None = None,
        progress_cb: ProgressCallback | None = None,
        pins_cb: PinsCallback | None = None,
        pool: ProcessPoolExecutor | None = None,
    ) -> ImportCptDovResult:
        """Fetch and persist all CPTs within the WGS84 bounding box.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        app_project_id : UUID | None
            Project scope for storage and duplicate detection.
        progress_cb : ProgressCallback | None
            Optional callback fired at each phase boundary and periodically
            during the download phase.  Signature: ``(phase, done, total)``.
            May be synchronous or async.  Omit to preserve the original
            no-progress behaviour; all existing callers are unaffected.
        pins_cb : PinsCallback | None
            Optional callback fired with the full ``list[WfsIndexEntry]``
            immediately after WFS discovery, before any XML download starts.
            The SSE event generator wires this to emit a structured
            ``{"type": "pins", "items": [...]}`` event to the frontend so the
            map can render all N pending markers in one shot (~1 s after the
            user draws the bbox).  Errors from this callback are silently
            suppressed so a broken SSE connection cannot abort the import.
        pool : ProcessPoolExecutor | None
            Optional process pool for offloading CPU-bound XML parsing.
            When supplied, XMLs that exceed ``PARSE_OFFLOAD_MIN_BYTES`` are
            parsed in a child process so the asyncio event loop is not blocked
            during the download phase.  Pass ``None`` (default) to keep the
            original single-process behaviour; all existing callers are
            unaffected.

        Returns
        -------
        ImportCptDovResult
            Summary of imported, duplicate, and failed counts plus CPT IDs.
        """
        self.info(
            f"DOV import started: bbox W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"project_id={app_project_id}"
        )

        t_total = time.perf_counter()

        parser = DovParser()
        # One rate-limit state per import: a 429 during WFS discovery halves the
        # download parallelism for the rest of THIS import (see DovRateLimitState).
        backoff = DovRateLimitState()
        async with make_dov_async_client() as http:
            client = DovClient(http, cache=self._cache, backoff=backoff)

            # Phase 1 — WFS discovery: resolve the full recursive bbox-split.
            # This completes in ~1 s (a few WFS HTTP calls) and lets us emit
            # the "pins" event so the map shows all N pending markers before
            # the heavy download phase starts.
            t_wfs = time.perf_counter()
            index: list[WfsIndexEntry] = await fetch_wfs_or_raise(
                client.fetch_wfs_index(west, south, east, north),
                label="CPT",
                logger=self,
            )
            self.info(
                f"DOV phase 1 (WFS index): {ms_since(t_wfs)} ms — {len(index)} CPTs discovered"
            )

            # Discovery ceiling — refuse a runaway import BEFORE the download phase
            # fans out to thousands of parallel XML GETs. The bbox area guard on the
            # request schema stops continent-sized boxes; this second line stops a
            # genuinely dense area under the size limit. Raised before pins so a
            # too-large import never even paints pending markers.
            if len(index) > DOV_MAX_IMPORT_FEATURES:
                raise DovImportTooLargeError(len(index), DOV_MAX_IMPORT_FEATURES)

            # Emit the pins event immediately after WFS resolves — before any
            # XML download starts.  The SSE router wires this callback to push
            # a structured "pins" event so the map renders all N pending markers
            # within ~1 s of the user drawing the bbox.
            await _fire_pins(pins_cb, index, self)

            if not index:
                self.info("DOV import: no CPTs found in bbox — nothing to persist")
                return ImportCptDovResult(imported=0, duplicates=0, failed=0, cpt_ids=[])

            # Phase 2 — download + parse: pass the pre-resolved index so the
            # WFS round-trips are not repeated. The pool (if supplied) offloads
            # large XML parsing to child processes so the event loop stays free
            # for concurrent downloads.
            t_fetch = time.perf_counter()
            parsed = await fetch_wfs_or_raise(
                client.fetch_bbox_processed(
                    west,
                    south,
                    east,
                    north,
                    parser.parse,
                    index=index,
                    progress_cb=progress_cb,
                    pool=pool,
                ),
                label="CPT",
                logger=self,
            )
            self.info(
                f"DOV phase 2 (download + parse): {ms_since(t_fetch)} ms — {len(parsed)} CPTs ready"
            )

        total = len(parsed)
        # Count conservation: CPTs lost during download/parse are the gap
        # between the WFS index size and the successfully-parsed count.
        # Each individual failure already has a per-item ERROR line from DovClient.
        download_failed = len(index) - total
        if download_failed > 0:
            self.warning(
                f"DOV import: {download_failed} CPT(s) lost during download/parse "
                f"({total} of {len(index)} survived) — "
                f"per-item ERROR lines above carry the cause"
            )
        if total == 0:
            if download_failed > 0:
                self.info(
                    f"DOV import: 0 CPTs survived download/parse "
                    f"({download_failed} of {len(index)} lost) — nothing to persist"
                )
            else:
                self.info("DOV import: no CPTs found in bbox — nothing to persist")
            return ImportCptDovResult(imported=0, duplicates=0, failed=download_failed, cpt_ids=[])

        # Per-CPT failures during download/parse are captured in download_failed above.
        for name, result in parsed:
            if result.has_errors:
                self.warning(
                    f"DOV import: '{name}' parsed with errors — "
                    + ", ".join(f"{iss.code}: {iss.message}" for iss in result.issues)
                )

        # Phase 3 — batch dedup: one IN-query for all incoming test_ids.
        # All DOV CPTs share project_id="DOV"; gather every test_id and lookup once.
        t_dedup = time.perf_counter()
        test_ids = [r.header.test_id for _, r in parsed if r.header.test_id]
        existing = (
            await self._repo.find_existing_test_ids("DOV", test_ids, app_project_id)
            if test_ids
            else {}
        )
        self.info(
            f"DOV phase 3 (dedup query): {ms_since(t_dedup)} ms — "
            f"{len(existing)} of {len(test_ids)} already in project"
        )
        await fire_progress(progress_cb, "dedup", len(existing), total)

        # Phase-summary INFO: how many parsed CPTs carry coordinates outside
        # their declared CRS's area (a swapped X/Y or a foreign position). The
        # per-test detail is the WARNING the parser already attached to each
        # result; this is the "did this batch have any" the reader scans for.
        flagged = sum(
            1
            for _, result in parsed
            if any(iss.code == COORDINATES_OUTSIDE_CRS_BOUNDS_CODE for iss in result.issues)
        )
        if flagged:
            self.info(
                f"DOV import: {flagged}/{len(parsed)} CPT(s) have coordinates outside "
                "their declared CRS area"
            )

        # Phase 4 — persist non-duplicates without committing per-CPT.
        t_persist = time.perf_counter()
        imported = 0
        duplicates = 0
        failed = 0
        cpt_ids: list[UUID] = []

        for i, (name, result) in enumerate(parsed, 1):
            existing_id = existing.get(result.header.test_id)
            if existing_id is not None:
                duplicates += 1
                cpt_ids.append(existing_id)
                self.debug(
                    f"DOV import [{i}/{len(parsed)}]: '{name}' already exists ({existing_id})"
                )
            else:
                try:
                    res = await self._import.persist(
                        result,
                        name,
                        app_project_id,
                        commit=False,
                        skip_duplicate_check=True,
                    )
                    imported += 1
                    cpt_ids.append(res.cpt_id)
                    self.debug(f"DOV import [{i}/{len(parsed)}]: '{name}' → {res.cpt_id}")
                except Exception as exc:
                    failed += 1
                    self.error(
                        f"DOV import [{i}/{len(parsed)}]: persist failed for '{name}': "
                        f"{type(exc).__name__}: {exc}"
                    )
            await fire_progress(progress_cb, "persist", i, total)

        self.info(f"DOV phase 4 (persist {imported} CPTs, no commit): {ms_since(t_persist)} ms")

        # Phase 5 — single commit flushes all queued INSERTs in one shot.
        # The "commit" phase event fires AFTER the commit so the UI knows
        # the data is durable — this is intentionally indeterminate from
        # the frontend perspective (done==total==imported, but the phase
        # label is what matters: "saving…").
        if imported > 0:
            t_commit = time.perf_counter()
            await self._session.commit()
            self.info(f"DOV phase 5 (commit batch of {imported} CPTs): {ms_since(t_commit)} ms")
        await fire_progress(progress_cb, "commit", imported, imported)

        total_failed = failed + download_failed
        self.success(
            f"DOV import done in {ms_since(t_total)} ms: {imported} imported, "
            f"{duplicates} duplicates, {total_failed} failed "
            f"({download_failed} download/parse + {failed} persist)  "
            f"(total={len(index)})"
        )
        return ImportCptDovResult(
            imported=imported,
            duplicates=duplicates,
            failed=total_failed,
            cpt_ids=cpt_ids,
        )
