"""Borehole domain model — physical hole anchoring tests, observations, and samples."""

from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from uuid6 import uuid7


@dataclass
class Borehole:
    """Physical borehole — location anchor for borehole tests, observations, and samples.

    A borehole is *not* a test (CLAUDE.md domain rule); it is a hole drilled
    into the ground, and the tests, samples, and observations it carries are
    separate aggregates linked by foreign key.

    Parameters
    ----------
    name : str
        Human-readable identifier — bore number
        (DOV ``boornummer`` / ``proefnummer`` = test number).
    location_x : float
        X coordinate in the CRS identified by ``epsg``. For DOV that is
        Lambert 72 (EPSG:31370); for other providers it can be UTM, WGS84, or
        any projected CRS — which is exactly why ``epsg`` is stored alongside.
    location_y : float
        Y coordinate in the CRS identified by ``epsg``.
    epsg : int | None
        Horizontal CRS code (e.g. 31370 = Belgian Lambert 72, 4326 = WGS84,
        25831 = UTM 31N). ``None`` only when the source data omitted CRS
        metadata; in that case the coordinates cannot be plotted alongside
        data from other CRSes and the row is flagged at validation time.
    elevation_m : float | None
        Ground-surface elevation in the vertical datum identified by
        ``z_epsg`` (DOV: mTAW, EPSG:5710).
    z_epsg : int | None
        Vertical CRS code for ``elevation_m`` (DOV: 5710 = mTAW). May differ
        from ``epsg`` because horizontal and vertical datums are independent.
    total_depth_m : float | None
        Total drilled depth in metres below the surface reference.
    start_date : date | None
        Drilling start date (DOV ``datum_aanvang`` = start date).
    drill_method : str | None
        Source-vocabulary drilling method summary (DOV ``methode``). Examples
        with English meaning: "spoelboor" = wash-boring, "kerboor" = core drill,
        "Meerdere technieken" = multiple techniques. Detailed per-interval
        methods live in ``DrillSegment`` records.
    borehole_type : str | None
        Free-text borehole type. DOV ``boringtype``, e.g. "Geotechnische boring
        - (dis)continue monstername" = "geotechnical borehole — (dis)continuous
        sampling".
    purpose : str | None
        Free-text purpose of drilling (DOV ``doel`` = purpose). Examples:
        "Geotechnisch onderzoek" = geotechnical investigation, "Geologisch
        onderzoek" = geological investigation.
    municipality : str | None
        Municipality (DOV ``gemeente`` = municipality — sometimes a NIS code,
        sometimes a name). Optional: when absent, downstream code may resolve
        it by reverse-geocoding ``location_x``/``location_y`` rather than
        requiring it on every record.
    executor : str | None
        Drilling executor / contractor (DOV ``uitvoerder`` = executor).
    water_table_depth_m : float | None
        Groundwater depth measured during/after drilling, in metres below surface.
    id : UUID
        Stable identifier; auto-generated.
    """

    name: str
    location_x: float
    location_y: float
    epsg: int | None = None
    elevation_m: float | None = None
    z_epsg: int | None = None
    total_depth_m: float | None = None
    start_date: date | None = None
    drill_method: str | None = None
    borehole_type: str | None = None
    purpose: str | None = None
    municipality: str | None = None
    executor: str | None = None
    water_table_depth_m: float | None = None
    id: UUID = field(default_factory=uuid7)
