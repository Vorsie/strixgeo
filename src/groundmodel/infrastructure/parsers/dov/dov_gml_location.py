"""Shared GML ``<ligging>/<gml:Point>/<gml:pos>`` location parsing.

Both the CPT (``dov_parser``) and boring (``dov_boring_parser``) DOV
XML parsers extract X/Y/Z from the same 5-step GML walk with the same
failure taxonomy (missing element / empty pos / <2 components /
non-numeric) and the same EPSG:6190-advertised-but-Lambert-72 quirk.
The structural walk lives here; each caller keeps its own failure
CHANNEL (the CPT parser logs warnings and returns Nones, the boring
parser additionally emits NO_COORDINATES / NO_ELEVATION
ValidationIssues).

Pure — no I/O, no logging. Callers format the returned
``failure_detail`` into their own log/issue messages.

Coordinate quirk (verified live): DOV's ``gml:Point`` advertises
srsName ``urn:ogc:def:crs:EPSG::6190`` but the numeric values match
Belgian Lambert 72 (EPSG:31370) — confirmed against the WFS
``X_mL72`` / ``Y_mL72`` properties. Callers treat them as 31370.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

from groundmodel.infrastructure.parsers.dov.dov_common import DOV_GML_TAG_PREFIX


@dataclass(frozen=True)
class GmlPointLocation:
    """Outcome of one GML point-location parse.

    Attributes
    ----------
    x, y : float | None
        Parsed easting / northing (Lambert 72 metres), or ``None`` when
        the XY parse failed (``failure_detail`` set).
    z : float | None
        Parsed surface elevation, or ``None`` when absent or
        non-numeric (see ``z_non_numeric`` / ``n_components``).
    failure_detail : str | None
        Human-readable XY-failure description (``None`` on success).
        Callers prefix it with their own identity ("DOV XML '<name>'",
        "DOV boring '<name>'") when logging.
    n_components : int
        Number of whitespace-separated components in ``<gml:pos>``
        (0 when the pos element never parsed). Lets callers phrase the
        "no Z component" report.
    z_non_numeric : str | None
        The raw third component when it existed but failed ``float()``;
        ``None`` otherwise.
    """

    x: float | None = None
    y: float | None = None
    z: float | None = None
    failure_detail: str | None = None
    n_components: int = 0
    z_non_numeric: str | None = None


def parse_gml_point_location(
    parent_elem: ET.Element,
    location_tag: str = "ligging",
) -> GmlPointLocation:
    """Extract X, Y, Z from ``<location_tag>/<gml:Point>/<gml:pos>``.

    DOV stores coordinates as ``<gml:pos>X Y Z</gml:pos>``
    (space-separated); Z is optional.

    Parameters
    ----------
    parent_elem : ET.Element
        Element containing the location child (the ``<sondering>`` /
        ``<boring>`` root).
    location_tag : str
        Tag name of the location container. DOV uses ``ligging``
        (Dutch: location) across resource types.

    Returns
    -------
    GmlPointLocation
        ``failure_detail`` is ``None`` and ``x``/``y`` are set on
        success; on failure ``failure_detail`` describes which of the
        five steps broke.
    """
    location_elem = parent_elem.find(location_tag)
    if location_elem is None:
        return GmlPointLocation(failure_detail=f"missing <{location_tag}> element")

    point_elem = location_elem.find(f"{DOV_GML_TAG_PREFIX}Point")
    if point_elem is None:
        return GmlPointLocation(
            failure_detail=(
                f"missing <gml:Point> inside <{location_tag}> "
                f"(children: {[c.tag for c in location_elem]})"
            )
        )

    pos_elem = point_elem.find(f"{DOV_GML_TAG_PREFIX}pos")
    if pos_elem is None or not pos_elem.text:
        return GmlPointLocation(failure_detail="empty <gml:pos>")

    parts = pos_elem.text.strip().split()
    if len(parts) < 2:
        return GmlPointLocation(
            failure_detail=f"<gml:pos> only {len(parts)} component(s): {pos_elem.text!r}",
            n_components=len(parts),
        )

    try:
        x = float(parts[0])
        y = float(parts[1])
    except ValueError:
        return GmlPointLocation(failure_detail=f"non-numeric <gml:pos> {pos_elem.text!r}")

    z: float | None = None
    z_non_numeric: str | None = None
    if len(parts) >= 3:
        try:
            z = float(parts[2])
        except ValueError:
            z_non_numeric = parts[2]

    return GmlPointLocation(x=x, y=y, z=z, n_components=len(parts), z_non_numeric=z_non_numeric)
