"""Defensive helpers for PostGIS spatial queries (debt #16).

Why this module exists
----------------------
Each CPT / borehole row stores its location in the source CRS (Lambert
72 for DOV, RD New for future BRO imports, etc.) — the ORM column is
``Geometry("POINT")`` with NO declared SRID, so a single column can
hold rows from multiple CRSes within one project. PostGIS itself
hard-errors on ``ST_Within(geom_3170, geom_4326)`` — different SRIDs
in one operator call — so a naive bbox query like

    select(CptOrm).where(func.ST_Within(CptOrm.location, user_bbox))

will (a) work fine when every row's SRID matches the bbox's SRID, (b)
crash with a vague "Operation on mixed SRID geometries" error the
first time a project mixes Belgian + Dutch rows. The dev who wrote the
query won't see this in testing, because their fixtures are all one
CRS.

The helpers here force every spatial filter through an explicit
``ST_Transform`` so the column side and the user-supplied side always
end up in the same SRID before the predicate evaluates. They're the
ONLY supported path for new spatial queries in this codebase — adding
a raw ``ST_Within`` / ``ST_DWithin`` call without going through these
helpers is a review-blocker.

Constants live here (not in ``dov_common.py``) because they're
GIS-domain values, not DOV-specific.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import ColumnElement, func
from sqlalchemy.sql.functions import Function

# Canonical CRS for cross-row spatial comparisons. WGS84 (EPSG 4326)
# chosen because:
#
#   * Incoming user bboxes — DOV import, future map-click queries —
#     are already in WGS84 by convention.
#   * Every CRS we accept has a well-defined transformation TO 4326
#     (Lambert 72 / RD New / future BRO / G3Dv3 imports all roundtrip
#     cleanly via pyproj).
#   * PostGIS ships the 4326 grid out of the box; no PROJ data files
#     to bundle.
#
# Bumping this constant breaks every spatial query in flight. Don't.
CANONICAL_QUERY_EPSG = 4326

# WGS84 sanity range — bboxes outside these bounds aren't a valid
# geographic query; the helper rejects them up front to surface
# CRS-mixed inputs (e.g. someone passing Lambert72 metres as
# WGS84 degrees).
_MAX_LATITUDE_DEG = 90.0
_MIN_LATITUDE_DEG = -90.0
_MAX_LONGITUDE_DEG = 180.0
_MIN_LONGITUDE_DEG = -180.0


def transformed_bbox_filter(
    geom_column: ColumnElement[object],
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    bbox_epsg: int = CANONICAL_QUERY_EPSG,
) -> Function[Any]:
    """Build a ``ST_Within(ST_Transform(col, bbox_epsg), ST_MakeEnvelope(...))`` filter.

    The column side is wrapped in ``ST_Transform`` to ``bbox_epsg`` so
    rows in different source CRSes (Lambert 72 + RD New + ...) all
    project into the same SRID before the spatial test runs. The user-
    supplied bbox is built with the same SRID via ``ST_MakeEnvelope``,
    so the predicate never sees mismatched SRIDs.

    Parameters
    ----------
    geom_column : ColumnElement
        The ORM geometry column to filter on (e.g. ``CptOrm.location``).
        May contain rows in any source CRS as long as each row carries
        a valid SRID (which the import pipeline guarantees — see
        ``_make_location`` on the bundle restore path).
    west, south, east, north : float
        Bbox corners. Validated against ``bbox_epsg``'s sanity range —
        currently only the WGS84 range is enforced, but the helper
        rejects any bbox that lands outside it when ``bbox_epsg``
        equals :data:`CANONICAL_QUERY_EPSG`.
    bbox_epsg : int
        SRID for both the bbox AND the transformed column. Defaults to
        :data:`CANONICAL_QUERY_EPSG` (WGS84) — pass a different value
        only when both bbox and target CRS need to differ from WGS84
        (rare; we don't have a use case yet).

    Returns
    -------
    Function[Any]
        SQLAlchemy boolean SQL function call usable inside ``.where(...)``.

    Raises
    ------
    ValueError
        When ``west >= east``, ``south >= north``, or any corner falls
        outside the WGS84 sanity range while ``bbox_epsg`` is WGS84.
    """
    if west >= east:
        raise ValueError(f"bbox west ({west}) must be less than east ({east})")
    if south >= north:
        raise ValueError(f"bbox south ({south}) must be less than north ({north})")
    if bbox_epsg == CANONICAL_QUERY_EPSG:
        for label, value, lo, hi in (
            ("west", west, _MIN_LONGITUDE_DEG, _MAX_LONGITUDE_DEG),
            ("east", east, _MIN_LONGITUDE_DEG, _MAX_LONGITUDE_DEG),
            ("south", south, _MIN_LATITUDE_DEG, _MAX_LATITUDE_DEG),
            ("north", north, _MIN_LATITUDE_DEG, _MAX_LATITUDE_DEG),
        ):
            if value < lo or value > hi:
                raise ValueError(
                    f"bbox {label} ({value}) outside WGS84 range [{lo}, {hi}] — "
                    "looks like a CRS mix-up. Re-project the bbox to WGS84 "
                    "before passing it in, or pass an explicit bbox_epsg."
                )

    return func.ST_Within(
        func.ST_Transform(geom_column, bbox_epsg),
        func.ST_MakeEnvelope(west, south, east, north, bbox_epsg),
    )


def transformed_distance_filter(
    geom_column: ColumnElement[object],
    *,
    centre_longitude: float,
    centre_latitude: float,
    radius_metres: float,
) -> Function[Any]:
    """Build a "within N metres of (lon, lat)" filter using PostGIS geography.

    Uses the ``geography`` type cast on both sides — geography distance
    is in metres regardless of source SRID, so this is the right
    operator for "give me everything within 500 m of the user's pin"
    queries. The cast forces a transform to 4326 internally, which
    sidesteps the mixed-SRID risk entirely.

    Parameters
    ----------
    geom_column : ColumnElement
        Source geometry column.
    centre_longitude, centre_latitude : float
        Centre point in WGS84 decimal degrees. Validated against the
        WGS84 sanity range.
    radius_metres : float
        Search radius. Must be strictly positive.

    Raises
    ------
    ValueError
        On invalid centre coordinates or non-positive radius.
    """
    if not _MIN_LONGITUDE_DEG <= centre_longitude <= _MAX_LONGITUDE_DEG:
        raise ValueError(
            f"centre_longitude ({centre_longitude}) outside WGS84 range "
            f"[{_MIN_LONGITUDE_DEG}, {_MAX_LONGITUDE_DEG}] — pass WGS84 decimal degrees."
        )
    if not _MIN_LATITUDE_DEG <= centre_latitude <= _MAX_LATITUDE_DEG:
        raise ValueError(
            f"centre_latitude ({centre_latitude}) outside WGS84 range "
            f"[{_MIN_LATITUDE_DEG}, {_MAX_LATITUDE_DEG}] — pass WGS84 decimal degrees."
        )
    if radius_metres <= 0:
        raise ValueError(f"radius_metres ({radius_metres}) must be positive")

    column_geog = func.cast(geom_column, type_=Geography)
    centre_geog = func.cast(
        func.ST_SetSRID(
            func.ST_MakePoint(centre_longitude, centre_latitude),
            CANONICAL_QUERY_EPSG,
        ),
        type_=Geography,
    )
    return func.ST_DWithin(column_geog, centre_geog, radius_metres)


def assert_consistent_epsg(epsg_values: Iterable[int | None]) -> int | None:
    """Return the single shared EPSG of an iterable, or raise on mismatch.

    Use this BEFORE constructing a spatial query when the caller wants
    to bail loudly on mixed-CRS input rather than rely on PostGIS's
    error message later. Skips ``None`` values (rows that legitimately
    lack a CRS — typically because they came from a GEF / DOV file
    that didn't tag one). Returns ``None`` when every input was None
    OR when the iterable was empty (caller can decide whether that's
    a problem).

    Parameters
    ----------
    epsg_values : Iterable[int | None]
        EPSG integers (and / or ``None``) — typically pulled from a
        ``[row.epsg for row in rows]`` list.

    Returns
    -------
    int | None
        The single non-None EPSG shared by every value, or ``None``
        when every input was ``None`` / the iterable was empty.

    Raises
    ------
    ValueError
        When two or more distinct non-None EPSGs appear.
    """
    seen: set[int] = set()
    for epsg in epsg_values:
        if epsg is None:
            continue
        seen.add(epsg)
    if len(seen) > 1:
        raise ValueError(
            f"Mixed EPSGs in input: {sorted(seen)!r}. Spatial queries on "
            "mixed-CRS sets must use ``transformed_bbox_filter`` / "
            "``transformed_distance_filter`` which ST_Transform internally."
        )
    return next(iter(seen), None)
