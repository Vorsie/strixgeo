"""Async DOV WFS client — fetches CPT metadata and XML files in parallel.

Data sources (verified live 2026-05-07):
  WFS:  https://www.dov.vlaanderen.be/geoserver/ows
        feature type: dov-pub:Sonderingen  (plural — 'soundings')
  XML:  the WFS feature property `fiche` holds a URL like
        https://www.dov.vlaanderen.be/data/sondering/{permkey}
        Appending `.xml` returns a 302 redirect to the proxy at
        https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/{permkey}
        — we hit the proxy directly to skip the redirect.

Constants (URL, namespace, parallelism, regexes, transformer) live in
``dov_constants.py`` per the project's "constants in a dedicated file" convention.

XML cache:
  When a DovXmlCache is passed to the client, every download first checks the
  cache by permkey. Cache hits skip the network entirely. Misses are downloaded
  AND stored in the cache for next time. Because DOV measurement data is
  historical, a cached XML stays valid forever.

Debugging tips:
  - Set log level to TRACE to see every HTTP request, response body, and feature
    property dump from the WFS.
  - On WFS count = 0 when you expect results, check that the bbox Lambert72
    coordinates look plausible for Belgium (X ≈ 20 000–290 000, Y ≈ 150 000–245 000).
  - If XML downloads return 404, the `fiche` URL format may have changed —
    check the property dump from `_wfs_features` at TRACE level.

WFS index split:
  ``fetch_wfs_index(bbox)`` fully resolves the recursive bbox-split before
  returning.  This lets callers emit a ``"pins"`` SSE event immediately (so the
  frontend shows all N investigation locations within ~1 s) and then call
  ``fetch_bbox_processed(index, process, ...)`` for the heavy download phase.
"""

from __future__ import annotations

import asyncio
import gzip
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import TypeVar

import httpx

