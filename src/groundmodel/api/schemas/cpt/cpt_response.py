"""Pydantic schema for a single CPT detail response."""

from uuid import UUID

from pydantic import BaseModel


class CptResponse(BaseModel):
    """Full CPT metadata returned by GET /cpt/{id}.

    Parameters
    ----------
    id:
        Primary key of the CPT record.
    name:
        Human-readable identifier, typically the GEF test_id or filename stem.
    cpt_type:
        Cone type string: "CPTU", "CPTE", "CPTM", or "UNKNOWN".
    location_x:
        Easting in the source coordinate reference system.
    location_y:
        Northing in the source coordinate reference system.
    epsg:
        EPSG code of the source CRS, or None when absent from the file.
    elevation_m:
        Surface elevation in the vertical datum reported by the file (mTAW for
        Belgian files).  Used to convert depth to absolute level (m TAW) on the chart.
        None when absent from the file.
    z_epsg:
        Vertical CRS code for ``elevation_m`` (5710 = mTAW). None when
        ``elevation_m`` is also None.
    pre_drill_m:
        Pre-drill depth in metres.  The CPT measurement starts below this.
    cone_area_ratio:
        Net area ratio (a-value) from MVAR 3; None for CPTE/CPTM.
    max_depth_m:
        Deepest measurement depth in metres.
    n_rows:
        Number of data rows stored in the series table.
    """

    id: UUID
    name: str
    cpt_type: str
    location_x: float
    location_y: float
    epsg: int | None
    elevation_m: float | None
    z_epsg: int | None
    pre_drill_m: float
    cone_area_ratio: float | None
    max_depth_m: float | None
    n_rows: int | None
