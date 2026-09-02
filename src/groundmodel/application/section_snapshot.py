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
    nad_class : int | None
        Belgian NAD packing class (1..31) on a GEOTECHNICAL unit;
        ``None`` on a geological formation, on a litho unit, and on an
        unclassified geotech skeleton band. Together with
        ``litho_main_soil_code`` this is the machine-usable identity a
        downstream tool maps onto a material definition — see
        ``infrastructure/exporters/unit_identifier.py`` (debt #104).
        Pass-through from ``geological_formation.nad_class``, not
        derived here.
    litho_main_soil_code : str | None
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN) on a
        litho or geotech unit; ``None`` on a geological formation
        (Boom Klei has no single lithology). Pass-through from
        ``geological_formation.litho_main_soil_code``.
    absorbed_unit_names : tuple[str, ...]
        Display names of the units merged INTO this one by the export
        thinning pass (debt #104b), in top-down order. Empty unless the
        snapshot went through ``ThinExportUnits``. The mapping table
        renders these so the litho / geological boundary the merge
        erased stays auditable in the delivered artefact.
    """

    formation_id: UUID
    name: str
    code: str | None
    color: str
    display_order: int
    # Optional with a null default so the many fixtures that construct
    # SectionFormation positionally for geological-model tests stay
    # valid — the three-level identifiers are additive (debt #104).
    nad_class: int | None = None
    litho_main_soil_code: str | None = None
    # Names of the units this one absorbed during export thinning
    # (debt #104b). Empty on every unthinned snapshot — the Plaxis path
    # never thins, and the geological / litho levels have no identifier
    # to thin on. A tuple, not a list, because the dataclass is frozen
    # and a mutable default would be shared across instances.
    absorbed_unit_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class SectionSnapshot:
    """All data needed to render or export ONE cross-section.

    Built by ``application/build_section_snapshot.py`` from the
    section row + active geological model + project investigations.
    Exporters consume this through ``SectionExporter.export`` without
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
    # Section line endpoints in the project's horizontal CRS. Populated
    # by ``BuildSectionSnapshot`` from ``section.start_x/_y/_end_x/_end_y``.
    # Carried here (rather than only in the build path) so exporters
    # that need the line geometry — PDF report's location-map inset
    # showing the section + its L/R end markers (debt #52) — don't have
    # to re-fetch the section row. Default 0.0 so pre-#52 test fixtures
    # that construct SectionSnapshot directly stay valid; the build
    # path always populates real values.
    start_x: float = 0.0
    start_y: float = 0.0
    end_x: float = 0.0
    end_y: float = 0.0
