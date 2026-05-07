"""Async DOV WFS client — fetches CPT metadata and XML files in parallel.

Data sources:
  WFS:  https://www.dov.vlaanderen.be/geoserver/ows (dov-pub:Sondering)
  XML:  https://www.dov.vlaanderen.be/data/sondering/{pkey_id}.xml

Coordinates from the frontend arrive as WGS84 (EPSG:4326). They are transformed
to Belgian Lambert 72 (EPSG:31370) for the WFS BBOX filter, which is the native
CRS of the DOV service.

Debugging tips:
  - Set log level to TRACE to see every HTTP request, response body, and feature
    property dump from the WFS.
  - On WFS count = 0 when you expect results, check that the bbox Lambert72
    coordinates look plausible for Belgium (X ≈ 20 000–290 000, Y ≈ 150 000–245 000).
  - If XML downloads return 404, the pkey URL format may have changed — check
    the 'pkey' property in the WFS feature response at TRACE level.
"""

from __future__ import annotations

import asyncio

import httpx
from pyproj import Transformer

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_WFS_URL = "https://www.dov.vlaanderen.be/geoserver/ows"
_WFS_LIMIT = 500  # max features returned in one WFS request
_PARALLEL = 10  # max concurrent XML downloads
_MAX_DEPTH = 5  # bbox split recursion limit (2^5 = 32 subdivisions per axis)

# Transform WGS84 lon/lat → Lambert72 easting/northing (always_xy enforces lon,lat input order)
_to_lambert = Transformer.from_crs("EPSG:4326", "EPSG:31370", always_xy=True)


class DovClient(GroundModelLogger):
    """Fetch DOV CPT metadata via WFS and download XML files in parallel.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client (caller owns lifecycle).
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
            (name, xml_bytes) pairs — one per CPT found.
        """
        x1, y1 = _to_lambert.transform(west, south)
        x2, y2 = _to_lambert.transform(east, north)

        self.debug(f"DOV bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")
        self.debug(
            f"DOV bbox Lambert72: x=[{x1:.0f},{x2:.0f}]  y=[{y1:.0f},{y2:.0f}]  "
            f"(valid range: x≈20k–290k, y≈150k–245k)"
        )

        pkeys = await self._collect_pkeys(x1, y1, x2, y2, depth=0)
        self.info(f"DOV WFS: {len(pkeys)} unique CPTs found in bbox")

        if not pkeys:
            return []

        results = await self._download_all(pkeys)
        self.info(
            f"DOV downloads: {len(results)} succeeded, "
            f"{len(pkeys) - len(results)} failed out of {len(pkeys)} total"
        )
        return results

    # ------------------------------------------------------------------
    # WFS queries
    # ------------------------------------------------------------------

    async def _collect_pkeys(
        self, x1: float, y1: float, x2: float, y2: float, depth: int
    ) -> dict[str, str]:
        """Return {pkey_url: name} for all CPTs in this Lambert72 bbox.

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
            return await self._wfs_pkeys(x1, y1, x2, y2)

        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        self.debug(
            f"DOV WFS: {count} features > limit={_WFS_LIMIT} at depth={depth}, "
            f"splitting into 4 quadrants"
        )
        quads = [
            (x1, y1, mx, my),
            (mx, y1, x2, my),
            (x1, my, mx, y2),
            (mx, my, x2, y2),
        ]
        results = await asyncio.gather(
            *[self._collect_pkeys(qx1, qy1, qx2, qy2, depth + 1) for qx1, qy1, qx2, qy2 in quads]
        )

        merged: dict[str, str] = {}
        for chunk in results:
            merged.update(chunk)
        self.debug(f"DOV WFS: depth={depth} quadrants merged → {len(merged)} unique pkeys")
        return merged

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of CPTs in the Lambert72 bbox without fetching features."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:31370"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "dov-pub:Sondering",
            "outputFormat": "application/json",
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

        data = resp.json()
        self.trace(f"DOV WFS count response keys: {list(data.keys())}")

        count = int(data.get("numberMatched", data.get("totalFeatures", 0)))
        self.trace(f"DOV WFS count: {count}  bbox={bbox}")
        return count

    async def _wfs_pkeys(self, x1: float, y1: float, x2: float, y2: float) -> dict[str, str]:
        """Fetch up to _WFS_LIMIT pkeys from the WFS for this Lambert72 bbox."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:31370"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "dov-pub:Sondering",
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
            # Log the property keys from the first feature to help diagnose schema changes.
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV WFS feature properties: {first_props}")

        pkeys: dict[str, str] = {}
        missing_pkey = 0
        for feat in features:
            props = feat.get("properties", {})
            pkey: str = props.get("pkey", "")
            name: str = props.get("naam", "") or _pkey_id(pkey)
            if pkey:
                pkeys[pkey] = name
            else:
                missing_pkey += 1

        if missing_pkey:
            self.warning(
                f"DOV WFS: {missing_pkey} features had no 'pkey' property — skipped. "
                f"Available properties: {list(features[0].get('properties', {}).keys()) if features else '(none)'}"
            )

        return pkeys

    # ------------------------------------------------------------------
    # XML downloads
    # ------------------------------------------------------------------

    async def _download_all(self, pkeys: dict[str, str]) -> list[tuple[str, bytes]]:
        """Download XML for every pkey, bounded by _PARALLEL concurrent requests."""
        self.info(f"DOV: downloading {len(pkeys)} XML files (max {_PARALLEL} parallel)")
        sem = asyncio.Semaphore(_PARALLEL)
        tasks = [self._download_one(pkey_url, name, sem) for pkey_url, name in pkeys.items()]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[str, bytes]] = []
        for (pkey_url, name), result in zip(pkeys.items(), raw_results):
            if isinstance(result, Exception):
                self.error(
                    f"DOV: XML download failed for '{name}'  "
                    f"url={pkey_url}.xml  error={type(result).__name__}: {result}"
                )
            else:
                self.trace(f"DOV: downloaded '{name}' ({len(result)} bytes)")
                out.append((name, result))
        return out

    async def _download_one(self, pkey_url: str, name: str, sem: asyncio.Semaphore) -> bytes:
        xml_url = pkey_url.rstrip("/") + ".xml"
        self.trace(f"DOV: fetching {xml_url}")
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

            return resp.content


def _pkey_id(pkey_url: str) -> str:
    """Extract the ID portion from a DOV pkey URL (e.g. '2020-304288')."""
    return pkey_url.rstrip("/").rsplit("/", 1)[-1]
