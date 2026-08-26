"""Input contract for section exporters that need CLOSED 2-D geometry.

Where ``SectionSnapshot`` carries formation *picks* — points an
exporter threads into polylines — this module carries the section's
filled **areas**: one closed polygon per drawn body-in-a-gap, in the
section's own along-distance / elevation frame.

Why a second contract exists
----------------------------
The existing section exporters (DXF, Plaxis 2D, PDF) all consume
contacts. DXF draws a polyline per formation; Plaxis places one
borehole per column and lets PLAXIS interpolate between them. Neither
needs to know what the ground looks like BETWEEN two columns.

D-Stability has no borehole concept — its geometry IS a set of closed
soil-layer polygons — so it needs the answer the section editor already
shows on screen: the partition fill. That fill is computed in the
renderer (``computeSectionFill``), so the polygons reach the backend
the same way the 3-D voxel build receives them, as a POSTed
``SectionPartitionInput``. This module is the resolved form of that
payload: gap-local fractions converted to absolute along-distances,
and each region's formation resolved to its export identity.

The engine's own coordinates, resolved
--------------------------------------
A ``RegionInput`` polygon point is ``(fraction, elevation_m)`` where
``fraction`` runs 0..1 across ONE gap. A ``SectionPolygon`` point is
``(along_m, elevation_m)`` — absolute in the section frame, so the same
polygon can be handed to any target tool without knowing which gap it
came from. The conversion is linear between the two columns' own
``along_m``, which is exactly what the 3-D voxel builder does when it
maps fractions onto the line between consecutive columns; a D-Stability
export and a 3-D build of the same section therefore describe the same
ground.

Per-layer design parameters are absent by design — see
``GroundModelSnapshot`` for the same Phase 4 / Phase 5 split. The units
here carry CHARACTERISATION only (NAD class, soil code, name).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID


@dataclass(frozen=True)
class SectionPolygonUnit:
    """Export identity + characterisation of one unit drawn on a section.

    Holds data only — no behaviour — so it does not inherit
    ``GroundModelLogger`` (CLAUDE.md "Logging via inheritance").

    Attributes
    ----------
    formation_id : UUID
        Source ``geological_formation`` row id. The only globally
        unique handle on the unit; carried so a downstream script can
        tell apart two units that share a NAD class and a soil code.
    name : str
        The unit's name as the engineer sees it in Strix.
    nad_class : int | None
        Belgian NAD packing class 1..31 on a GEOTECHNICAL unit;
        ``None`` on a geological formation, a litho unit, and an
        unclassified geotech skeleton band. Pass-through from
        ``geological_formation.nad_class`` — not derived here.
    litho_main_soil_code : str | None
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN) on a
        litho or geotech unit; ``None`` on a geological formation.
        Pass-through from ``geological_formation.litho_main_soil_code``.
    color : str
        Hex colour string (e.g. ``"#ff8800"``) as shown in the editor.
        Targets that carry a per-soil colour reuse it so the exported
        model reads like the section the engineer drew.
    display_order : int
        Editor sort hint. Exporters emit units in this order so the
        user's preferred top-to-bottom sequence carries through.
    """

    formation_id: UUID
    name: str
    nad_class: int | None
    litho_main_soil_code: str | None
    color: str
    display_order: int


@dataclass(frozen=True)
class SectionPolygon:
    """One closed filled area of the section, in absolute section coordinates.

    Attributes
    ----------
    formation_id : UUID
        Which :class:`SectionPolygonUnit` fills this area.
    points : tuple[tuple[float, float], ...]
        The outline as ``(along_m, elevation_m)`` pairs — along-section
        distance from the section's start endpoint in metres, and
        absolute elevation in the section's vertical datum. The ring is
        NOT closed (the first point is not repeated at the end) and its
        winding is whatever the 2-D engine produced; targets that care
        about winding normalise it themselves.
    gap_index : int
        Zero-based index of the gap's LEFT column within the partition's
        column list. Carried for diagnostics — a warning that names the
        gap is the only way to find the offending region in the editor.
    body_id : str | None
        Resolver-assigned body identity, or ``None`` when the region's
        units are not part of a correlated body. Carried so a target
        that can group layers keeps one body as one entity.
    """

    formation_id: UUID
    points: tuple[tuple[float, float], ...]
    gap_index: int
    body_id: str | None = None


@dataclass(frozen=True)
class SectionPolygonSet:
    """Everything a closed-geometry exporter needs for ONE cross-section.

    Built by ``application/build_section_polygons.py`` from a
    ``SectionSnapshot`` (metadata + scope guards) plus the renderer's
    ``SectionPartitionInput`` (the drawn fill). Exporters consume this
    through ``SectionGeometryExporter.export`` without ever touching the
    DB — keeps the infrastructure layer pure.

    Attributes
    ----------
    project_id : UUID
    project_name : str
        Both surface into the export's metadata where the target
        supports it.
    section_id : UUID
    section_name : str
        Section identity — used in the exported filename and inside the
        file as a title / project comment.
    section_length_m : float
        Euclidean length of the section line, in metres.
    crs_epsg : int
        Horizontal CRS of the section endpoints.
    vertical_datum_label : str
        Display label for the vertical datum — ``"m TAW"`` for Belgium,
        ``"m NAP"`` for the Netherlands, ``"m"`` for unknown. Every
        elevation in ``polygons`` is expressed in it.
    column_positions_m : tuple[float, ...]
        The partition's own column along-distances, ascending. Carried
        so an exporter that samples a 1-D profile (D-Sheet Piling) can
        state which columns bracket the sampled position.
    units : tuple[SectionPolygonUnit, ...]
        Every unit referenced by ``polygons``, ordered by
        ``display_order`` then name. Units with no polygon are absent —
        an export never emits an empty layer.
    polygons : tuple[SectionPolygon, ...]
        The filled areas, in the order the 2-D engine produced them.
    """

    project_id: UUID
    project_name: str
    section_id: UUID
    section_name: str
    section_length_m: float
    crs_epsg: int
    vertical_datum_label: str
    column_positions_m: tuple[float, ...] = ()
    units: tuple[SectionPolygonUnit, ...] = ()
    polygons: tuple[SectionPolygon, ...] = field(default_factory=tuple)
