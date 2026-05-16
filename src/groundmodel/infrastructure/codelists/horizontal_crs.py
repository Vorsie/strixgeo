"""Supported horizontal CRS for cross-sections + display labels.

A cross-section's along-distance is a Euclidean distance between its
projected endpoints, expressed in the section's horizontal CRS units.
That is only meaningful when the CRS is **projected and metric**. If a
section is created in a geographic CRS (e.g. EPSG:4326 — degrees), the
along-distance comes out at ~1e-4 the expected scale and every
exported geometry (DXF, Plaxis 2D) is silently garbage (debt #31).

The desktop has no CRS picker — a section inherits
``project.default_horizontal_epsg`` or, failing that, the imported
investigations' CRS. DOV always supplies Belgian Lambert 72, so the
common path is safe; a GEF-only project with no project default can
fall back to WGS84 degrees and hit exactly this trap.

This module is the single source of truth for "which horizontal CRS
can a section be created / exported in". It mirrors the frontend's
``utils/horizontalCrs.ts`` — keep both lists in sync when adding a
country. As with ``vertical_crs.py``, only list CRS we have actually
shipped data paths for; a wrong entry is worse than a missing one.
"""

from __future__ import annotations

# Projected, metric horizontal CRS a cross-section may use.
#
# 31370 — Belgian Lambert 72            (BE national; every DOV record)
# 3812  — ETRS89 / Belgian Lambert 2008 (BE modern; some GEF files)
# 28992 — Amersfoort / RD New           (NL national; BRO/DINO)
# 25831 — ETRS89 / UTM zone 31N         (BE/NL EU-harmonised metric)
# 32631 — WGS 84 / UTM zone 31N         (occasional GEF/survey export)
#
# All five are metre-based projected systems, so a Euclidean
# along-section distance is physically correct. Geographic CRS
# (4326, 4258, …) are intentionally absent — they are the failure
# mode this allowlist exists to reject.
SUPPORTED_SECTION_HORIZONTAL_EPSG: frozenset[int] = frozenset({31370, 3812, 28992, 25831, 32631})

# Human-readable labels for messages / tooltips. Mirrors the
# frontend's ``HCRS_LABEL_BY_EPSG``.
HORIZONTAL_CRS_LABEL: dict[int, str] = {
    31370: "Belgian Lambert 72 (EPSG:31370)",
    3812: "Belgian Lambert 2008 (EPSG:3812)",
    28992: "Amersfoort / RD New (EPSG:28992)",
    25831: "ETRS89 / UTM 31N (EPSG:25831)",
    32631: "WGS 84 / UTM 31N (EPSG:32631)",
}


def is_supported_section_crs(epsg: int | None) -> bool:
    """Return whether ``epsg`` is a metric CRS valid for a section.

    Parameters
    ----------
    epsg : int | None
        The candidate horizontal EPSG code. ``None`` is unsupported —
        a section with no CRS cannot have a meaningful along-distance.

    Returns
    -------
    bool
        ``True`` when ``epsg`` is in
        :data:`SUPPORTED_SECTION_HORIZONTAL_EPSG`.
    """
    return epsg is not None and epsg in SUPPORTED_SECTION_HORIZONTAL_EPSG


def horizontal_crs_label(epsg: int | None) -> str:
    """Return a human-readable label for a horizontal EPSG.

    Parameters
    ----------
    epsg : int | None
        The horizontal EPSG code, or ``None``.

    Returns
    -------
    str
        A known label, or ``"EPSG:<n>"`` for an unmapped code, or
        ``"unknown CRS"`` when ``epsg`` is ``None``. Honest over
        wrong — never claim a CRS we can't identify.
    """
    if epsg is None:
        return "unknown CRS"
    return HORIZONTAL_CRS_LABEL.get(epsg, f"EPSG:{epsg}")
