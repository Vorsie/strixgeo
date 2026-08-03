"""Translate GEF coordinate-system codes into EPSG codes.

``#XYID=`` and ``#ZID=`` carry codes from the GEF codelist, not EPSG codes.
The two namespaces overlap in shape (five digits) but not in meaning: GEF
32000 is Belgian Lambert 72, whose EPSG code is 31370. Storing the GEF code
in an ``epsg`` column makes every EPSG-keyed consumer — PostGIS ``SRID=``,
the DEM provider factory, the section-CRS allowlist, the Virtuele Boring
overlay filter — quietly disagree with the same physical sounding imported
through the DOV XML path.

These helpers are the single translation point. They are deliberately
allowlist-only: a code that is neither a known GEF code nor a CRS this
platform ships support for returns ``None`` rather than a plausible-looking
guess, so the caller refuses the import instead of persisting a wrong SRID.
"""

from __future__ import annotations

from groundmodel.infrastructure.codelists.horizontal_crs import (
    SUPPORTED_SECTION_HORIZONTAL_EPSG,
)
from groundmodel.infrastructure.codelists.vertical_crs import VERTICAL_DATUM_LABEL
from groundmodel.infrastructure.parsers.cpt.gef.gef_constants import (
    GEF_XY_CODE_TO_EPSG,
    GEF_Z_CODE_TO_EPSG,
)


def horizontal_epsg_from_gef_code(code: int | None) -> int | None:
    """Return the horizontal EPSG code for a GEF ``#XYID`` code.

    Parameters
    ----------
    code : int | None
        The raw first field of ``#XYID=`` exactly as the file wrote it, or
        ``None`` when the field was absent/empty.

    Returns
    -------
    int | None
        The EPSG code when ``code`` is a known GEF coordinate-system code
        (see :data:`GEF_XY_CODE_TO_EPSG`) **or** already a supported EPSG
        code — some non-DOV writers put a true EPSG in this field, and no
        GEF code collides with one. ``None`` for anything else, including
        ``None`` input: an unidentifiable CRS must stay unidentified.
    """
    if code is None:
        return None
    translated = GEF_XY_CODE_TO_EPSG.get(code)
    if translated is not None:
        return translated
    if code in SUPPORTED_SECTION_HORIZONTAL_EPSG:
        return code
    return None


def vertical_epsg_from_gef_code(code: int | None) -> int | None:
    """Return the vertical EPSG code for a GEF ``#ZID`` code.

    Parameters
    ----------
    code : int | None
        The raw first field of ``#ZID=`` exactly as the file wrote it, or
        ``None`` when the field was absent/empty.

    Returns
    -------
    int | None
        The EPSG code when ``code`` is a known GEF vertical-datum code (see
        :data:`GEF_Z_CODE_TO_EPSG`) **or** already a vertical EPSG the
        platform labels. ``None`` otherwise — a Z with an unknown datum is
        rendered as a bare ``"m"``, never as a datum we cannot confirm.
    """
    if code is None:
        return None
    translated = GEF_Z_CODE_TO_EPSG.get(code)
    if translated is not None:
        return translated
    if code in VERTICAL_DATUM_LABEL:
        return code
    return None
