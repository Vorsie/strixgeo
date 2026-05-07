"""Async DOV WFS client — fetches CPT metadata and XML files in parallel.

Data sources (verified live 2026-05-07):
  WFS:  https://www.dov.vlaanderen.be/geoserver/ows
        feature type: dov-pub:Sonderingen  (plural — 'soundings')
  XML:  the WFS feature property `fiche` holds a URL like
        https://www.dov.vlaanderen.be/data/sondering/{permkey}
        Appending `.xml` returns a 302 redirect to the proxy at
        https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/{permkey}
        — httpx must therefore have follow_redirects=True.

Coordinates from the frontend arrive as WGS84 (EPSG:4326). They are transformed
to Belgian Lambert 72 (EPSG:31370) for the WFS BBOX filter, which is the native
CRS of the DOV service.

WFS quirks worth knowing:
  - resultType=hits returns XML even when outputFormat=application/json is requested.
    We extract the numberMatched attribute via regex from the XML root element.
  - The default WFS server-side cap is 500 features; we recursively split bboxes
    that exceed it.

Debugging tips:
  - Set log level to TRACE to see every HTTP request, response body, and feature
    property dump from the WFS.
  - On WFS count = 0 when you expect results, check that the bbox Lambert72
    coordinates look plausible for Belgium (X ≈ 20 000–290 000, Y ≈ 150 000–245 000).
  - If XML downloads return 404, the `fiche` URL format may have changed —
    check the property dump from `_wfs_pkeys` at TRACE level.
"""

from __future__ import annotations

import asyncio
import re

import httpx
from pyproj import Transformer

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_WFS_URL = "https://www.dov.vlaanderen.be/geoserver/ows"
_LAYER = "dov-pub:Sonderingen"  # plural; verified via GetCapabilities
_WFS_LIMIT = 500  # default server-side cap on features per request
_PARALLEL = 10  # max concurrent XML downloads
_MAX_DEPTH = 5  # bbox split recursion limit (2^5 = 32 subdivisions per axis)

# Match `numberMatched="123"` anywhere in the XML hits response.
_NUMBER_MATCHED_RE = re.compile(r'numberMatched="(\d+)"')

# Transform WGS84 lon/lat → Lambert72 easting/northing (always_xy enforces lon,lat input order)
_to_lambert = Transformer.from_crs("EPSG:4326", "EPSG:31370", always_xy=True)


