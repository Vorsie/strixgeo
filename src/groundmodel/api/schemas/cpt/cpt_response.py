"""Pydantic schema for a single CPT detail response."""

from typing import Any
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
    elevation_source:
        Where ``elevation_m`` came from — ``"dov"``, ``"gef"``,
        ``"manual"``, or ``"none"``. The desktop frontend renders this
        as a small provenance badge next to the Z value so engineers
        can tell DOV-published Z from their own corrections (debt #8).
    pre_drill_m:
        Pre-drill depth in metres.  The CPT measurement starts below this.
    cone_area_ratio:
        Net area ratio (a-value) from MVAR 3; None for CPTE/CPTM.
    water_depth_m:
        Depth to groundwater below ground surface in metres (positive down),
        or None when none is recorded — every DOV-imported CPT is in that
        state and its consumers fall back to the project-wide assumption.
    water_depth_source:
        Where ``water_depth_m`` came from — ``"gef"`` (parsed from
        ``#MEASUREMENTVAR= 14``) or ``"engineer"`` (typed in the Parameters
        inspector, and NOT overwritten by a later re-import). None when no
        water table is recorded.
    max_depth_m:
        Deepest measurement depth in metres.
    n_rows:
        Number of data rows stored in the series table.
    import_provenance:
        How a CPT that did not come from a data file was produced (the PDF
        digitiser: ``source = "pdf-digitised"``, report file + sha, pages,
        calibration, digitiser version, clipped points). None for GEF / DOV.
    """

    id: UUID
    name: str
    cpt_type: str
    location_x: float
    location_y: float
    epsg: int | None
    elevation_m: float | None
    z_epsg: int | None
    elevation_source: str
    pre_drill_m: float
    cone_area_ratio: float | None
    # Additive (docs/api.md "Additive only"): default None so any caller that
    # builds a CptResponse without these keeps working.
    water_depth_m: float | None = None
    water_depth_source: str | None = None
    max_depth_m: float | None
    n_rows: int | None
    import_provenance: dict[str, Any] | None = None
