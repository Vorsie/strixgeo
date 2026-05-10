"""Default vertical CRS lookup keyed by horizontal CRS.

Used when a caller (today: the manual-elevation PATCH endpoints) needs a
vertical EPSG but the user didn't pick one. The desktop UI doesn't expose a
CRS picker, so the right datum is inferred from the record's horizontal CRS:
each country's standard horizontal datum has a canonical pairing with a
national vertical datum.

This table grows as the platform expands beyond Belgium. The first non-BE
source on the roadmap is the Dutch BRO (NL) — adding it is a one-line entry
here, not a router change.
"""

from __future__ import annotations

# Canonical horizontal-EPSG → vertical-EPSG pairs.
#
# 31370 (Belgian Lambert 72)  → 5710 (mTAW, Belgian standard ordnance datum)
# 28992 (Amersfoort / RD New) → 5709 (NAP,  Normaal Amsterdams Peil — NL)
#
# Add new entries when their first source lands; do NOT pre-populate
# countries we haven't shipped data for (a wrong default does worse than a
# missing one — it silently mislabels the datum on every saved row).
DEFAULT_VERTICAL_EPSG: dict[int, int] = {
    31370: 5710,
    28992: 5709,
}

# Final fallback when the horizontal CRS is unknown or unmapped. mTAW stays
# the default while the platform is Belgium-only; revisit the day the first
# truly multi-country deployment hits.
FALLBACK_VERTICAL_EPSG = 5710


def default_vertical_epsg(horizontal_epsg: int | None) -> int:
    """Return the canonical vertical EPSG for the given horizontal EPSG.

    Parameters
    ----------
    horizontal_epsg : int | None
        Horizontal CRS code on the record being edited. ``None`` means the
        record has no usable horizontal CRS (rare — rows without an EPSG
        tend to fail import); we fall back to mTAW so the column at least
        receives a non-null value.

    Returns
    -------
    int
        Vertical EPSG code to store alongside the manually-entered elevation.
    """
    if horizontal_epsg is None:
        return FALLBACK_VERTICAL_EPSG
    return DEFAULT_VERTICAL_EPSG.get(horizontal_epsg, FALLBACK_VERTICAL_EPSG)
