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
class FormationDisplay:
    """Display metadata for one geological formation referenced in
    the snapshot's layer rows.

    Carried alongside the layers so exporters don't need a second
    lookup against the ``geological_formation`` table to know each
    formation's stratigraphic order or display colour. Only
    formations that have at least one ``LayerGeometry`` row in
    ``layers`` are included — exporters never emit "empty"
    materials.

    Attributes
    ----------
    name : str
        Display name (e.g. ``"Boom Klei"``). Matches the
        ``formation_name`` on every ``LayerGeometry`` row that
        belongs to this formation.
    code : str | None
        Short stable code (e.g. ``"BmK"``). Same value as on the
        layer rows. Optional in v1; downstream tools that key off
        codes (Plaxis material library) fall back to ``name``.
    display_order : int
        Stratigraphic-age axis. Lower = older (deeper in the
        column). Exporters that emit a globally ordered layer
        stack (Plaxis 3D's borehole+soillayer model) sort
        DESCENDING by this so the youngest formation lands as
        Plaxis layer 0 (topmost in the soil column).
    color : str
        Hex colour string (e.g. ``"#ff8800"``). DXF / map exporters
        map this to their nearest palette entry; Plaxis ignores it.
    nad_class : int | None
        Belgian NAD packing class (1..31) on a GEOTECHNICAL unit;
        ``None`` on a geological formation, a litho unit, and an
        unclassified geotech skeleton band. Together with
        ``litho_main_soil_code`` this is the machine-usable identity a
        downstream tool maps onto a material definition — see
        ``infrastructure/exporters/unit_identifier.py`` (debt #104).
    litho_main_soil_code : str | None
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN) on a
        litho or geotech unit; ``None`` on a geological formation.
    formation_id : UUID | None
        Source ``geological_formation`` row id. Carried so the exported
        mapping table can name the one globally unique handle on a unit
        — two units legitimately share a NAD class and a soil. ``None``
        on fixtures built before debt #104; the mapping table then
        renders the absent marker rather than a wrong id.
    """

    name: str
    code: str | None
    display_order: int
    color: str
    # Optional with null defaults so fixtures that construct
    # FormationDisplay positionally stay valid — additive (debt #104).
    nad_class: int | None = None
    litho_main_soil_code: str | None = None
    formation_id: UUID | None = None


@dataclass(frozen=True)
class GroundModelSnapshot:
    """Materialised geological-model + investigation geometry for one project.

    Consumed by every concrete project exporter via the
    ``ProjectExporter.export`` ABC method. The application layer
    produces the snapshot in one place
    (``application/build_ground_model_snapshot.py``) so each
    exporter sees a consistent shape.

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
    formations : list[FormationDisplay]
        Display metadata for every formation present in
        ``layers``. Carries the stratigraphic order Plaxis 3D and
        other globally-ordered exporters need. Empty when no
        layers are present.
    """

    project_id: UUID
    project_name: str
    crs_epsg: int
    layers: list[LayerGeometry] = field(default_factory=list)
    formations: list[FormationDisplay] = field(default_factory=list)
