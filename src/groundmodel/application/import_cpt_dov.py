"""Use case: import CPTs from DOV within a WGS84 bounding box."""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Callable
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov_result import ImportCptDovResult
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import DovClient, WfsIndexEntry
from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_http import make_dov_async_client
from groundmodel.shared.config import settings
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.progress import ProgressCallback, fire_progress
from groundmodel.shared.timing import ms_since

# Callback fired with the full WFS index immediately after discovery, before any
# XML download starts.  The SSE event generator uses this to emit the structured
# ``{"type": "pins", "items": [...]}`` event to the frontend.
# Errors from this callback are silently suppressed — a broken SSE connection
# must not abort the import (same contract as ProgressCallback).
PinsCallback = Callable[[list[WfsIndexEntry]], object]


async def _fire_pins(cb: PinsCallback | None, index: list[WfsIndexEntry]) -> None:
    """Invoke the pins callback when supplied; await it when async.

    Parameters
    ----------
    cb : PinsCallback | None
        Callback receiving the full WFS index.  ``None`` is a no-op.
    index : list[WfsIndexEntry]
        The WFS index entries to pass to the callback.
    """
    if cb is None:
        return
    try:
        result = cb(index)
        if inspect.isawaitable(result):
            await asyncio.ensure_future(result)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001 — callback errors must not abort the import
        pass


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
        Database session; each CPT is committed individually so a single parse
        failure does not roll back already-imported records.
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
        try:
            async with make_dov_async_client() as http:
                client = DovClient(http, cache=self._cache)

                # Phase 1 — WFS discovery: resolve the full recursive bbox-split.
                # This completes in ~1 s (a few WFS HTTP calls) and lets us emit
                # the "pins" event so the map shows all N pending markers before
                # the heavy download phase starts.
                t_wfs = time.perf_counter()
                index: list[WfsIndexEntry] = await client.fetch_wfs_index(west, south, east, north)
                self.info(
                    f"DOV phase 1 (WFS index): {ms_since(t_wfs)} ms — {len(index)} CPTs discovered"
                )

                # Emit the pins event immediately after WFS resolves — before any
                # XML download starts.  The SSE router wires this callback to push
                # a structured "pins" event so the map renders all N pending markers
                # within ~1 s of the user drawing the bbox.
                await _fire_pins(pins_cb, index)

                if not index:
                    self.info("DOV import: no CPTs found in bbox — nothing to persist")
                    return ImportCptDovResult(imported=0, duplicates=0, failed=0, cpt_ids=[])

                # Phase 2 — download + parse: pass the pre-resolved index so the
                # WFS round-trips are not repeated.
                t_fetch = time.perf_counter()
                parsed = await client.fetch_bbox_processed(
                    west,
                    south,
                    east,
                    north,
                    parser.parse,
                    index=index,
                    progress_cb=progress_cb,
                )
                self.info(
                    f"DOV phase 2 (download + parse): {ms_since(t_fetch)} ms — "
                    f"{len(parsed)} CPTs ready"
                )

        except httpx.HTTPStatusError as exc:
            self.error(
                f"DOV WFS request failed with HTTP {exc.response.status_code}: {exc}  "
                f"response body: {exc.response.text[:300]!r}"
            )
            raise
        except httpx.RequestError as exc:
            self.error(f"DOV network error during WFS/download phase: {type(exc).__name__}: {exc}")
            raise

        total = len(parsed)
        if total == 0:
            self.info("DOV import: no CPTs found in bbox — nothing to persist")
            return ImportCptDovResult(imported=0, duplicates=0, failed=0, cpt_ids=[])

        # Per-CPT failures during download/parse are logged inside DovClient and
        # excluded from `parsed`. We don't have a separate count here without
        # threading it through; absent CPTs vs. expected count is the diff.
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

        self.success(
            f"DOV import done in {ms_since(t_total)} ms: {imported} imported, "
            f"{duplicates} duplicates, {failed} failed  (total={total})"
        )
        return ImportCptDovResult(
            imported=imported,
            duplicates=duplicates,
            failed=failed,
            cpt_ids=cpt_ids,
        )
