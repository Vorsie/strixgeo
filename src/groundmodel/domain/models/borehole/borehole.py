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
        X coordinate in the source CRS (DOV: Lambert 72, EPSG:31370).
    location_y : float
        Y coordinate in the source CRS.
    elevation_m : float | None
        Ground-surface elevation in mTAW or other source vertical datum.
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
        sometimes a name).
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
    elevation_m: float | None = None
    total_depth_m: float | None = None
    start_date: date | None = None
    drill_method: str | None = None
    borehole_type: str | None = None
    purpose: str | None = None
    municipality: str | None = None
    executor: str | None = None
    water_table_depth_m: float | None = None
    id: UUID = field(default_factory=uuid7)