from groundmodel.infrastructure.parsers.cpt.dov.dov_constants import (
    DOV_DOWNLOAD_PARALLELISM,
    DOV_FICHE_URL_PREFIX,
    DOV_PROXY_URL_PREFIX,
    DOV_WFS_LAYER,
    DOV_WGS84_TO_LAMBERT72,
    PARSE_OFFLOAD_MIN_BYTES,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_parse_worker import parse_cpt_xml
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import is_allowed_dov_url
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_download import (
    parallel_download_and_process,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import last_path_segment
from groundmodel.infrastructure.parsers.dov.dov_wfs_request import (
    wfs_count,
    wfs_features_json,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.progress import ProgressCallback, fire_progress

_T = TypeVar("_T")
ProcessFn = Callable[[bytes, str], _T]

# Internal tuple shape returned by ``_wfs_features`` — one element per WFS feature.
# (xml_url, sondeernummer, x_lambert72, y_lambert72)
# x/y come from X_mL72 / Y_mL72 in the GeoJSON feature properties and are in
# Belgian Lambert 72 (EPSG:31370) — the same CRS as the WFS bbox query.
_WfsFeatureTuple = tuple[str, str, float, float]


@dataclass(frozen=True)
class WfsIndexEntry:
    """One CPT found during WFS discovery — all information available before XML download.

    Attributes
    ----------
    permkey : str
        DOV permkey derived from the ``fiche`` URL's last path segment.
        Used as the XML cache key and as the stable dedup identifier.
    name : str
        Human-readable CPT name (``sondeernummer``, e.g. "GEO-02/079-S3").
    xml_url : str
        Absolute URL of the CPT XML document (proxy URL — no 302 redirect).
    x_lambert72 : float
        Easting in Belgian Lambert 72 (EPSG:31370), metres.
    y_lambert72 : float
        Northing in Belgian Lambert 72 (EPSG:31370), metres.
    """

    permkey: str
    name: str
    xml_url: str
    x_lambert72: float
    y_lambert72: float


class DovClient(GroundModelLogger):
    """Fetch DOV CPT metadata via WFS and download XML files in parallel.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. Caller is responsible for setting
        ``follow_redirects=True`` because the XML endpoint 302-redirects
        to a proxy URL when the proxy-direct shortcut isn't applicable.
    cache : DovXmlCache | None
        Optional persistent cache. When provided, downloads consult the cache
        first and store fresh downloads for next time. None disables caching.
    backoff : DovRateLimitState | None
        Optional per-import rate-limit state. When supplied, WFS discovery and
        the XML download phase both honour it: a 429/503 is retried and a 429
        halves the download parallelism once for the rest of the import. When
        ``None`` the retry still applies (via the shared request helpers) but
        the parallelism is fixed at ``DOV_DOWNLOAD_PARALLELISM``.
    """

    def __init__(
        self,
        http: httpx.AsyncClient,
        cache: DovXmlCache | None = None,
        backoff: DovRateLimitState | None = None,
    ) -> None:
        super().__init__(__name__)
        self._http = http
        self._cache = cache
        self._backoff = backoff

    async def fetch_wfs_index(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
    ) -> list[WfsIndexEntry]:
        """Resolve the full WFS bbox-split and return a typed index of all CPTs found.

        This is Phase 1 of the two-phase import: it runs the recursive bbox
        split + quadrant dedup entirely before any XML is downloaded, so the
        caller can emit a ``"pins"`` SSE event with all investigation locations
        immediately (~1 s after the user draws the bbox) while the heavier
        download phase runs in the background.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.

        Returns
        -------
        list[WfsIndexEntry]
            One entry per unique CPT found in the bbox. Empty when the bbox
            contains no CPTs.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(
            f"DOV fetch_wfs_index: WGS84 W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}"
        )
        self.debug(
            f"DOV bbox Lambert72: x=[{x1:.0f},{x2:.0f}]  y=[{y1:.0f},{y2:.0f}]  "
            f"(valid range: x≈20k–290k, y≈150k–245k)"
        )

        raw_tuples = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            # Dedup by xml_url (first element) so a CPT near a quadrant boundary
            # appearing in multiple sub-bboxes only appears once in the index.
            row_permkey=lambda r: r[0],
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV WFS sonderingen",
            logger=self,
        )

        entries = [
            WfsIndexEntry(
                permkey=last_path_segment(xml_url),
                name=name,
                xml_url=xml_url,
                x_lambert72=x_l72,
                y_lambert72=y_l72,
            )
            for xml_url, name, x_l72, y_l72 in raw_tuples
        ]
        self.info(f"DOV WFS: {len(entries)} unique CPTs found in bbox")
        return entries

    async def fetch_bbox_processed(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        process: ProcessFn[_T],
        *,
        index: list[WfsIndexEntry] | None = None,
        progress_cb: ProgressCallback | None = None,
        pool: ProcessPoolExecutor | None = None,
    ) -> list[tuple[str, _T]]:
        """Download every CPT in the bbox, running *process(xml_bytes, name)* on each.

        Why this exists: parsing 200+ XMLs sequentially after they all downloaded
        was costing 8+ extra seconds. Running process inside each download task
        means parse work happens between async waits — the parse phase wall time
        disappears into the download wait time. Failures from process() are
        caught per-CPT so one bad XML doesn't kill the batch.

        When a cache is configured, cache hits skip the network entirely — the
        bytes go straight from disk into process(). Hit/miss counts are logged.

        When *pool* is supplied, XMLs that exceed ``PARSE_OFFLOAD_MIN_BYTES``
        are parsed in the pool via ``dov_parse_worker.parse_cpt_xml`` instead
        of inline on the event loop, freeing the loop for concurrent downloads.
        The *process* callable is still used for XMLs below the threshold and
        as the fallback when *pool* is ``None``.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        process : ProcessFn[_T]
            Callable invoked as ``process(xml_bytes, name)`` for inline parsing.
        index : list[WfsIndexEntry] | None
            Pre-resolved WFS index from ``fetch_wfs_index()``. When supplied,
            the WFS discovery phase is skipped entirely — useful when the caller
            already called ``fetch_wfs_index`` to emit a ``"pins"`` SSE event.
            When ``None``, this method calls ``fetch_wfs_index`` internally.
        progress_cb : ProgressCallback | None
            Optional progress callback.  Receives ``("wfs", total, total)``
            after WFS discovery and ``("download", done, total)`` periodically
            during the download phase.  Default ``None`` preserves the
            existing no-callback behaviour for all callers that don't opt in.
        pool : ProcessPoolExecutor | None
            Optional process-pool for offloading CPU-bound XML parsing.
            Pass ``None`` (default) to keep the original single-process
            behaviour; existing callers are unaffected.

        Returns
        -------
        list[tuple[str, _T]]
            (sondeernummer, process_result) for every CPT processed successfully.
        """
        if index is None:
            index = await self.fetch_wfs_index(west, south, east, north)

        if not index:
            return []

        total = len(index)
        # Report WFS discovery complete so the UI can show "N CPTs found".
        await fire_progress(progress_cb, "wfs", total, total)
        self.debug(f"DOV: parse offload pool={'on' if pool is not None else 'off'}")

        async def _process_entry(entry: WfsIndexEntry, xml_bytes: bytes) -> _T:
            """Parse one CPT XML — in the pool for oversized payloads, else inline.

            When *pool* is supplied and the payload exceeds
            ``PARSE_OFFLOAD_MIN_BYTES``, the parse is offloaded via
            ``dov_parse_worker.parse_cpt_xml`` (gzip-compressed bytes to
            minimise IPC payload) so the event loop is free to start the
            next download while the child process parses.
            """
            if pool is not None and len(xml_bytes) >= PARSE_OFFLOAD_MIN_BYTES:
                # Gzip-compress before IPC: a typical DOV XML (~500 kB) shrinks to
                # ~50 kB at level=1, reducing pipe overhead ~10× with minimal CPU cost.
                compressed = gzip.compress(xml_bytes, compresslevel=1)
                # get_running_loop(), not get_event_loop(): we are inside a running
                # coroutine. get_event_loop() in this context is deprecated on
                # Python 3.12+ and becomes a hard error — see CLAUDE.md Python
                # upgrade-path watch item.
                loop = asyncio.get_running_loop()
                # parse_cpt_xml is a top-level function in dov_parse_worker — picklable
                # on Windows spawn. The return type is always GEFParseResult regardless
                # of the ProcessFn[_T] generic; callers that pass a non-DovParser
                # process function (e.g. tests) should not supply a pool.
                return await loop.run_in_executor(pool, parse_cpt_xml, compressed, entry.name)  # type: ignore[arg-type]
            # Inline path: used for small XMLs (below threshold) and when no pool
            # is configured — matches the original behaviour exactly.
            return process(xml_bytes, entry.name)

        # Effective parallelism reflects any 429 seen during WFS discovery (which
        # runs before this download phase), so a rate-limited import backs off its
        # own concurrency instead of hammering DOV into more 429s.
        effective_parallelism = (
            self._backoff.parallelism if self._backoff is not None else DOV_DOWNLOAD_PARALLELISM
        )
        pairs = await parallel_download_and_process(
            http=self._http,
            cache=self._cache,
            rows=index,
            xml_url_of=lambda e: e.xml_url,
            permkey_of=lambda e: e.permkey,
            process_async=_process_entry,
            label="DOV",
            logger=self,
            error_id_of=lambda e: f"'{e.name}'",
            progress_cb=progress_cb,
            parallelism=effective_parallelism,
            backoff=self._backoff,
        )
        return [(entry.name, result) for entry, result in pairs]

    # ------------------------------------------------------------------
    # WFS request layer (count + features). Recursive bbox-split is
    # delegated to ``dov_wfs_bbox.collect_wfs_features_recursive`` from
    # ``fetch_wfs_index``.
    # ------------------------------------------------------------------

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of CPTs in the Lambert72 bbox without fetching features.

        Delegates to the shared ``dov_wfs_request.wfs_count`` (which also
        normalises thin/inverted bboxes before DOV's validator sees them).
        """
        return await wfs_count(
            self._http,
            self,
            layer=DOV_WFS_LAYER,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="sonderingen",
            backoff=self._backoff,
        )

    async def _wfs_features(
        self, x1: float, y1: float, x2: float, y2: float
    ) -> list[_WfsFeatureTuple]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT features from the WFS for this bbox.

        Returns
        -------
        list[_WfsFeatureTuple]
            ``[(xml_url, sondeernummer, x_lambert72, y_lambert72), ...]`` — the
            XML URL is the proxy URL derived from the ``fiche`` property
            (skipping the 302 redirect).  ``x_lambert72`` / ``y_lambert72``
            come from the ``X_mL72`` / ``Y_mL72`` GeoJSON feature properties
            and are in Belgian Lambert 72 metres.  Returns a list (not a dict)
            so the shared bbox-recursion helper can dedup by ``xml_url`` at
            quadrant boundaries; the calling ``fetch_wfs_index`` materialises
            the list into ``WfsIndexEntry`` objects at the end.
        """
        features = await wfs_features_json(
            self._http,
            self,
            layer=DOV_WFS_LAYER,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="sonderingen",
            backoff=self._backoff,
        )

        if features:
            # Log the property keys from the first feature so schema renames are obvious.
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV WFS feature properties: {first_props}")

        tuples: list[_WfsFeatureTuple] = []
        missing_url = 0
        off_host = 0
        for feat in features:
            props = feat.get("properties", {})
            # `fiche` = the canonical URL of the sondering record.
            # `sondeernummer` = the user-facing test name (e.g. "GEO-02/079-S3").
            # `X_mL72` / `Y_mL72` = Lambert 72 easting/northing in metres.
            fiche_url: str = props.get("fiche", "")
            test_name: str = props.get("sondeernummer", "") or last_path_segment(fiche_url)
            x_l72: float = float(props.get("X_mL72") or 0.0)
            y_l72: float = float(props.get("Y_mL72") or 0.0)
            if fiche_url:
                # Construct the proxy URL directly to avoid the 302 round-trip.
                # Falls back to fiche+'.xml' (and follow_redirects) if the URL
                # doesn't match the expected prefix.
                xml_url = (
                    fiche_url.replace(DOV_FICHE_URL_PREFIX, DOV_PROXY_URL_PREFIX, 1)
                    if DOV_FICHE_URL_PREFIX in fiche_url
                    else fiche_url.rstrip("/") + ".xml"
                )
                # `fiche` is attacker-controllable (whoever authored the WFS
                # response). Before it becomes a URL we GET, confirm it points
                # at an allow-listed DOV host — otherwise it is a blind-SSRF
                # steer (e.g. a link-local metadata endpoint) and is dropped,
                # not fetched.
                if not is_allowed_dov_url(xml_url):
                    off_host += 1
                    self.warning(
                        f"DOV WFS: feature '{test_name}' has a non-DOV fiche URL "
                        f"{fiche_url!r} → {xml_url!r} — refused, not fetched (SSRF guard)"
                    )
                    continue
                tuples.append((xml_url, test_name, x_l72, y_l72))
            else:
                missing_url += 1

        if off_host:
            self.warning(
                f"DOV WFS: {off_host} feature(s) named a non-DOV host and were refused "
                "— see the per-feature warnings above"
            )

        if missing_url:
            available_keys = (
                list(features[0].get("properties", {}).keys()) if features else "(none)"
            )
            self.warning(
                f"DOV WFS: {missing_url} features had no 'fiche' property — skipped. "
                f"Available properties: {available_keys}"
            )

        return tuples