class DovClient(GroundModelLogger):
    """Fetch DOV CPT metadata via WFS and download XML files in parallel.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. Caller is responsible for setting
        ``follow_redirects=True`` because the XML endpoint 302-redirects
        to a proxy URL.
    """

    def __init__(self, http: httpx.AsyncClient) -> None:
        super().__init__(__name__)
        self._http = http

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
        x1, y1 = _to_lambert.transform(west, south)
        x2, y2 = _to_lambert.transform(east, north)

        self.debug(f"DOV bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")
        self.debug(
            f"DOV bbox Lambert72: x=[{x1:.0f},{x2:.0f}]  y=[{y1:.0f},{y2:.0f}]  "
            f"(valid range: x≈20k–290k, y≈150k–245k)"
        )

        # name_by_url maps the XML URL → sondeernummer (CPT name).
        name_by_url = await self._collect_pkeys(x1, y1, x2, y2, depth=0)
        self.info(f"DOV WFS: {len(name_by_url)} unique CPTs found in bbox")

        if not name_by_url:
            return []

        results = await self._download_all(name_by_url)
        self.info(
            f"DOV downloads: {len(results)} succeeded, "
            f"{len(name_by_url) - len(results)} failed out of {len(name_by_url)} total"
        )
        return results

    # ------------------------------------------------------------------
    # WFS queries
    # ------------------------------------------------------------------

    async def _collect_pkeys(
        self, x1: float, y1: float, x2: float, y2: float, depth: int
    ) -> dict[str, str]:
        """Return {xml_url: sondeernummer} for all CPTs in this Lambert72 bbox.

        Recursively splits into four quadrants when the feature count exceeds
        _WFS_LIMIT, ensuring we never miss CPTs due to server-side result caps.
        """
        count = await self._wfs_count(x1, y1, x2, y2)

        if count == 0:
            self.trace(
                f"DOV WFS: 0 features at depth={depth} ({x1:.0f},{y1:.0f})→({x2:.0f},{y2:.0f})"
            )
            return {}

        if count <= _WFS_LIMIT or depth >= _MAX_DEPTH:
            if count > _WFS_LIMIT:
                self.warning(
                    f"DOV WFS: bbox at max recursion depth={depth} still has {count} features "
                    f"(> {_WFS_LIMIT} limit) — some CPTs may be missed"
                )
            self.debug(f"DOV WFS: fetching {count} features (depth={depth})")
            return await self._wfs_features(x1, y1, x2, y2)

        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        self.debug(
            f"DOV WFS: {count} features > limit={_WFS_LIMIT} at depth={depth}, "
            f"splitting into 4 quadrants"
        )
        quadrants = [
            (x1, y1, mx, my),
            (mx, y1, x2, my),
            (x1, my, mx, y2),
            (mx, my, x2, y2),
        ]
        results = await asyncio.gather(
            *[
                self._collect_pkeys(qx1, qy1, qx2, qy2, depth + 1)
                for qx1, qy1, qx2, qy2 in quadrants
            ]
        )

        merged: dict[str, str] = {}
        for chunk in results:
            merged.update(chunk)
        self.debug(f"DOV WFS: depth={depth} quadrants merged → {len(merged)} unique CPTs")
        return merged

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of CPTs in the Lambert72 bbox without fetching features.

        DOV's WFS returns XML for resultType=hits even when JSON is requested.
        We extract the numberMatched attribute from the FeatureCollection root.
        """
        bbox = f"{x1},{y1},{x2},{y2},EPSG:31370"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": _LAYER,
            "resultType": "hits",
            "BBOX": bbox,
        }
        self.trace(f"DOV WFS count request: BBOX={bbox}")

        try:
            resp = await self._http.get(_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV WFS count request failed (network error): {exc}")
            raise

        if not resp.is_success:
            self.error(f"DOV WFS count returned HTTP {resp.status_code}  body: {resp.text[:500]!r}")
            resp.raise_for_status()

        match = _NUMBER_MATCHED_RE.search(resp.text)
        if match is None:
            self.error(
                f"DOV WFS count: 'numberMatched' attribute not found. "
                f"Response head: {resp.text[:300]!r}"
            )
            return 0

        count = int(match.group(1))
        self.trace(f"DOV WFS count: {count}  bbox={bbox}")
        return count

    async def _wfs_features(self, x1: float, y1: float, x2: float, y2: float) -> dict[str, str]:
        """Fetch up to _WFS_LIMIT features from the WFS for this Lambert72 bbox.

        Returns
        -------
        dict[str, str]
            {xml_url: sondeernummer} — the XML URL is the WFS `fiche` property
            with ``.xml`` appended.
        """
        bbox = f"{x1},{y1},{x2},{y2},EPSG:31370"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": _LAYER,
            "outputFormat": "application/json",
            "count": str(_WFS_LIMIT),
            "BBOX": bbox,
        }
        self.trace(f"DOV WFS features request: BBOX={bbox}")

        try:
            resp = await self._http.get(_WFS_URL, params=params)
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

        url_to_name: dict[str, str] = {}
        missing_url = 0
        for feat in features:
            props = feat.get("properties", {})
            # `fiche` = the canonical URL of the sondering record.
            # `sondeernummer` = the user-facing test name (e.g. "GEO-02/079-S3").
            fiche_url: str = props.get("fiche", "")
            test_name: str = props.get("sondeernummer", "") or _last_path_segment(fiche_url)
            if fiche_url:
                xml_url = fiche_url.rstrip("/") + ".xml"
                url_to_name[xml_url] = test_name
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

        return url_to_name

    # ------------------------------------------------------------------
    # XML downloads
    # ------------------------------------------------------------------

    async def _download_all(self, url_to_name: dict[str, str]) -> list[tuple[str, bytes]]:
        """Download XML for every entry, bounded by _PARALLEL concurrent requests."""
        self.info(f"DOV: downloading {len(url_to_name)} XML files (max {_PARALLEL} parallel)")
        sem = asyncio.Semaphore(_PARALLEL)
        tasks = [self._download_one(xml_url, name, sem) for xml_url, name in url_to_name.items()]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[str, bytes]] = []
        for (xml_url, name), result in zip(url_to_name.items(), raw_results):
            if isinstance(result, Exception):
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
