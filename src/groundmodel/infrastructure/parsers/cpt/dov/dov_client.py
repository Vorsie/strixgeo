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
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
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
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_T = TypeVar("_T")
ProcessFn = Callable[[bytes, str], _T]


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
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)

        self.debug(f"DOV bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")
        self.debug(
            f"DOV bbox Lambert72: x=[{x1:.0f},{x2:.0f}]  y=[{y1:.0f},{y2:.0f}]  "
            f"(valid range: x≈20k–290k, y≈150k–245k)"
        )

        # name_by_url maps the XML URL → sondeernummer (CPT name).
        # Recursive bbox-split + dedup handled by the shared helper, keyed on
        # xml_url (first tuple element) so a CPT near a quadrant boundary
        # appearing in multiple sub-bboxes only persists once.
        pairs = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            row_permkey=lambda r: r[0],
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV WFS sonderingen",
            logger=self,
        )
        name_by_url: dict[str, str] = dict(pairs)
        self.info(f"DOV WFS: {len(name_by_url)} unique CPTs found in bbox")

        if not name_by_url:
            return []

        results = await self._download_all(name_by_url)
        self.info(
            f"DOV downloads: {len(results)} succeeded, "
            f"{len(name_by_url) - len(results)} failed out of {len(name_by_url)} total"
        )
        return results

    async def fetch_bbox_processed(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        process: ProcessFn[_T],
    ) -> list[tuple[str, _T]]:
        """Same as fetch_bbox but runs *process(xml_bytes, name)* on each download.

        Why this exists: parsing 200+ XMLs sequentially after they all downloaded
        was costing 8+ extra seconds. Running process inside each download task
        means parse work happens between async waits — the parse phase wall time
        disappears into the download wait time. Failures from process() are
        caught per-CPT so one bad XML doesn't kill the batch.

        When a cache is configured, cache hits skip the network entirely — the
        bytes go straight from disk into process(). Hit/miss counts are logged.

        Returns
        -------
        list[tuple[str, _T]]
            (sondeernummer, process_result) for every CPT processed successfully.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(f"DOV bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")

        # Recursive bbox-split + dedup is delegated to the shared helper.
        # Dedup by xml_url (first tuple element).
        pairs = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            row_permkey=lambda r: r[0],
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV WFS sonderingen",
            logger=self,
        )
        name_by_url: dict[str, str] = dict(pairs)
        self.info(f"DOV WFS: {len(name_by_url)} unique CPTs found in bbox")
        if not name_by_url:
            return []

        total = len(name_by_url)
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
            self._download_and_process(xml_url, name, process, sem, progress, total, progress_step)
            for xml_url, name in name_by_url.items()
        ]
        raw = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[str, _T]] = []
        for (xml_url, name), result in zip(name_by_url.items(), raw):
            if isinstance(result, BaseException):
                self.error(
                    f"DOV: download/process failed for '{name}'  "
                    f"url={xml_url}  error={type(result).__name__}: {result}"
                )
            else:
                out.append((name, result))

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
    ) -> _T:
        """Download (or read from cache), then run process synchronously.

        On cache hit the network is skipped entirely. On cache miss the XML is
        downloaded and then written back to the cache for next time. Process
        runs after the semaphore is released so the slot becomes available for
        the next download immediately. *progress* is shared across tasks for
        periodic INFO logging — asyncio is single-threaded so the increment is
        race-free without a lock.
        """
        permkey = _last_path_segment(xml_url)
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
        return result

    # ------------------------------------------------------------------
    # WFS request layer (count + features). Recursive bbox-split is
    # delegated to ``dov_wfs_bbox.collect_wfs_features_recursive`` from
    # ``fetch_bbox_processed``.
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
    ) -> list[tuple[str, str]]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT features from the WFS for this bbox.

        Returns
        -------
        list[tuple[str, str]]
            ``[(xml_url, sondeernummer), ...]`` — the XML URL is the proxy URL
            derived from the ``fiche`` property (skipping the 302 redirect).
            Returned as a list (not a dict) so the shared bbox-recursion
            helper can dedup by ``xml_url`` at quadrant boundaries; the
            calling ``fetch_bbox_processed`` builds the dict at the end.
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

        pairs: list[tuple[str, str]] = []
        missing_url = 0
        for feat in features:
            props = feat.get("properties", {})
            # `fiche` = the canonical URL of the sondering record.
            # `sondeernummer` = the user-facing test name (e.g. "GEO-02/079-S3").
            fiche_url: str = props.get("fiche", "")
            test_name: str = props.get("sondeernummer", "") or _last_path_segment(fiche_url)
            if fiche_url:
                # Construct the proxy URL directly to avoid the 302 round-trip.
                # Falls back to fiche+'.xml' (and follow_redirects) if the URL
                # doesn't match the expected prefix.
                xml_url = (
                    fiche_url.replace(DOV_FICHE_URL_PREFIX, DOV_PROXY_URL_PREFIX, 1)
                    if DOV_FICHE_URL_PREFIX in fiche_url
                    else fiche_url.rstrip("/") + ".xml"
                )
                pairs.append((xml_url, test_name))
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

        return pairs

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


def _last_path_segment(url: str) -> str:
    """Return the last path segment of *url* (e.g. '2009-000089' from a fiche URL)."""
    return url.rstrip("/").rsplit("/", 1)[-1]
