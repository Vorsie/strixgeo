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
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

import httpx

from groundmodel.infrastructure.parsers.cpt.dov.dov_constants import (
    DOV_DOWNLOAD_PARALLELISM,
    DOV_FICHE_URL_PREFIX,
    DOV_HORIZONTAL_EPSG,
    DOV_PROXY_URL_PREFIX,
    DOV_WFS_FEATURE_LIMIT,
    DOV_WFS_LAYER,
    DOV_WFS_NUMBER_MATCHED_RE,
    DOV_WFS_URL,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import last_path_segment
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
    """

    def __init__(self, http: httpx.AsyncClient, cache: DovXmlCache | None = None) -> None:
        super().__init__(__name__)
        self._http = http
        self._cache = cache

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

    async def fetch_bbox(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
    ) -> list[tuple[str, bytes]]:
        """Return (name, xml_bytes) for every CPT within the WGS84 bounding box.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.

        Returns
        -------
        list[tuple[str, bytes]]
            (sondeernummer, xml_bytes) pairs — one per CPT successfully downloaded.
        """
        index = await self.fetch_wfs_index(west, south, east, north)
        if not index:
            return []

        url_to_name: dict[str, str] = {e.xml_url: e.name for e in index}
        results = await self._download_all(url_to_name)
        self.info(
            f"DOV downloads: {len(results)} succeeded, "
            f"{len(index) - len(results)} failed out of {len(index)} total"
        )
        return results

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
    ) -> list[tuple[str, _T]]:
        """Same as fetch_bbox but runs *process(xml_bytes, name)* on each download.

        Why this exists: parsing 200+ XMLs sequentially after they all downloaded
        was costing 8+ extra seconds. Running process inside each download task
        means parse work happens between async waits — the parse phase wall time
        disappears into the download wait time. Failures from process() are
        caught per-CPT so one bad XML doesn't kill the batch.

        When a cache is configured, cache hits skip the network entirely — the
        bytes go straight from disk into process(). Hit/miss counts are logged.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        process : ProcessFn[_T]
            Callable invoked as ``process(xml_bytes, name)``.
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

        cache_state = "with cache" if self._cache is not None else "no cache"
        self.info(
            f"DOV: streaming download+process of {total} XMLs "
            f"(max {DOV_DOWNLOAD_PARALLELISM} parallel, {cache_state})"
        )
        sem = asyncio.Semaphore(DOV_DOWNLOAD_PARALLELISM)
        # Mutable counter shared across tasks — asyncio is single-threaded so
        # increments are atomic without a lock. Used purely for progress logging.
        progress = {"done": 0, "hits": 0}
        progress_step = max(50, total // 5)  # log every 50 OR every 20% of total
        tasks = [
            self._download_and_process(
                entry.xml_url,
                entry.name,
                process,
                sem,
                progress,
                total,
                progress_step,
                progress_cb,
            )
            for entry in index
        ]
        raw = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[str, _T]] = []
        for entry, result in zip(index, raw):
            if isinstance(result, BaseException):
                self.error(
                    f"DOV: download/process failed for '{entry.name}'  "
                    f"url={entry.xml_url}  error={type(result).__name__}: {result}"
                )
            else:
                out.append((entry.name, result))

        if self._cache is not None:
            hits = progress["hits"]
            misses = progress["done"] - hits
            pct = (hits * 100 // progress["done"]) if progress["done"] else 0
            self.info(f"DOV cache: {hits} hits, {misses} misses ({pct}% hit rate)")
        return out

    async def _download_and_process(
        self,
        xml_url: str,
        name: str,
        process: ProcessFn[_T],
        sem: asyncio.Semaphore,
        progress: dict[str, int],
        total: int,
        progress_step: int,
        progress_cb: ProgressCallback | None = None,
    ) -> _T:
        """Download (or read from cache), then run process synchronously.

        On cache hit the network is skipped entirely. On cache miss the XML is
        downloaded and then written back to the cache for next time. Process
        runs after the semaphore is released so the slot becomes available for
        the next download immediately. *progress* is shared across tasks for
        periodic INFO logging — asyncio is single-threaded so the increment is
        race-free without a lock.

        Parameters
        ----------
        xml_url : str
            Absolute URL of the CPT XML document to fetch.
        name : str
            Human-readable CPT name (sondeernummer) for log messages.
        process : ProcessFn[_T]
            Callable run as ``process(xml_bytes, name)`` after download.
        sem : asyncio.Semaphore
            Bounded download concurrency slot.
        progress : dict[str, int]
            Shared mutable counter ``{"done": int, "hits": int}``.
        total : int
            Total number of CPTs in this batch (for ``[done/total]`` logs).
        progress_step : int
            Fire progress log every this many items.
        progress_cb : ProgressCallback | None
            Optional callback.  Receives ``("download", done, total)`` on
            every logging tick.
        """
        permkey = last_path_segment(xml_url)
        xml_bytes: bytes | None = None
        from_cache = False

        # Cache lookup — file read is ~0.1ms, faster than acquiring the semaphore
        # on a contended import, so we check before queueing for download.
        if self._cache is not None:
            xml_bytes = self._cache.get(permkey)
            from_cache = xml_bytes is not None

        if xml_bytes is None:
            async with sem:
                try:
                    resp = await self._http.get(xml_url)
                except httpx.RequestError as exc:
                    self.error(f"DOV: network error fetching '{name}' ({xml_url}): {exc}")
                    raise
                if not resp.is_success:
                    self.error(
                        f"DOV: HTTP {resp.status_code} for '{name}'  "
                        f"url={xml_url}  body={resp.text[:200]!r}"
                    )
                    resp.raise_for_status()
                xml_bytes = resp.content
            # Write-through cache: store the fresh bytes so next import skips this
            # round-trip. Cache write failures are logged but never raised.
            if self._cache is not None:
                self._cache.put(permkey, xml_bytes)

        # Process runs outside the semaphore — parse blocks the event loop briefly
        # (~16ms per CPT) while the freed semaphore slot starts the next download.
        result = process(xml_bytes, name)
        progress["done"] += 1
        if from_cache:
            progress["hits"] += 1
        if progress["done"] % progress_step == 0 or progress["done"] == total:
            self.info(f"DOV progress: {progress['done']}/{total} downloaded+parsed")
            await fire_progress(progress_cb, "download", progress["done"], total)
        return result

    # ------------------------------------------------------------------
    # WFS request layer (count + features). Recursive bbox-split is
    # delegated to ``dov_wfs_bbox.collect_wfs_features_recursive`` from
    # ``fetch_wfs_index``.
    # ------------------------------------------------------------------

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of CPTs in the Lambert72 bbox without fetching features.

        DOV's WFS returns XML for resultType=hits even when JSON is requested.
        We extract the numberMatched attribute from the FeatureCollection root.
        """
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_LAYER,
            "resultType": "hits",
            "BBOX": bbox,
        }
        self.trace(f"DOV WFS count request: BBOX={bbox}")

        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV WFS count request failed (network error): {exc}")
            raise

        if not resp.is_success:
            self.error(f"DOV WFS count returned HTTP {resp.status_code}  body: {resp.text[:500]!r}")
            resp.raise_for_status()

        match = DOV_WFS_NUMBER_MATCHED_RE.search(resp.text)
        if match is None:
            self.error(
                f"DOV WFS count: 'numberMatched' attribute not found. "
                f"Response head: {resp.text[:300]!r}"
            )
            return 0

        count = int(match.group(1))
        self.trace(f"DOV WFS count: {count}  bbox={bbox}")
        return count

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
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_LAYER,
            "outputFormat": "application/json",
            "count": str(DOV_WFS_FEATURE_LIMIT),
            "BBOX": bbox,
        }
        self.trace(f"DOV WFS features request: BBOX={bbox}")

        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV WFS features request failed (network error): {exc}")
            raise

        if not resp.is_success:
            self.error(
                f"DOV WFS features returned HTTP {resp.status_code}  body: {resp.text[:500]!r}"
            )
            resp.raise_for_status()

        data = resp.json()
        features = data.get("features", [])
        self.debug(f"DOV WFS: {len(features)} features in response (bbox={bbox})")

        if features:
            # Log the property keys from the first feature so schema renames are obvious.
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV WFS feature properties: {first_props}")

        tuples: list[_WfsFeatureTuple] = []
        missing_url = 0
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
                tuples.append((xml_url, test_name, x_l72, y_l72))
            else:
                missing_url += 1

        if missing_url:
            available_keys = (
                list(features[0].get("properties", {}).keys()) if features else "(none)"
            )
            self.warning(
                f"DOV WFS: {missing_url} features had no 'fiche' property — skipped. "
                f"Available properties: {available_keys}"
            )

        return tuples

    # ------------------------------------------------------------------
    # XML downloads (legacy non-streaming path; kept for fetch_bbox)
    # ------------------------------------------------------------------

    async def _download_all(self, url_to_name: dict[str, str]) -> list[tuple[str, bytes]]:
        """Download XML for every entry, bounded by DOV_DOWNLOAD_PARALLELISM."""
        self.info(
            f"DOV: downloading {len(url_to_name)} XML files "
            f"(max {DOV_DOWNLOAD_PARALLELISM} parallel)"
        )
        sem = asyncio.Semaphore(DOV_DOWNLOAD_PARALLELISM)
        tasks = [self._download_one(xml_url, name, sem) for xml_url, name in url_to_name.items()]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[str, bytes]] = []
        for (xml_url, name), result in zip(url_to_name.items(), raw_results):
            if isinstance(result, BaseException):
                self.error(
                    f"DOV: XML download failed for '{name}'  "
                    f"url={xml_url}  error={type(result).__name__}: {result}"
                )
            else:
                self.trace(f"DOV: downloaded '{name}' ({len(result)} bytes)")
                out.append((name, result))
        return out

    async def _download_one(self, xml_url: str, name: str, sem: asyncio.Semaphore) -> bytes:
        self.trace(f"DOV: fetching {xml_url}")
        async with sem:
            try:
                # The httpx client is configured by the caller with follow_redirects=True;
                # this URL 302-redirects to /xdov/proxy/export/sondering/{permkey}.
                resp = await self._http.get(xml_url)
            except httpx.RequestError as exc:
                self.error(f"DOV: network error fetching '{name}' ({xml_url}): {exc}")
                raise

            if not resp.is_success:
                self.error(
                    f"DOV: HTTP {resp.status_code} for '{name}'  "
                    f"url={xml_url}  body={resp.text[:200]!r}"
                )
                resp.raise_for_status()

            return resp.content
