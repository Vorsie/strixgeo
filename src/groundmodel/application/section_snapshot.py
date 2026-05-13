"""Input contract for section-scoped exporters (DXF, future Plaxis-section).

Where ``GroundModelSnapshot`` is project-wide and abstract,
``SectionSnapshot`` is section-scoped and concrete: it carries the
2D geometry needed to render or export ONE cross-section's drawn
geology to a downstream tool.

A cross-section is the editing surface in this product — engineers
pick formation tops at investigation columns ALONG the section line,
and the polylines that connect those picks across columns are what
Plaxis / D-Sheet / AutoCAD consume to model the subsurface. So the
section snapshot's data shape mirrors that workflow:

* **investigations** — the projected (CPT or borehole) columns that
  fall within the section's projection buffer. Each carries its
  along-distance from the section start (the column's x in the
  section's 2D frame), surface elevation, and recorded total depth.
* **contacts** — every formation pick that anchors to one of the
  ``investigations``. Each contact is a (formation, anchor, depth)
  triple; an exporter that wants the formation's top SURFACE simply
  groups contacts by ``formation_id`` and sorts by
  ``along_distance_m``.

Per-layer parameters (unit weights, strengths) intentionally absent
— see ``GroundModelSnapshot`` for the same Phase 4 / Phase 5 split.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID


@dataclass(frozen=True)
class SectionInvestigationProjection:
    """One investigation column projected onto a section line.

    Attributes
    ----------
    investigation_id : UUID
        Source CPT or borehole id.
    kind : str
        ``"cpt"`` or ``"borehole"`` — exporters that style the two
        differently key off this.
    name : str
        Human-readable column label (CPT / borehole name).
    along_distance_m : float
        Distance from the section's start endpoint along the line,
        in metres. Becomes the column's x coordinate in the 2D
        section frame.
    surface_elevation_m : float | None
        Absolute surface elevation in the section's vertical datum
        (m TAW for Belgium, NAP for the Netherlands). ``None`` when
        the investigation has no Z — the exporter then anchors the
        column at level 0 and stamps a warning comment.
    total_depth_m : float | None
        Recorded depth of the test. ``None`` when not known (the
        exporter falls back to the deepest contact depth or skips
        the column-bottom segment).
    """

    investigation_id: UUID
    kind: str
    name: str
    along_distance_m: float
    surface_elevation_m: float | None
    total_depth_m: float | None


@dataclass(frozen=True)
class SectionFormationContact:
    """One formation top pick anchored at one investigation, projected
    into the section's 2D frame.

    Multiple contacts at the same investigation, sorted by ``depth_m``,
    define the column's layer stack. Multiple contacts at the same
    formation across different investigations, sorted by
    ``along_distance_m``, define the formation's top surface line.

    Attributes
    ----------
    contact_id : UUID
        Source ``formation_contact`` row id.
    formation_id : UUID
        Owning ``geological_formation`` id. Exporters group by this
        to emit per-formation polylines.
    investigation_id : UUID
        Anchor investigation (CPT or borehole) id. Matches an entry
        in ``SectionSnapshot.investigations``.
    along_distance_m : float
        Along-section distance — same value as the anchor's
        ``SectionInvestigationProjection.along_distance_m``. Carried
        here so the exporter doesn't need a second lookup.
    depth_m : float
        Depth below the anchor's surface, in metres.
    level_m : float | None
        Absolute level (= ``surface_elevation_m - depth_m``).
        ``None`` when the anchor lacks a surface elevation — the
        contact is still emitted in depth-coordinate exporters but
        skipped from absolute-level exporters (e.g. a DXF in mTAW).
    """

    contact_id: UUID
    formation_id: UUID
    investigation_id: UUID
    along_distance_m: float
    depth_m: float
    level_m: float | None


@dataclass(frozen=True)
class SectionFormation:
    """Display metadata for one geological formation referenced in the
    section's contacts.

    Carried alongside the contacts so exporters don't need a second
    lookup against the ``geological_formation`` table to know each
    formation's name + colour. The snapshot only includes formations
    that have at least one contact on this section — exporters never
    emit "empty" layers.

    Attributes
    ----------
    formation_id : UUID
        Source ``geological_formation`` id — matches contact
        ``formation_id``.
    name : str
        Display name (e.g. "Boom Klei").
    code : str | None
        Short stable code (e.g. "BmK"). Used by exporters whose
        target format keys off codes (Plaxis material library); falls
        back to ``name`` when absent.
    color : str
        Hex colour string (e.g. ``"#ff8800"``). DXF exporter maps
        this to the nearest AutoCAD Color Index (ACI).
    display_order : int
        Editor sort hint — tie-broken by name. Exporters emit
        formations in this order so the user's preferred top-to-bottom
        sequence carries through to the export.
    """

    formation_id: UUID
    name: str
    code: str | None
    color: str
    display_order: int


@dataclass(frozen=True)
class SectionSnapshot:
    """All data needed to render or export ONE cross-section.

    Built by ``application/build_section_snapshot.py`` from the
    section row + active geological model + project investigations.
    Exporters consume this through ``BaseExporter.export`` without
    ever touching the DB — keeps the infrastructure layer pure.

    Attributes
    ----------
    project_id : UUID
    project_name : str
        Both surface into the export's metadata where the target
        supports it (DXF $PROJECTNAME, Plaxis project comment).
    section_id : UUID
    section_name : str
        Section identity — usually included in the exported filename
        and inside the file as a title.
    section_length_m : float
        Euclidean length of the section line, in metres. Used by
        the exporter to validate that contacts' along-distances fall
        within ``[0, section_length_m]``.
    crs_epsg : int
        Horizontal CRS of the section endpoints.
    vertical_datum_label : str
        Display label for the vertical datum — ``"m TAW"`` for
        Belgium, ``"m NAP"`` for the Netherlands, ``"m"`` for
        unknown. Goes into DXF text annotations.
    investigations : list[SectionInvestigationProjection]
        Per-column projections, sorted by ``along_distance_m``.
    formations : list[SectionFormation]
        Display metadata for every formation present in the
        ``contacts`` list, sorted by ``display_order`` then name.
    contacts : list[SectionFormationContact]
        Every formation pick on the section. Exporters group by
        ``formation_id`` for surface lines and by
        ``investigation_id`` for per-column layer stacks.
    """

    project_id: UUID
    project_name: str
    section_id: UUID
    section_name: str
    section_length_m: float
    crs_epsg: int
    vertical_datum_label: str
    investigations: list[SectionInvestigationProjection] = field(default_factory=list)
    formations: list[SectionFormation] = field(default_factory=list)
    contacts: list[SectionFormationContact] = field(default_factory=list)
