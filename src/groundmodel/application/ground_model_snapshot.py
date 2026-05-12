"""Input contract for the ground-model exporters.

``GroundModelSnapshot`` is the typed value the Phase 4 + 5
exporters (DXF, Plaxis, D-Sheet, GeoStudio) consume. The
application layer assembles it from the DB before calling any
exporter — the exporter never touches SQLAlchemy.

Design notes:

* The snapshot is project-wide but section-scoped at the layer
  level: DXF + Plaxis exports are typically produced per
  cross-section, and the geological model's formation contacts
  project onto each section line independently. ``layers`` carries
  the projected layer geometry ready for write-out.
* Per-layer parameters (unit weights, strengths, Ic-derived
  values) are intentionally NOT here in Phase 4. The MVP gate is
  geometry-only; Phase 5 either extends ``LayerGeometry`` with
  optional parameter fields or adds a parallel
  ``ParameterAssignment`` slice. Either way callers pay no cost
  today for absence.
* ``crs_epsg`` is the project's canonical horizontal CRS. Mixed-
  CRS projects (debt #38) need a transform pass upstream of
  snapshot assembly; the snapshot itself is mono-CRS.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID


@dataclass(frozen=True)
class LayerGeometry:
    """One layer (formation top → base) at one investigation column.

    Attributes
    ----------
    formation_name : str
        Display label — what the engineer sees in the export
        (Plaxis soil layer name, DXF layer name).
    formation_code : str | None
        Stable code (e.g. ``"BmK"`` for Boom Klei). Optional in v1;
        downstream tools that key off codes (Plaxis material
        libraries) use this when present, fall back to ``name``.
    top_depth_m : float
        Depth (m below surface) where the layer begins. Always
        non-negative; surface contact = 0.0.
    base_depth_m : float
        Depth (m below surface) where the layer ends. Strictly
        greater than ``top_depth_m`` for any layer with
        non-degenerate thickness; equal-depth degenerate layers
        skip from snapshot assembly.
    location_x : float
        Easting in the snapshot's CRS.
    location_y : float
        Northing in the snapshot's CRS.
    surface_elevation_m : float | None
        Surface elevation (m above the project's vertical datum)
        at this column. ``None`` when the investigation lacks a
        manually-entered or DOV-provided Z.
    """

    formation_name: str
    formation_code: str | None
    top_depth_m: float
    base_depth_m: float
    location_x: float
    location_y: float
    surface_elevation_m: float | None


@dataclass(frozen=True)
class GroundModelSnapshot:
    """Materialised geological-model + investigation geometry for one project.

    Consumed by every concrete exporter via the
    ``BaseExporter.export`` ABC method. The application layer
    produces the snapshot in one place
    (``application/build_ground_model_snapshot.py``, future) so
    each exporter sees a consistent shape.

    Attributes
    ----------
    project_id : UUID
        Source project id — written into export metadata where
        the target format supports it (DXF $REVDAT, Plaxis project
        comment, etc.).
    project_name : str
        Display name — appears as the title in formats that show
        one.
    crs_epsg : int
        EPSG code of the horizontal CRS. All ``LayerGeometry``
        coordinates are in this CRS.
    layers : list[LayerGeometry]
        Per-investigation, per-formation layer rows. Order is
        not significant — exporters that need sorting (top-down,
        along-section) sort locally.
    """

    project_id: UUID
    project_name: str
    crs_epsg: int
    layers: list[LayerGeometry] = field(default_factory=list)
