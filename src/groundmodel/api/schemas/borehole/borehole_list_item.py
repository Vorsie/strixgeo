"""Pydantic schema for a borehole summary item in list responses."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BoreholeListItem(BaseModel):
    """Lightweight borehole summary returned by GET /borehole/.

    Carries only the fields the desktop app needs to render the sidebar list
    + the map markers + the "needs Z" badge — drill segments / field log /
    observations / samples / lab tests are NOT included. Consumers fetch
    the full tree via ``GET /borehole/{id}`` only when the user opens a
    detail view.

    Parameters
    ----------
    id:
        Primary key of the borehole record.
    name:
        Human-readable identifier (DOV ``identificatie`` / ``boornummer``).
    test_id:
        Source-side identifier the borehole was imported under
        (DOV ``boornummer``). Same as ``name`` for DOV imports today;
        kept distinct so future GEF / AGS borehole imports can carry their
        own provider id without overloading ``name``.
    location_x, location_y:
        Native-CRS easting / northing.
    epsg:
        Source CRS for the location columns. ``None`` when the import
        couldn't determine a CRS — frontend should hide the marker in
        that rare case.
    elevation_m:
        Surface elevation in the source vertical datum (mTAW for DOV).
        ``None`` when both the boring XML and the WFS row omitted Z. The
        UI uses null-elevation as the trigger for the Phase 3a
        "manual-Z-entry" badge; do NOT default to 0.0 in the response.
    z_epsg:
        Vertical CRS code (5710 = mTAW). ``None`` when ``elevation_m`` is
        also ``None``.
    elevation_source:
        Provenance of ``elevation_m`` — ``"dov"`` / ``"gef"`` /
        ``"manual"`` / ``"none"``. Surfaced in the list payload so the
        sidebar can render a tiny "(DOV)" / "(manual)" tag next to the
        Z value without firing GET /borehole/{id} per row. Debt #8.
    drill_method:
        Source-vocabulary drill-method summary (DOV WFS ``methode``:
        ``"Meerdere technieken"``, ``"kernboring"``, ...). Used by the
        sidebar to colour-code or icon-discriminate borehole types.
    borehole_type:
        Source-vocabulary borehole purpose/type (DOV ``boringtype``:
        ``"Geotechnische boring"``, ...).
    total_depth_m:
        Header-level total depth, ``None`` when the source omitted it.
    start_date:
        Date the borehole was drilled (``datum_aanvang``). ``None`` when
        the source omitted it. Useful for sorting the sidebar by recency.
    n_drill_segments, n_field_log_intervals:
        Denormalised counts (atomically written with the parent — see
        ``BoreholeOrm`` docstring). The frontend uses them to show
        ``"5 drill segments, 12 field log entries"``-style badges
        without firing a detail fetch per row.
    lab_series_count:
        Raw lab tests (oedometer / triaxial series) on the borehole's
        samples; the Data stage shows a marker when > 0 (owner 2026-09-30).
        Additive: ``GET /borehole/`` fills it (0 for none); an answer that
        does not count (the elevation PATCH) leaves it ``None``.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    test_id: str
    location_x: float
    location_y: float
    epsg: int | None
    elevation_m: float | None
    z_epsg: int | None
    elevation_source: str
    drill_method: str | None
    borehole_type: str | None
    total_depth_m: float | None
    start_date: date | None
    n_drill_segments: int | None
    n_field_log_intervals: int | None
    lab_series_count: int | None = None
