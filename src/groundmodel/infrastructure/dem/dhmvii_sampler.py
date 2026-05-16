"""Sample DHMVII (Digital Elevation Model Flanders II) along a line.

The cross-section view needs an elevation profile: a list of
``(along_m, elevation_m)`` pairs running from the section's start
endpoint to its end. DHMVII offers a public WCS service at 1 m
resolution; we fetch a single GeoTIFF covering the line's bounding
box, parse it, and bilinear-sample at N evenly-spaced points along
the line.

Endpoint shape (verified live 2026-05-11):

* GetCoverage URL ::

      GET https://geo.api.vlaanderen.be/DHMV/wcs
          ?service=WCS&version=2.0.1
          &request=GetCoverage
          &coverageId=DHMVII_DTM_1m
          &subset=X(min,max)
          &subset=Y(min,max)
          &format=image/tiff

* Response: multipart/related with two parts —

    1. ``Content-ID: GML-Part`` — XML metadata (envelope, nil values).
       We ignore it; the request bbox and the TIFF dimensions are the
       only georeferencing we need.
    2. ``Content-ID: 1.tif`` — single-band float32 GeoTIFF. NoData
       sentinel is ``-9999``.

* Pixel size = bbox_width / tiff_width (verified to be 1.0 m for the
  native ``DHMVII_DTM_1m`` coverage; the WCS server enforces this).
* TIFF row 0 corresponds to bbox max-Y (north-up), row N-1 to min-Y.

Trade-offs against alternatives:

* DOV's REST elevation-point endpoint (per-point HTTP) doesn't exist
  (404 as of 2026-05-11). Probed before this implementation.
* tifffile + numpy would be lighter but Pillow ships pre-built wheels
  on every platform and reads float32 TIFFs natively. The hot path
  here is N bilinear lookups (where N ≤ 1000) — not worth the
  install-time numpy cost.

Out of scope for this module:

* AHN (Netherlands) sampling. Lands as a sibling module with a
  ``DemSource`` ABC promoted when both implementations exist.
* On-disk caching of GeoTIFF blobs. The WCS endpoint is fast enough
  for v1 (~200 ms typical); revisit when section opens get spammy
  or offline support is needed.
* Coordinate-system juggling. Callers pass endpoints already in
  EPSG:31370 (the section's stored CRS); we don't transform.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email import message_from_bytes
from io import BytesIO

import httpx
from PIL import Image

from groundmodel.infrastructure.dem.dem_wcs_constants import (
    DHMVII_COVERAGE_ID,
    DHMVII_NODATA,
    DHMVII_WCS_URL,
    WCS_BBOX_PADDING_M,
    WCS_SAMPLER_TIMEOUT_SECONDS,
    WCS_VERSION,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class SamplePoint:
    """One elevation sample along a section line."""

    along_m: float
    """Distance from the section's start endpoint, in metres."""

    elevation_m: float | None
    """Elevation in m TAW. ``None`` when the pixel was NoData
    (outside the DHMVII coverage, or a known data hole)."""


def parse_wcs_multipart(payload: bytes) -> bytes:
    """Extract the GeoTIFF blob from a WCS 2.0 multipart/related response.

    The DHMVII GetCoverage response is two MIME parts: a GML metadata
    XML, then the image. We discard the GML — request bbox + TIFF
    dimensions are enough georeferencing for our sample-along-line
    use case.

    Raises ``ValueError`` when no ``image/tiff`` part is present —
    typically because the server returned an ows:ExceptionReport
    (HTTP 200 but an XML error in the body).
    """
    # The email.message parser needs a Content-Type header above the
    # body to locate the boundary. The raw response body starts with
    # the first ``--wcs`` boundary line, so we synthesise that header.
    wrapped = b'Content-Type: multipart/related; boundary="wcs"\r\n\r\n' + payload
    msg = message_from_bytes(wrapped)
    for part in msg.walk():
        if part.get_content_type() == "image/tiff":
            blob = part.get_payload(decode=True)
            if isinstance(blob, bytes):
                return blob
    raise ValueError(
        "DHMVII WCS response had no image/tiff part. Most likely an "
        "ExceptionReport — check the request bbox is inside Flanders."
    )


def _sample_bilinear(img: Image.Image, px: float, py: float) -> float | None:
    """Bilinear sample a float32 TIFF at fractional pixel coordinates.

    Returns ``None`` when any of the four interpolation neighbours
    are NoData — bilinear-averaging a real value with a sentinel
    sentinel would produce nonsense.
    """
    width, height = img.size
    # Clamp to interior so px+1 / py+1 stay valid.
    if px < 0 or py < 0 or px > width - 1 or py > height - 1:
        return None
    x0 = int(px)
    y0 = int(py)
    fx = px - x0
    fy = py - y0
    # Reflect/clamp the +1 neighbours at the image edge so a point
    # exactly on the right or bottom border still samples cleanly.
    x1 = min(x0 + 1, width - 1)
    y1 = min(y0 + 1, height - 1)
    v00 = float(img.getpixel((x0, y0)))
    v10 = float(img.getpixel((x1, y0)))
    v01 = float(img.getpixel((x0, y1)))
    v11 = float(img.getpixel((x1, y1)))
    if any(v == DHMVII_NODATA for v in (v00, v10, v01, v11)):
        return None
    return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11


