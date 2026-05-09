"""Async DOV WFS client — fetches borehole metadata and XML files in parallel.

Mirrors ``cpt/dov/dov_client.py`` deliberately: same bbox-split + parallel-
download + cache pattern, same stream-parse trick (process callback runs
inside each download task so parse work overlaps with the next download
batch). Differences:

* WFS layer is ``dov-pub:Boringen`` (boreholes) instead of
  ``dov-pub:Sonderingen`` (CPTs).
* Each WFS row carries metadata absent from the boring XML — the
  ``methode`` summary, the eight boolean flags telling us which
  interpretation streams exist, ``Z_mTAW`` (a fallback for boreholes
  whose XML omits Z), and the borehole's ``boornummer``. We expose those
  via a typed ``BoreholeWfsRow`` so the orchestrator can enrich the
  parsed ``Borehole`` without re-querying.
* XML cache lives in a ``boring/`` subdirectory of the shared DOV cache
  so boring permkeys never collide with sondering / interpretation /
  observation permkeys.

XML download:
  The WFS feature ``fiche`` property points at
  ``https://www.dov.vlaanderen.be/data/boring/{permkey}`` which 302-
  redirects to the proxy. We hit the proxy directly to skip the redirect.

Constants live in ``dov_constants.py`` per the project convention.

Debugging:
  - Set log level to TRACE for per-feature property dumps.
  - On WFS count = 0 when you expect results, sanity-check Lambert72
    coords are inside Belgium (X ≈ 20–290k, Y ≈ 150–245k).
  - On 404 from XML downloads, the ``fiche`` URL prefix may have
    changed — see the property dump from ``_wfs_features``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any, TypeVar

import httpx

from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_PROXY_URL_PREFIX,
    DOV_BORING_URL_PREFIX,
    DOV_DOWNLOAD_PARALLELISM,
    DOV_HORIZONTAL_EPSG,
    DOV_VERTICAL_EPSG,
    DOV_WFS_BORINGEN_LAYER,
    DOV_WFS_FEATURE_LIMIT,
    DOV_WFS_NUMBER_MATCHED_RE,
    DOV_WFS_URL,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import (
    last_path_segment,
    optional_float,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_T = TypeVar("_T")
ProcessFn = Callable[[bytes, str], _T]


class DovBoreholeClient(GroundModelLogger):
    """Fetch DOV borehole metadata via WFS and download boring XMLs in parallel.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. Caller must set ``follow_redirects=True``
        because the boring XML endpoint 302-redirects when the proxy-direct
        shortcut isn't applicable.
    cache : DovXmlCache | None
        Optional persistent cache for boring XMLs. When provided, downloads
        consult the cache first and store fresh downloads. Pass a cache
        rooted at the boring/ subdirectory so permkeys don't collide with
        sondering / interpretation / observation permkeys (DOV's permkey
        format YYYY-NNNNNN is shared across resource types).
    """

    def __init__(self, http: httpx.AsyncClient, cache: DovXmlCache | None = None) -> None:
        super().__init__(__name__)
        self._http = http
        self._cache = cache

    async def fetch_bbox_processed(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        process: ProcessFn[_T],
    ) -> list[tuple[BoreholeWfsRow, _T]]:
        """Stream-parse: download every boring XML in the bbox and process inline.

        For each borehole inside the WGS84 bbox, downloads the boring XML
        (or reads from cache) and runs *process(xml_bytes, name)* on it.
        Failures from process() are caught per-borehole so one bad XML
        doesn't kill the batch.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        process : ProcessFn[_T]
            Callable invoked as ``process(xml_bytes, test_id)``. Typically
            ``DovBoringParser().parse``, returning a ``BoreholeParseResult``.

        Returns
        -------
        list[tuple[BoreholeWfsRow, _T]]
            (wfs_row, process_result) pairs — one per borehole successfully
            downloaded and processed. The orchestrator uses ``wfs_row`` to
            enrich the parse result with WFS-only metadata
            (``drill_method``, the eight stream flags, Z fallback, etc.).
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(f"DOV bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")
        self.debug(
            f"DOV bbox Lambert72: x=[{x1:.0f},{x2:.0f}]  y=[{y1:.0f},{y2:.0f}]  "
            f"(valid range: x≈20k–290k, y≈150k–245k)"
        )

        rows = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            row_permkey=lambda r: r.permkey,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV WFS boreholes",
            logger=self,
        )
        self.info(f"DOV WFS: {len(rows)} unique boreholes found in bbox")
        if not rows:
            return []

        total = len(rows)
        cache_state = "with cache" if self._cache is not None else "no cache"
        self.info(
            f"DOV: streaming download+process of {total} boring XMLs "
            f"(max {DOV_DOWNLOAD_PARALLELISM} parallel, {cache_state})"
        )
        sem = asyncio.Semaphore(DOV_DOWNLOAD_PARALLELISM)
        # Mutable counter shared across tasks — asyncio is single-threaded so
        # increments are atomic without a lock.
        progress = {"done": 0, "hits": 0}
        progress_step = max(50, total // 5)
        tasks = [
            self._download_and_process(row, process, sem, progress, total, progress_step)
            for row in rows
        ]
        raw = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[BoreholeWfsRow, _T]] = []
        for row, result in zip(rows, raw, strict=True):
            if isinstance(result, BaseException):
                self.error(
                    f"DOV: download/process failed for '{row.test_id}'  "
                    f"url={row.xml_url}  error={type(result).__name__}: {result}"
                )
            else:
                out.append((row, result))

        if self._cache is not None and progress["done"]:
            hits = progress["hits"]
            misses = progress["done"] - hits
            pct = hits * 100 // progress["done"]
            self.info(f"DOV cache: {hits} hits, {misses} misses ({pct}% hit rate)")
        return out

    async def _download_and_process(
        self,
        row: BoreholeWfsRow,
        process: ProcessFn[_T],
        sem: asyncio.Semaphore,
        progress: dict[str, int],
        total: int,
        progress_step: int,
    ) -> _T:
        """Download (or read from cache), then run process synchronously.

        Cache check happens BEFORE the semaphore acquire — file reads are
        ~0.1 ms and cheaper than queueing on a contended import. On miss
        the fresh bytes are written through to the cache so next import
        skips the round-trip.
        """
        xml_bytes: bytes | None = None
        from_cache = False

        if self._cache is not None:
            xml_bytes = self._cache.get(row.permkey)
            from_cache = xml_bytes is not None

        if xml_bytes is None:
            async with sem:
                try:
                    resp = await self._http.get(row.xml_url)
                except httpx.RequestError as exc:
                    self.error(
                        f"DOV: network error fetching '{row.test_id}' ({row.xml_url}): {exc}"
                    )
                    raise
                if not resp.is_success:
                    self.error(
                        f"DOV: HTTP {resp.status_code} for '{row.test_id}'  "
                        f"url={row.xml_url}  body={resp.text[:200]!r}"
                    )
                    resp.raise_for_status()
                xml_bytes = resp.content
            if self._cache is not None:
                self._cache.put(row.permkey, xml_bytes)

        # Process runs outside the semaphore — parse blocks the event loop
        # briefly while the freed slot starts the next download.
        result = process(xml_bytes, row.test_id)
        progress["done"] += 1
        if from_cache:
            progress["hits"] += 1
        if progress["done"] % progress_step == 0 or progress["done"] == total:
            self.info(f"DOV progress: {progress['done']}/{total} downloaded+parsed")
        return result

    # ------------------------------------------------------------------
    # WFS request layer (count + features). The recursive bbox-split lives
    # in ``dov_wfs_bbox.collect_wfs_features_recursive`` and reaches these
    # via direct method references from ``fetch_bbox_processed``.
    # ------------------------------------------------------------------

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of boreholes in the Lambert72 bbox without fetching features."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_BORINGEN_LAYER,
            "resultType": "hits",
            "BBOX": bbox,
        }
        self.trace(f"DOV WFS count request: BBOX={bbox}")

        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV WFS count request failed: {exc}")
            raise

        if not resp.is_success:
            self.error(f"DOV WFS count returned HTTP {resp.status_code}  body: {resp.text[:500]!r}")
            resp.raise_for_status()

        match = DOV_WFS_NUMBER_MATCHED_RE.search(resp.text)
        if match is None:
            self.error(
                f"DOV WFS count: 'numberMatched' not found in response head: {resp.text[:300]!r}"
            )
            return 0

        count = int(match.group(1))
        self.trace(f"DOV WFS count: {count}  bbox={bbox}")
        return count

    async def _wfs_features(
        self, x1: float, y1: float, x2: float, y2: float
    ) -> list[BoreholeWfsRow]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT borehole features for this bbox."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_BORINGEN_LAYER,
            "outputFormat": "application/json",
            "count": str(DOV_WFS_FEATURE_LIMIT),
            "BBOX": bbox,
        }
        self.trace(f"DOV WFS features request: BBOX={bbox}")

        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV WFS features request failed: {exc}")
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
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV WFS feature properties: {first_props}")

        rows: list[BoreholeWfsRow] = []
        missing_url = 0
        for feat in features:
            props: dict[str, Any] = feat.get("properties", {})
            row = self._build_wfs_row(props)
            if row is None:
                missing_url += 1
                continue
            rows.append(row)

        if missing_url:
            available = list(features[0].get("properties", {}).keys()) if features else "(none)"
            self.warning(
                f"DOV WFS: {missing_url} features had no usable 'fiche' URL — "
                f"skipped. Available properties: {available}"
            )

        # The vertical EPSG (Z_mTAW) is constant for DOV — log once at trace
        # level so users can verify the assumption.
        self.trace(f"DOV WFS: vertical EPSG = {DOV_VERTICAL_EPSG} (mTAW)")

        return rows

    def _build_wfs_row(self, props: dict[str, Any]) -> BoreholeWfsRow | None:
        """Build a BoreholeWfsRow from the WFS feature's ``properties`` dict.

        Returns ``None`` when the feature lacks a ``fiche`` URL — without
        that we can't fetch the boring XML and the row is unusable.
        """
        fiche_url: str = props.get("fiche") or ""
        if not fiche_url:
            return None

        permkey = last_path_segment(fiche_url)
        # Hit the proxy directly to skip the 302; fall back to fiche+'.xml'
        # (and the httpx client's follow_redirects) when the URL prefix
        # doesn't match what we expect.
        xml_url = (
            fiche_url.replace(DOV_BORING_URL_PREFIX, DOV_BORING_PROXY_URL_PREFIX, 1)
            if DOV_BORING_URL_PREFIX in fiche_url
            else fiche_url.rstrip("/") + ".xml"
        )
        # x/y/z are typed ``float | None`` because DOV could in theory ship a
        # null coordinate in a WFS row (the WFS schema allows it). The
        # orchestrator's ``_merge_wfs`` rejects rows that end up with no x/y
        # from either WFS or boring XML — we never persist a borehole that
        # can't be placed on a map. Z (surface elevation in mTAW) is allowed
        # to remain None: the parser flags NO_ELEVATION and the UI will
        # surface a manual-entry editor (Phase 4 / Layer 4 todo).
        # EPSG codes (Lambert 72 horizontal, mTAW vertical) are hardcoded
        # via ``DOV_HORIZONTAL_EPSG`` / ``DOV_VERTICAL_EPSG`` because this
        # is the DOV-only client — every other source brings its own
        # parser/client pair with its own CRS constants.
        return BoreholeWfsRow(
            permkey=permkey,
            test_id=props.get("boornummer") or permkey,
            fiche_url=fiche_url,
            xml_url=xml_url,
            x=optional_float(props.get("X_mL72")),
            y=optional_float(props.get("Y_mL72")),
            z=optional_float(props.get("Z_mTAW")),
            drill_method=props.get("methode") or None,
            municipality=props.get("gemeente") or None,
            executor=props.get("uitvoerder") or None,
            purpose=props.get("doel") or None,
            total_depth_m=optional_float(props.get("diepte_tot_m")),
            has_coded_lithology=bool(props.get("gecodeerde_lithologie")),
            has_geotechnical_coding=bool(props.get("geotechnische_codering")),
            has_lithological_description=bool(props.get("lithologische_beschrijving")),
            has_informal_stratigraphy=bool(props.get("informele_stratigrafie")),
            has_formal_stratigraphy=bool(props.get("formele_stratigrafie")),
            has_quaternary_stratigraphy=bool(props.get("quartaire_stratigrafie")),
            has_hydrogeological_stratigraphy=bool(props.get("hydrogeologische_stratigrafie")),
            has_informal_hydrogeological_stratigraphy=bool(
                props.get("informele_hydrostratigrafie")
            ),
        )
