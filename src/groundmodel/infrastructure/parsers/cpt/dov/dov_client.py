"""Async DOV WFS client — fetches CPT metadata and XML files in parallel.

Data sources:
  WFS:  https://www.dov.vlaanderen.be/geoserver/ows (dov-pub:Sondering)
  XML:  https://www.dov.vlaanderen.be/data/sondering/{pkey_id}.xml

Coordinates from the frontend arrive as WGS84 (EPSG:4326). They are transformed
to Belgian Lambert 72 (EPSG:31370) for the WFS BBOX filter, which is the native
CRS of the DOV service.
"""

from __future__ import annotations

import asyncio

import httpx
from pyproj import Transformer

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_WFS_URL = "https://www.dov.vlaanderen.be/geoserver/ows"
_XML_BASE = "https://www.dov.vlaanderen.be/data/sondering"
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

        self.debug(f"DOV bbox Lambert72: ({x1:.0f},{y1:.0f}) → ({x2:.0f},{y2:.0f})")
        pkeys = await self._collect_pkeys(x1, y1, x2, y2, depth=0)
        self.info(f"DOV: {len(pkeys)} CPTs found in bbox")

        return await self._download_all(pkeys)

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
            return {}

        if count <= _WFS_LIMIT or depth >= _MAX_DEPTH:
            if count > _WFS_LIMIT:
                self.warning(f"DOV: bbox at max recursion depth still has {count} features")
            return await self._wfs_pkeys(x1, y1, x2, y2)

        # Split into 4 quadrants and query in parallel.
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
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
        return merged

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of CPTs in the Lambert72 bbox without fetching features."""
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "dov-pub:Sondering",
            "outputFormat": "application/json",
            "resultType": "hits",
            "BBOX": f"{x1},{y1},{x2},{y2},EPSG:31370",
        }
        resp = await self._http.get(_WFS_URL, params=params)
        resp.raise_for_status()
        data = resp.json()
        return int(data.get("numberMatched", data.get("totalFeatures", 0)))

    async def _wfs_pkeys(self, x1: float, y1: float, x2: float, y2: float) -> dict[str, str]:
        """Fetch up to _WFS_LIMIT pkeys from the WFS for this Lambert72 bbox."""
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "dov-pub:Sondering",
            "outputFormat": "application/json",
            "count": str(_WFS_LIMIT),
            "BBOX": f"{x1},{y1},{x2},{y2},EPSG:31370",
        }
        resp = await self._http.get(_WFS_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

        pkeys: dict[str, str] = {}
        for feat in data.get("features", []):
            props = feat.get("properties", {})
            pkey: str = props.get("pkey", "")
            name: str = props.get("naam", "") or _pkey_id(pkey)
            if pkey:
                pkeys[pkey] = name
        return pkeys

    # ------------------------------------------------------------------
    # XML downloads
    # ------------------------------------------------------------------

    async def _download_all(self, pkeys: dict[str, str]) -> list[tuple[str, bytes]]:
        """Download XML for every pkey, bounded by _PARALLEL concurrent requests."""
        sem = asyncio.Semaphore(_PARALLEL)
        tasks = [self._download_one(pkey_url, name, sem) for pkey_url, name in pkeys.items()]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        out: list[tuple[str, bytes]] = []
        for (pkey_url, name), result in zip(pkeys.items(), results):
            if isinstance(result, Exception):
                self.warning(f"DOV: failed to download '{name}' ({pkey_url}): {result}")
            else:
                out.append((name, result))
        return out

    async def _download_one(self, pkey_url: str, name: str, sem: asyncio.Semaphore) -> bytes:
        xml_url = pkey_url.rstrip("/") + ".xml"
        async with sem:
            resp = await self._http.get(xml_url)
            resp.raise_for_status()
            return resp.content


def _pkey_id(pkey_url: str) -> str:
    """Extract the numeric ID portion from a DOV pkey URL."""
    return pkey_url.rstrip("/").rsplit("/", 1)[-1]