def sample_geotiff_along_line(
    tiff_bytes: bytes,
    *,
    bbox_min_x: float,
    bbox_max_x: float,
    bbox_min_y: float,
    bbox_max_y: float,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    n_samples: int,
) -> list[SamplePoint]:
    """Sample a GeoTIFF DEM at ``n_samples`` evenly-spaced points along a line.

    Inputs are world coordinates (the section's horizontal CRS) and
    the bbox the TIFF actually covers. The TIFF's pixel size is
    derived from its dimensions + the bbox; the WCS server returns
    integer-pixel rectangles, so the size is always exact.

    ``n_samples`` is the number of points returned (inclusive of both
    endpoints). 200 is typical for a screen-pixel-dense profile; the
    caller picks based on its viewport.
    """
    img = Image.open(BytesIO(tiff_bytes))
    width, height = img.size
    if width == 0 or height == 0:
        return []

    # Pixel size in world metres. The TIFF's native CRS is the same as
    # the bbox CRS by construction (DHMVII WCS preserves CRS through
    # GetCoverage when the subset CRS matches the coverage's native).
    px_w = (bbox_max_x - bbox_min_x) / width
    px_h = (bbox_max_y - bbox_min_y) / height

    out: list[SamplePoint] = []
    dx = end_x - start_x
    dy = end_y - start_y
    length_m = (dx * dx + dy * dy) ** 0.5
    if n_samples < 2 or length_m == 0:
        return []

    for i in range(n_samples):
        t = i / (n_samples - 1)
        wx = start_x + t * dx
        wy = start_y + t * dy
        # World → pixel. Y is flipped: row 0 = bbox_max_y.
        px = (wx - bbox_min_x) / px_w
        py = (bbox_max_y - wy) / px_h
        elev = _sample_bilinear(img, px, py)
        out.append(SamplePoint(along_m=t * length_m, elevation_m=elev))

    return out


class DhmviiSampler(GroundModelLogger):
    """Async client + sampler for the DHMVII (Flanders) DEM.

    Construct once and reuse across requests — keeps the httpx
    AsyncClient warm (HTTP/2 multiplex + connection reuse).
    """

    def __init__(self) -> None:
        """Initialise the underlying httpx client + the inherited logger."""
        super().__init__(__name__)
        # follow_redirects matches the DOV client; HTTP/2 multiplexes
        # parallel requests over one TLS connection, which matters once
        # multiple sections are open in quick succession.
        self._client = httpx.AsyncClient(
            http2=True,
            follow_redirects=True,
            timeout=WCS_SAMPLER_TIMEOUT_SECONDS,
        )

    async def __aenter__(self) -> DhmviiSampler:
        """Context-manager entry — returns self unchanged."""
        return self

    async def __aexit__(self, *_exc: object) -> None:
        """Close the underlying httpx client on context exit."""
        await self._client.aclose()

    async def close(self) -> None:
        """Explicit close for callers that don't use the context manager."""
        await self._client.aclose()

    async def sample_along_line(
        self,
        *,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        n_samples: int = 200,
    ) -> list[SamplePoint]:
        """Sample elevations along a line in EPSG:31370 (BE Lambert 72).

        Returns ``n_samples`` evenly-spaced ``SamplePoint``s from
        start to end. Each carries the along-distance (m) and the
        elevation (m TAW) — or ``None`` for sample points that hit
        DHMVII's NoData sentinel (outside Flanders, missing tile,
        permanent water bodies on hill-shadow renders).

        Raises ``httpx.HTTPError`` on transport failures and
        ``ValueError`` on a malformed WCS response.
        """
        # Bbox = line endpoints' axis-aligned envelope + small pad.
        # Padding ensures the bilinear filter's neighbour pixels are
        # always inside the request rectangle.
        bbox_min_x = min(start_x, end_x) - WCS_BBOX_PADDING_M
        bbox_max_x = max(start_x, end_x) + WCS_BBOX_PADDING_M
        bbox_min_y = min(start_y, end_y) - WCS_BBOX_PADDING_M
        bbox_max_y = max(start_y, end_y) + WCS_BBOX_PADDING_M

        params = {
            "service": "WCS",
            "version": WCS_VERSION,
            "request": "GetCoverage",
            "coverageId": DHMVII_COVERAGE_ID,
            "subset": [
                f"X({bbox_min_x:.3f},{bbox_max_x:.3f})",
                f"Y({bbox_min_y:.3f},{bbox_max_y:.3f})",
            ],
            "format": "image/tiff",
        }
        self.debug(
            f"WCS GetCoverage bbox=({bbox_min_x:.1f},{bbox_min_y:.1f}) → "
            f"({bbox_max_x:.1f},{bbox_max_y:.1f}) for {n_samples} samples"
        )
        resp = await self._client.get(DHMVII_WCS_URL, params=params)
        resp.raise_for_status()
        tiff = parse_wcs_multipart(resp.content)
        self.debug(f"WCS payload {len(resp.content)} B, TIFF {len(tiff)} B")
        return sample_geotiff_along_line(
            tiff,
            bbox_min_x=bbox_min_x,
            bbox_max_x=bbox_max_x,
            bbox_min_y=bbox_min_y,
            bbox_max_y=bbox_max_y,
            start_x=start_x,
            start_y=start_y,
            end_x=end_x,
            end_y=end_y,
            n_samples=n_samples,
        )


def _coverage_id() -> str:
    """Test hook — return the coverage id this sampler queries.

    Exposed so an integration test can pin the constant; not part of
    the public sampler API.
    """
    return DHMVII_COVERAGE_ID


# Run a quick async sample as a script for one-off smoke testing.
# ``python -m groundmodel.infrastructure.dem.dhmvii_sampler``
if __name__ == "__main__":  # pragma: no cover

    async def _main() -> None:
        async with DhmviiSampler() as s:
            pts = await s.sample_along_line(
                start_x=150000,
                start_y=200000,
                end_x=150100,
                end_y=200000,
                n_samples=11,
            )
            for p in pts:
                print(f"{p.along_m:7.1f}  {p.elevation_m}")

    asyncio.run(_main())
