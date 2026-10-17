"""Pure GeoTIFF line-sampling helpers + the DHMVII multipart splitter.

The cross-section view needs an elevation profile: a list of
``(along_m, elevation_m)`` pairs running from the section's start
endpoint to its end. The HTTP/WCS/cache side of that lives on
:class:`WcsDemProvider.sample_along_line` (debt #234 — the former
``DhmviiSampler`` second HTTP stack was retired in its favour); this
module keeps the PURE pieces:

* :func:`parse_wcs_multipart` — split DHMVII's multipart/related
  GetCoverage body into the raw GeoTIFF blob.
* :func:`sample_geotiff_along_line` / :func:`_sample_bilinear` —
  bilinear-sample a float32 GeoTIFF at N evenly-spaced points along a
  line. ``is_nodata`` is parameterisable so the AHN4 threshold rule
  plugs in; the default stays DHMVII's ``-9999`` sentinel.

GeoTIFF georeferencing facts (verified live 2026-05-11):

* Pixel size = bbox_width / tiff_width (exact — the WCS server
  returns integer-pixel rectangles).
* TIFF row 0 corresponds to bbox max-Y (north-up), row N-1 to min-Y.

tifffile + numpy would be lighter but Pillow ships pre-built wheels on
every platform and reads float32 TIFFs natively. The hot path here is
N bilinear lookups (where N ≤ 2000) — not worth the numpy cost.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from email import message_from_bytes
from io import BytesIO
from typing import cast

from PIL import Image

from groundmodel.infrastructure.dem.dem_wcs_constants import DHMVII_NODATA


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


def _sample_bilinear(
    img: Image.Image,
    px: float,
    py: float,
    is_nodata: Callable[[float], bool] | None = None,
) -> float | None:
    """Bilinear sample a float32 TIFF at fractional pixel coordinates.

    Returns ``None`` when any of the four interpolation neighbours
    are NoData — bilinear-averaging a real value with a sentinel
    would produce nonsense.

    Parameters
    ----------
    img : Image.Image
        Decoded float32 TIFF.
    px, py : float
        Fractional pixel coordinates (row 0 = top).
    is_nodata : Callable[[float], bool] | None
        Per-source NoData test. ``None`` (default) keeps the original
        DHMVII ``-9999`` sentinel-equality rule.
    """
    if is_nodata is None:
        is_nodata = _dhmvii_is_nodata
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
    # The DHMVII raster is single-band float, so ``getpixel`` returns a scalar;
    # the tuple / None arms of its return type belong to multi-band / empty images.
    v00 = float(cast(float, img.getpixel((x0, y0))))
    v10 = float(cast(float, img.getpixel((x1, y0))))
    v01 = float(cast(float, img.getpixel((x0, y1))))
    v11 = float(cast(float, img.getpixel((x1, y1))))
    if any(is_nodata(v) for v in (v00, v10, v01, v11)):
        return None
    return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11


def _dhmvii_is_nodata(value: float) -> bool:
    """Default NoData rule — DHMVII's ``-9999`` sentinel equality."""
    return value == DHMVII_NODATA


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
    is_nodata: Callable[[float], bool] | None = None,
) -> list[SamplePoint]:
    """Sample a GeoTIFF DEM at ``n_samples`` evenly-spaced points along a line.

    Inputs are world coordinates (the section's horizontal CRS) and
    the bbox the TIFF actually covers. The TIFF's pixel size is
    derived from its dimensions + the bbox; the WCS server returns
    integer-pixel rectangles, so the size is always exact.

    ``n_samples`` is the number of points returned (inclusive of both
    endpoints). 200 is typical for a screen-pixel-dense profile; the
    caller picks based on its viewport. ``is_nodata`` selects the
    source's NoData rule (default: DHMVII sentinel).
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
        elev = _sample_bilinear(img, px, py, is_nodata)
        out.append(SamplePoint(along_m=t * length_m, elevation_m=elev))

    return out
