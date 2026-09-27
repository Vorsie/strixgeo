"""DXF exporter for cross-section geometry — v1.0 MVP gate #5.

A cross-section drawn in the desktop's section editor exports to a
2D DXF file engineers can drop straight into AutoCAD / Plaxis 2D /
D-Sheet / GeoStudio. The export is the integration unit between
this product (which builds + edits the geological model) and every
downstream design tool (which does the actual EC7 calculations).

Coordinate system in the DXF
----------------------------
* Model space, units = metres (standard for engineering CAD).
* X axis = along-section distance from the section's start endpoint.
* Y axis = absolute level in the section's vertical datum (m TAW
  / m NAP / m). When an investigation has no recorded surface
  elevation, the column is drawn relative to depth-0 = level-0; the
  caller-visible export carries a comment noting the missing Z so
  the receiver knows the column's vertical position is approximate.

What the DXF carries
--------------------
1. **Per-formation polylines** — for each formation referenced in
   the snapshot's contacts, emit one LWPOLYLINE connecting every
   contact point at that formation, sorted by along-distance.
   These are the formation top SURFACES the downstream tool needs
   to know where each soil unit begins. Each formation gets its
   own DXF layer named ``"GeoModel-<formation_name>"`` with the
   formation's colour mapped to the nearest AutoCAD Color Index.
   Formation names are NOT unique in this app and DXF layer keys
   are case-folded, so two formations can want the same layer
   name; the second one is given a short-id suffix instead of
   crashing the export (see ``_setup_layers``). Contacts are
   grouped by formation ID, never by name.

   A unit that carries a NAD packing class is named
   ``"GeoModel-NAD-06_ZAND - <unit name>"`` — the machine-usable
   identifier goes in FRONT of the display name so one CAD wildcard
   (``GeoModel-NAD-06_*``) selects every instance of one class
   (debt #104). Units without a class — geological formations,
   litho units, unclassified geotech skeleton bands — keep their
   name byte-identical; their identifiers ride the layer
   description and the mapping table instead. The scheme and the
   reasoning behind it live in ``unit_identifier.py``.
2. **Per-investigation columns** — for each projected column emit
   a vertical line from the surface elevation down to
   ``surface - total_depth``. Each carries a TEXT entity at the
   top with the investigation name. Investigations go on the
   single layer ``"Investigations"``.
3. **Title block** — small TEXT entity bottom-left of the drawing
   carries the project name, section name, and length. Drops into
   AutoCAD's model space at coordinates that don't conflict with
   typical site data.
4. **Unit mapping table** — when any exported unit carries an
   identifier, a block of TEXT entities under the title block lists
   layer -> NAD class -> soil -> unit name -> formation id, so a DXF
   that travels on its own still states how to map its layers onto
   material definitions (debt #104). A geological-model export has no
   identifiers, emits no table, and is byte-identical to before.

What the DXF intentionally does NOT carry yet
---------------------------------------------
* Closed polygons / hatches for "soil bodies" between adjacent
  formation surfaces. These need careful endpoint handling on
  either end of the section (the surface lines stop at the first /
  last anchor; the receiver expects the bodies to close to the
  section bounding box) and are a v1.1 polish item. Today's per-
  formation polylines + per-column verticals are sufficient for
  the Plaxis "I'll trace the geometry over the imported reference"
  workflow.
* Per-formation soil parameters. Phase 5.
* DEM ground line. Adding this is straightforward (one extra
  polyline through the DEM-sampled (along, level) points) but
  needs a DEM-fetcher dependency in the snapshot — defer.
"""

from __future__ import annotations

import io
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    # deferred: ezdxf is imported lazily inside the methods that build the drawing
    # (see ``export`` and ``_parse_hex_color``) so importing this exporter at API
    # boot (a router pulls it in to register a route) does not pay ezdxf's import
    # cost.  ``ezdxf`` stays importable here for the ``ezdxf.document.Drawing``
    # annotations.
    import ezdxf
    from ezdxf.colors import RGB

from shapely import set_precision
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

from groundmodel.application.section_cpt_trace import SectionCptTrace
from groundmodel.application.section_polygon_set import SectionPolygonSet, SectionPolygonUnit
from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.cpt_trace_scale import qc_full_scale_mpa
from groundmodel.infrastructure.exporters.cpt_trace_scale_constants import (
    CPT_BAND_HALF_WIDTH_M,
    CPT_BAND_MIN_HALF_WIDTH_M,
    CPT_BAND_NEIGHBOUR_FRACTION,
    CPT_GRID_ACI,
    CPT_GRID_LAYER,
    CPT_LABEL_HEIGHT,
    CPT_LABEL_HEIGHT_FRACTION,
    CPT_LABEL_LIFT_M,
    CPT_LABEL_MIN_HEIGHT,
    CPT_QC_LAYER,
    CPT_RF_LAYER,
    CPT_RF_RGB,
    FILL_TRANSPARENCY,
    FILL_UNION_GRID_M,
    QC_GRID_MPA,
    RF_FULL_SCALE_PCT,
    RF_GRID_PCT,
)
from groundmodel.infrastructure.exporters.dxf_layer_style import style_layer
from groundmodel.infrastructure.exporters.dxf_text_safety import strip_dxf_line_breaks
from groundmodel.infrastructure.exporters.section_exporter import SectionExporter
from groundmodel.infrastructure.exporters.unit_identifier import (
    UnitMappingRow,
    format_mapping_table,
    naming_identifier,
)
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    DXF_FORBIDDEN_LAYER_CHARS,
    MAPPING_TABLE_DXF_LAYER_HEADING,
    UNIT_ID_NAME_SEPARATOR,
)

# DXF layer name for the investigation column track. Single layer so
# the user can toggle "show / hide all columns" in CAD without
# clicking per-investigation.
_INVESTIGATIONS_LAYER = "Investigations"

# Layer name prefix for per-formation polylines. The frontend's
# formation colours are hex strings; ezdxf accepts an RGB triplet
# per-layer so we don't have to round-trip through AutoCAD's
# 256-entry palette.
_FORMATION_LAYER_PREFIX = "GeoModel-"

# AutoCAD truncates layer names at 255 characters. Applied by
# ``_formation_layer_name`` and honoured by the collision disambiguator so a
# very long formation name can't push its own disambiguating suffix off the
# end (which would reproduce the collision it exists to resolve).
_MAX_LAYER_NAME_LEN = 255


class DxfSectionExporter(SectionExporter):
    """Serialise a ``SectionSnapshot`` to DXF bytes."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def export(
        self,
        snapshot: SectionSnapshot,
        fill: SectionPolygonSet | None = None,
        cpt_traces: Sequence[SectionCptTrace] = (),
    ) -> bytes:
        """Build the DXF and return the serialised bytes.

        Parameters
        ----------
        snapshot : SectionSnapshot
            Materialised section geometry.
        fill : SectionPolygonSet | None
            The section's drawn fill (owner 2026-09-26: a DXF of a litho
            fill "should literally look like litho fill in app"). Each
            region becomes a closed outline plus a solid hatch on its
            unit's layer, and the pick-to-pick contact lines are NOT drawn
            (the outlines carry the boundaries). ``None`` (the legacy GET, the
            stratigraphy axis) draws the contact lines instead.
        cpt_traces : Sequence[SectionCptTrace]
            The stored qc / Rf series of the section's CPT columns; each
            becomes the curves the app draws in the column band.

        Returns
        -------
        bytes
            DXF file content ready to write or stream. Encoded
            UTF-8 because ezdxf's R2018 output uses Unicode for
            text entities.
        """
        # deferred: keeps ezdxf off the API boot path (see the module imports).
        import ezdxf

        doc = ezdxf.new(dxfversion="R2018", setup=True)
        msp = doc.modelspace()

        # Document metadata — surfaces inside CAD's drawing
        # properties dialog so the engineer can see what project /
        # section the file came from without renaming it.
        doc.header["$PROJECTNAME"] = snapshot.project_name[:255]

        layer_by_formation_id = self._setup_layers(doc, snapshot)
        fill_units = self._setup_fill_layers(doc, fill, layer_by_formation_id, snapshot)
        # The fill goes first: entity order is draw order in CAD, and the
        # column lines, contacts and curves must stay readable over it.
        drawn_regions = self._draw_fill(msp, fill, layer_by_formation_id, snapshot)
        self._draw_investigation_columns(msp, snapshot)
        # The pick-to-pick straight lines are the LINE drawing's geometry: with
        # a fill the hatched regions carry every boundary, and those lines cut
        # across them regardless of the correlations the engineer drew (owner
        # 2026-09-27: "those are not correlations I drew"). Fill present: skip.
        if fill is None:
            dropped_no_level, dropped_no_formation = self._draw_formation_surfaces(
                msp, snapshot, layer_by_formation_id
            )
        else:
            dropped_no_level, dropped_no_formation = 0, 0
        drawn_cpts = 0
        if cpt_traces:
            self._setup_cpt_layers(doc)
            drawn_cpts = self._draw_cpt_traces(msp, snapshot, cpt_traces)
        self._draw_title_block(msp, snapshot, layer_by_formation_id, fill_units, fill, cpt_traces)

        # ezdxf writes to a text stream; we wrap in StringIO and
        # encode to UTF-8 for the FastAPI byte-stream response.
        sink = io.StringIO()
        doc.write(sink)
        payload = sink.getvalue().encode("utf-8")
        # Fold the dropped-contact tally onto the success line so a silently-
        # thinned export is visible without diffing the file against the
        # section. The two drop reasons are NOT the same severity:
        #   - no-level is a DESIGNED-FOR condition — a contact whose anchor has
        #     no surface Z can't sit on the absolute-level axis, which is common
        #     (not every import carries Z) and already noted in the title block.
        #     It stays on the SUCCESS tally only, or the WARNING would cry wolf.
        #   - no-formation means a contact referenced a formation that vanished
        #     between snapshot assembly and export (shouldn't happen in one
        #     transaction) — genuinely anomalous, so THAT gets a WARNING.
        drawn_contacts = (
            0
            if fill is not None
            else len(snapshot.contacts) - dropped_no_level - dropped_no_formation
        )
        dropped_total = dropped_no_level + dropped_no_formation
        if dropped_no_formation:
            self.warning(
                f"DXF section export dropped {dropped_no_formation} contact(s) with "
                f"unresolvable formation (deleted between snapshot assembly and export?) "
                f"project={snapshot.project_name!r} project_id={snapshot.project_id} "
                f"section={snapshot.section_name!r} section_id={snapshot.section_id}"
            )
        # Identifier coverage (debt #104): "my geotech DXF has no NAD layer
        # names" must be diagnosable from the log alone — nad=0 says the
        # units were never classified, not that the exporter dropped them.
        named = sum(1 for f in snapshot.formations if f.nad_class is not None)
        with_soil = sum(1 for f in snapshot.formations if f.litho_main_soil_code)
        self.success(
            f"DXF section exported: project={snapshot.project_name!r} "
            f"project_id={snapshot.project_id} "
            f"section={snapshot.section_name!r} section_id={snapshot.section_id} "
            f"size={len(payload)} bytes "
            f"({len(snapshot.investigations)} columns, "
            f"{len(snapshot.formations)} formations "
            f"[nad-named {named}, soil-tagged {with_soil}], "
            f"{drawn_contacts}/{len(snapshot.contacts)} contacts drawn, "
            f"{dropped_total} dropped [{dropped_no_level} no-level, "
            f"{dropped_no_formation} no-formation], "
            f"{drawn_regions} fill region(s), {drawn_cpts} CPT curve column(s))"
        )
        return payload

    # ------------------------------------------------------------------
    # Layer setup — one per formation + the Investigations layer.
    # ------------------------------------------------------------------

    def _setup_layers(
        self, doc: ezdxf.document.Drawing, snapshot: SectionSnapshot
    ) -> dict[UUID, str]:
        """Register DXF layers up front, one per formation.

        Drawing entities reference layer names; if a layer isn't
        defined ezdxf creates one with default colour. We define
        every layer we use so each formation lands with its true
        colour from the editor — engineers reading the DXF see the
        same colour-coding as the section editor.

        Two formations can want the SAME layer name — duplicate
        formation names are an expected state in this app (the
        seed-from-stratigraphy flow leaves the duplicate for the
        engineer to resolve, and nothing in the schema or the create
        endpoint enforces uniqueness), DXF layer keys are case-folded
        so ``"Zand"`` and ``"ZAND"`` collide, and stripping the
        forbidden characters can collapse two distinct names onto one.
        ``LayerTable.add`` raises ``DXFTableEntryError`` on a repeat,
        which used to escape the export endpoint as an unexplained
        HTTP 500. Colliding formations are given a disambiguated layer
        instead, so each keeps a surface of its own in CAD.

        Returns
        -------
        dict[UUID, str]
            ``formation_id -> layer name``. The drawing pass reads the
            layer from this map rather than re-deriving it from the
            formation name, which is what keeps two same-named
            formations on two separate layers (and two separate
            polylines).
        """
        # Black-on-white CAD default. Use the layer's true_color
        # (24-bit RGB) per-formation rather than the legacy 256-entry
        # ACI; modern AutoCAD (R2018+) honours true_color.
        invest_layer = doc.layers.add(name=_INVESTIGATIONS_LAYER)
        invest_layer.color = 7  # 7 = black/white (theme-aware in CAD)

        layer_by_formation_id: dict[UUID, str] = {}
        for f in snapshot.formations:
            layer_name = _formation_layer_name(_layer_body(f))
            if doc.layers.has_entry(layer_name):
                layer_name = _disambiguated_layer_name(
                    layer_name, f.formation_id, doc.layers.has_entry
                )
                # Loud, because the engineer sees two near-identical layers in
                # CAD and needs to know it is a duplicate in HIS model, not an
                # exporter quirk.
                self.warning(
                    f"DXF layer name collision on formation {f.name!r} "
                    f"(formation_id={f.formation_id}) — a second formation already "
                    f"claims that layer name; exporting it as {layer_name!r}. "
                    f"Likely a duplicate formation in the model. "
                    f"project_id={snapshot.project_id} section_id={snapshot.section_id}"
                )
            layer = doc.layers.add(name=layer_name)
            layer_by_formation_id[f.formation_id] = layer_name
            rgb = _parse_hex_color(f.color)
            if rgb is not None:
                # Index colour + thin weight alongside the true colour — the
                # edges of a filled area are drawn from the index colour, which
                # defaults to white (owner 2026-08-28, on the fence export:
                # "the white bounding lines are a bit thick").
                style_layer(layer, rgb)
            # Carry the formation code as a layer description when
            # present — surfaces in CAD's layer properties dialog.
            if f.code:
                description = f"Formation '{f.name}' (code {f.code})"
            else:
                description = f"Formation '{f.name}'"
            # Append the three-level identifiers (debt #104). Metadata, not
            # naming: a litho unit's LAYER NAME must stay byte-identical, so
            # its soil code reaches CAD here instead. A geological formation
            # carries neither field and its description is untouched.
            if f.nad_class is not None:
                description += f" | NAD class {f.nad_class}"
            if f.litho_main_soil_code:
                description += f" | soil {f.litho_main_soil_code}"
            # The description is another string group code in the line-oriented
            # DXF stream — a raw CR/LF (from a bad-import formation name) would
            # corrupt it exactly as it would a layer name. Strip once on the
            # assembled value; byte-identical when the name carries no break.
            layer.description = strip_dxf_line_breaks(description)
        return layer_by_formation_id

    # ------------------------------------------------------------------
    # Investigation columns — vertical line + name label per column.
    # ------------------------------------------------------------------

    def _draw_investigation_columns(self, msp, snapshot: SectionSnapshot) -> None:  # type: ignore[no-untyped-def]
        """Emit one vertical line + name TEXT per projected column.

        The column extends from the surface elevation (top) down to
        ``surface - total_depth`` (bottom). When ``surface_elevation_m``
        is null we anchor the top at level 0 — the title block carries
        a note that no-Z columns are at indicative position.
        """
        for inv in snapshot.investigations:
            x = inv.along_distance_m
            top_y = inv.surface_elevation_m if inv.surface_elevation_m is not None else 0.0
            depth = inv.total_depth_m if inv.total_depth_m is not None else 0.0
            bottom_y = top_y - depth

            # Vertical column line.
            msp.add_line(
                start=(x, top_y),
                end=(x, bottom_y),
                dxfattribs={"layer": _INVESTIGATIONS_LAYER},
            )
            # Name label — a small offset above the column top so it
            # doesn't sit on the surface line.
            msp.add_text(
                strip_dxf_line_breaks(inv.name),
                dxfattribs={
                    "layer": _INVESTIGATIONS_LAYER,
                    "height": 0.5,
                },
            ).set_placement((x, top_y + 0.6))

    # ------------------------------------------------------------------
    # Formation top surfaces — one polyline per formation.
    # ------------------------------------------------------------------

    def _draw_formation_surfaces(  # type: ignore[no-untyped-def]
        self,
        msp,
        snapshot: SectionSnapshot,
        layer_by_formation_id: dict[UUID, str],
    ) -> tuple[int, int]:
        """For each formation with contacts on the section, emit one
        LWPOLYLINE through (along_distance_m, level_m) sorted by
        along-distance.

        Contacts whose anchor has no surface elevation (level_m is
        None) are skipped — without an absolute Y we can't place the
        contact on the level-axis DXF. Future work could emit a
        depth-axis variant of the export for that case.

        Parameters
        ----------
        msp
            The ezdxf modelspace to draw into.
        snapshot : SectionSnapshot
            Materialised section geometry.
        layer_by_formation_id : dict[UUID, str]
            ``formation_id -> layer name`` from ``_setup_layers``.
            Grouping on the id — not the name — is what keeps two
            same-named formations as two separate surfaces instead of
            welding their contacts into one zig-zag polyline.

        Returns
        -------
        tuple[int, int]
            ``(dropped_no_level, dropped_no_formation)`` — contacts
            excluded from the DXF because they had no absolute level or
            no resolvable formation. The caller folds these onto the
            success line so a silently-thinned export is visible.
        """
        dropped_no_level = 0
        dropped_no_formation = 0
        # Group contacts by formation ID — the only stable identity a
        # formation has (names are not unique, see _setup_layers).
        by_formation: dict[UUID, list[tuple[float, float]]] = {}
        for c in snapshot.contacts:
            if c.level_m is None:
                dropped_no_level += 1
                continue
            if c.formation_id not in layer_by_formation_id:
                # Defensive: a contact referencing a formation that isn't in
                # the snapshot (deleted between assembly and export).
                dropped_no_formation += 1
                continue
            by_formation.setdefault(c.formation_id, []).append((c.along_distance_m, c.level_m))

        for formation_id, points in by_formation.items():
            if len(points) < 1:
                continue
            layer_name = layer_by_formation_id[formation_id]
            points.sort(key=lambda p: p[0])
            if len(points) == 1:
                # Single-point "surface" — emit a circle marker
                # instead of a degenerate polyline. AutoCAD doesn't
                # render zero-length polylines visibly.
                x, y = points[0]
                msp.add_circle(
                    center=(x, y),
                    radius=0.3,
                    dxfattribs={"layer": layer_name},
                )
                continue
            msp.add_lwpolyline(
                points,
                dxfattribs={"layer": layer_name},
            )

        return dropped_no_level, dropped_no_formation

    # ------------------------------------------------------------------
    # The drawn fill — one outline + one solid hatch per region.
    # ------------------------------------------------------------------

    def _setup_fill_layers(
        self,
        doc: ezdxf.document.Drawing,
        fill: SectionPolygonSet | None,
        layer_by_formation_id: dict[UUID, str],
        snapshot: SectionSnapshot,
    ) -> tuple[SectionPolygonUnit, ...]:
        """Register a layer for every fill unit the contact snapshot did not carry.

        A litho fill can draw a unit that has no formation-pick contact on
        this section (a lens from a neighbouring test); it gets the same
        layer naming as every other unit so it is not the odd one out in CAD.

        Parameters
        ----------
        doc : ezdxf.document.Drawing
            The drawing whose layer table is extended.
        fill : SectionPolygonSet | None
            The drawn fill; ``None`` registers nothing.
        layer_by_formation_id : dict[UUID, str]
            ``formation_id -> layer name``; extended in place.
        snapshot : SectionSnapshot
            For the identity in the collision warning.

        Returns
        -------
        tuple[SectionPolygonUnit, ...]
            The fill's units, for the mapping table.
        """
        if fill is None:
            return ()
        for unit in fill.units:
            if unit.formation_id in layer_by_formation_id:
                continue
            identifier = naming_identifier(
                nad_class=unit.nad_class, litho_main_soil_code=unit.litho_main_soil_code
            )
            body = (
                unit.name
                if identifier is None
                else f"{identifier}{UNIT_ID_NAME_SEPARATOR}{unit.name}"
            )
            layer_name = _formation_layer_name(body)
            if doc.layers.has_entry(layer_name):
                layer_name = _disambiguated_layer_name(
                    layer_name, unit.formation_id, doc.layers.has_entry
                )
                self.warning(
                    f"DXF layer name collision on fill unit {unit.name!r} "
                    f"(formation_id={unit.formation_id}); exporting it as {layer_name!r}. "
                    f"project_id={snapshot.project_id} section_id={snapshot.section_id}"
                )
            layer = doc.layers.add(name=layer_name)
            layer_by_formation_id[unit.formation_id] = layer_name
            rgb = _parse_hex_color(unit.color)
            if rgb is not None:
                style_layer(layer, rgb)
            description = f"Unit '{unit.name}'"
            if unit.nad_class is not None:
                description += f" | NAD class {unit.nad_class}"
            if unit.litho_main_soil_code:
                description += f" | soil {unit.litho_main_soil_code}"
            layer.description = strip_dxf_line_breaks(description)
        return fill.units

    def _draw_fill(  # type: ignore[no-untyped-def]
        self,
        msp,
        fill: SectionPolygonSet | None,
        layer_by_formation_id: dict[UUID, str],
        snapshot: SectionSnapshot,
    ) -> int:
        """Emit each unit body (unioned touching regions) as outline + solid HATCH.

        The hatch carries the unit's true colour and is see-through
        (``FILL_TRANSPARENCY``) so the lines drawn after it stay readable —
        the app draws its bands at 0.55 opacity for the same reason.

        Parameters
        ----------
        msp
            The ezdxf modelspace to draw into.
        fill : SectionPolygonSet | None
            The drawn fill; ``None`` draws nothing.
        layer_by_formation_id : dict[UUID, str]
            ``formation_id -> layer name`` (contacts + fill units).
        snapshot : SectionSnapshot
            For the identity in the log line.

        Returns
        -------
        int
            Bodies drawn (touching regions of one unit count once).
        """
        if fill is None:
            return 0
        colour_by_id = {unit.formation_id: _parse_hex_color(unit.color) for unit in fill.units}
        # Touching regions of one unit are ONE body on paper: the app hides the
        # seam between a merged lens and its band by colour, a DXF outline per
        # region would print it (owner 2026-09-27: "it was merged into the clay
        # body, so the lines disappear"). Union per unit, then draw each body.
        by_unit: dict[UUID, list[Polygon]] = {}
        skipped = 0
        for polygon in fill.polygons:
            points = [(float(x), float(y)) for x, y in polygon.points]
            if polygon.formation_id not in layer_by_formation_id or len(points) < 3:
                skipped += 1
                continue
            # Snap to a 0.1 mm grid first: a merged lens shares its seam vertices
            # with the band only up to float noise, and a hairline gap would
            # keep the two apart in the union.
            shape = set_precision(Polygon(points), FILL_UNION_GRID_M).buffer(0)
            if shape.is_empty:
                skipped += 1
                continue
            by_unit.setdefault(polygon.formation_id, []).append(shape)
        drawn = 0
        for formation_id, shapes in by_unit.items():
            layer_name = layer_by_formation_id[formation_id]
            rgb = colour_by_id.get(formation_id)
            merged = unary_union(shapes)
            bodies = list(merged.geoms) if isinstance(merged, MultiPolygon) else [merged]
            for body in bodies:
                if not isinstance(body, Polygon) or body.is_empty:
                    continue
                rings = [list(body.exterior.coords)[:-1]] + [
                    list(ring.coords)[:-1] for ring in body.interiors
                ]
                hatch = msp.add_hatch(dxfattribs={"layer": layer_name})
                for ring in rings:
                    msp.add_lwpolyline(ring, close=True, dxfattribs={"layer": layer_name})
                    hatch.paths.add_polyline_path(ring, is_closed=True)
                # Style 1 ("outer") fills between the outer ring and the next
                # ring inward, so a body with a hole stays open at the hole.
                hatch.set_solid_fill(color=7, style=1, rgb=rgb)
                hatch.transparency = FILL_TRANSPARENCY
                drawn += 1
        if skipped:
            self.warning(
                f"DXF section export skipped {skipped} fill region(s) with no layer, under "
                f"three points or degenerate; section_id={snapshot.section_id}"
            )
        self.debug(
            f"DXF section export drew {drawn} fill body(ies) from {len(fill.polygons)} region(s) "
            f"on {len(by_unit)} unit(s)"
        )
        return drawn

    # ------------------------------------------------------------------
    # CPT curves — qc to the right of the column axis, Rf to the left.
    # ------------------------------------------------------------------

    def _setup_cpt_layers(self, doc: ezdxf.document.Drawing) -> None:
        """Register the three curve layers: qc (column colour), Rf (orange), scale (grey)."""
        if not doc.layers.has_entry(CPT_QC_LAYER):
            doc.layers.add(name=CPT_QC_LAYER).color = 7
        if not doc.layers.has_entry(CPT_RF_LAYER):
            style_layer(doc.layers.add(name=CPT_RF_LAYER), CPT_RF_RGB)
        if not doc.layers.has_entry(CPT_GRID_LAYER):
            doc.layers.add(name=CPT_GRID_LAYER).color = CPT_GRID_ACI

    def _draw_cpt_traces(  # type: ignore[no-untyped-def]
        self,
        msp,
        snapshot: SectionSnapshot,
        cpt_traces: Sequence[SectionCptTrace],
    ) -> int:
        """Emit the app's column band per CPT that has a stored series.

        Same conventions as the section on screen (``CptDataColumn``): qc reads
        rightward from the column axis on the section-wide full scale
        (:func:`qc_full_scale_mpa`), Rf leftward on 0..10 %, values off scale
        clamp to the band edge, a missing sample breaks the curve, and the
        2 / 10 MPa and 2 / 4 % gridlines run the band's height with their
        labels hanging below it as vertical text.
        The band half-width is ``CPT_BAND_HALF_WIDTH_M`` clamped to a fraction
        of the distance to the nearest neighbouring column.

        Parameters
        ----------
        msp
            The ezdxf modelspace to draw into.
        snapshot : SectionSnapshot
            The projected columns — position, surface and kind.
        cpt_traces : Sequence[SectionCptTrace]
            The stored series, keyed by investigation id.

        Returns
        -------
        int
            CPT columns that got curves.
        """
        # deferred: keeps ezdxf off the API boot path (see the module imports).
        from ezdxf.enums import TextEntityAlignment

        by_id = {trace.investigation_id: trace for trace in cpt_traces}
        columns = [
            inv
            for inv in snapshot.investigations
            if inv.kind == "cpt" and inv.investigation_id in by_id
        ]
        if not columns:
            return 0
        scale = qc_full_scale_mpa([by_id[inv.investigation_id].qc_mpa for inv in columns])
        alongs = [inv.along_distance_m for inv in snapshot.investigations]
        drawn = 0
        for inv in columns:
            trace = by_id[inv.investigation_id]
            if not trace.depths_m:
                continue
            axis = inv.along_distance_m
            others = [abs(a - axis) for a in alongs if a != axis]
            half = CPT_BAND_HALF_WIDTH_M
            if others:
                half = min(half, CPT_BAND_NEIGHBOUR_FRACTION * min(others))
            half = max(half, CPT_BAND_MIN_HALF_WIDTH_M)
            surface = inv.surface_elevation_m if inv.surface_elevation_m is not None else 0.0
            bottom = surface - max(trace.depths_m)
            # Gridlines + labels, the app's positions.
            marks: list[tuple[float, str]] = []
            for mpa in QC_GRID_MPA:
                if scale > mpa:
                    marks.append((axis + (mpa / scale) * half, f"{mpa:g}"))
            marks.append((axis + half, f"{scale:g} MPa"))
            if trace.rf_pct is not None:  # a CPTM has no sleeve: no Rf side
                for pct in RF_GRID_PCT:
                    marks.append((axis - (pct / RF_FULL_SCALE_PCT) * half, f"{pct:g}%"))
            # Labels hang BELOW the band as vertical text (a y-axis label's
            # orientation): above it they would collide with the column name,
            # and side by side they overlap once the band is a few metres wide.
            label_height = max(
                CPT_LABEL_MIN_HEIGHT, min(CPT_LABEL_HEIGHT, half * CPT_LABEL_HEIGHT_FRACTION)
            )
            for x, label in marks:
                msp.add_line(
                    start=(x, surface), end=(x, bottom), dxfattribs={"layer": CPT_GRID_LAYER}
                )
                msp.add_text(
                    label,
                    dxfattribs={"layer": CPT_GRID_LAYER, "height": label_height, "rotation": 90},
                ).set_placement((x, bottom - CPT_LABEL_LIFT_M), align=TextEntityAlignment.RIGHT)
            self._draw_curve(
                msp, trace.depths_m, trace.qc_mpa, axis, half, scale, 1, surface, CPT_QC_LAYER
            )
            if trace.rf_pct is not None:
                self._draw_curve(
                    msp,
                    trace.depths_m,
                    trace.rf_pct,
                    axis,
                    half,
                    RF_FULL_SCALE_PCT,
                    -1,
                    surface,
                    CPT_RF_LAYER,
                )
            drawn += 1
        self.debug(
            f"DXF section export drew CPT curves on {drawn} column(s), qc scale {scale:g} MPa"
        )
        return drawn

    @staticmethod
    def _draw_curve(  # type: ignore[no-untyped-def]
        msp,
        depths_m: Sequence[float],
        values: Sequence[float | None],
        axis_x: float,
        half_width: float,
        full_scale: float,
        direction: int,
        surface: float,
        layer: str,
    ) -> None:
        """One channel as LWPOLYLINEs: a run per stretch of present samples.

        Mirrors the renderer's ``curvePath``: a value maps to
        ``axis + direction * clamp(v / full_scale, 0, 1) * half_width`` at
        ``surface - depth``; ``None`` lifts the pen.
        """
        run: list[tuple[float, float]] = []

        def flush() -> None:
            if len(run) >= 2:
                msp.add_lwpolyline(list(run), dxfattribs={"layer": layer})
            run.clear()

        for depth, value in zip(depths_m, values, strict=False):
            if value is None:
                flush()
                continue
            rel = max(0.0, min(1.0, float(value) / full_scale))
            run.append((axis_x + direction * rel * half_width, surface - float(depth)))
        flush()

    # ------------------------------------------------------------------
    # Title block — bottom-left text annotation.
    # ------------------------------------------------------------------

    def _draw_title_block(  # type: ignore[no-untyped-def]
        self,
        msp,
        snapshot: SectionSnapshot,
        layer_by_formation_id: dict[UUID, str],
        fill_units: Sequence[SectionPolygonUnit] = (),
        fill: SectionPolygonSet | None = None,
        cpt_traces: Sequence[SectionCptTrace] = (),
    ) -> None:
        """Bottom-left TEXT entity carrying project + section identity.

        Plain TEXT (not MTEXT) so old AutoCAD verticals render it.
        Position chosen at ``(0, lowest_level - 5)`` so it sits below
        the data without overlapping the section's vertical extent.

        The unit mapping table (debt #104) is appended under the title
        lines when any exported unit carries a NAD class or a soil code,
        so a DXF that travels on its own still states how to map its
        layers onto material definitions.

        Parameters
        ----------
        msp
            The ezdxf modelspace to draw into.
        snapshot : SectionSnapshot
            Materialised section geometry.
        layer_by_formation_id : dict[UUID, str]
            ``formation_id -> layer name`` from ``_setup_layers``. The
            mapping table quotes the layer name the drawing ACTUALLY
            carries, including any collision disambiguation, so the
            reader can match a row against the CAD layer list verbatim.
        """
        # Find the lowest drawn level so the title sits clear below.
        lowest = 0.0
        for inv in snapshot.investigations:
            surface = inv.surface_elevation_m if inv.surface_elevation_m is not None else 0.0
            depth = inv.total_depth_m if inv.total_depth_m is not None else 0.0
            lowest = min(lowest, surface - depth)
        for c in snapshot.contacts:
            if c.level_m is not None:
                lowest = min(lowest, c.level_m)
        if fill is not None:
            for polygon in fill.polygons:
                for _x, y in polygon.points:
                    lowest = min(lowest, y)
        surface_by_id = {
            i.investigation_id: i.surface_elevation_m or 0.0 for i in snapshot.investigations
        }
        for trace in cpt_traces:
            if trace.depths_m and trace.investigation_id in surface_by_id:
                lowest = min(lowest, surface_by_id[trace.investigation_id] - max(trace.depths_m))

        anchor_y = lowest - 5.0
        title_lines = [
            f"Project: {snapshot.project_name}",
            f"Section: {snapshot.section_name}",
            (
                f"Length: {snapshot.section_length_m:.2f} m  "
                f"CRS: EPSG:{snapshot.crs_epsg}  "
                f"Datum: {snapshot.vertical_datum_label}"
            ),
        ]
        # Note about missing surface elevations — engineers should
        # know which columns are at indicative position.
        no_z = [i.name for i in snapshot.investigations if i.surface_elevation_m is None]
        if no_z:
            title_lines.append(
                f"NB: {len(no_z)} column(s) lack surface elevation; drawn at indicative position"
            )

        mapping_lines = format_mapping_table(
            _mapping_rows(snapshot, layer_by_formation_id, fill_units),
            label_heading=MAPPING_TABLE_DXF_LAYER_HEADING,
        )
        if mapping_lines:
            # Blank spacer so the table reads as its own block in CAD
            # rather than as more title lines.
            title_lines.append("")
            title_lines.extend(mapping_lines)

        line_height = 0.8
        for i, line in enumerate(title_lines):
            # Blank entries only reserve vertical space (the spacer above);
            # an empty TEXT entity renders as nothing in CAD but trips
            # strict DXF validators, so skip drawing it.
            if not line:
                continue
            msp.add_text(
                strip_dxf_line_breaks(line),
                dxfattribs={"layer": _INVESTIGATIONS_LAYER, "height": 0.5},
            ).set_placement((0.0, anchor_y - i * line_height))


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _layer_body(formation: SectionFormation) -> str:
    """Compose the layer-name body for one unit — identifier + display name.

    A unit that carries a NAD packing class leads with its machine
    identifier (``NAD-06_ZAND-Zand van Diest``) so one CAD wildcard
    selects every instance of one class. Every other level — geological
    formations, litho units, unclassified geotech skeleton bands — keeps
    the bare display name, byte-identical to before debt #104; their
    identifiers travel through the layer description and the mapping
    table, which no downstream consumer keys on.

    Parameters
    ----------
    formation : SectionFormation
        The unit whose layer name is being derived.

    Returns
    -------
    str
        The layer-name body, still unsanitised — the caller passes it
        through ``_formation_layer_name`` for the prefix + strip +
        truncate.
    """
    identifier = naming_identifier(
        nad_class=formation.nad_class,
        litho_main_soil_code=formation.litho_main_soil_code,
    )
    if identifier is None:
        return formation.name
    return f"{identifier}{UNIT_ID_NAME_SEPARATOR}{formation.name}"


def _mapping_rows(
    snapshot: SectionSnapshot,
    layer_by_formation_id: dict[UUID, str],
    fill_units: Sequence[SectionPolygonUnit] = (),
) -> list[UnitMappingRow]:
    """Build the mapping-table rows for the units the drawing carries.

    Only units that actually carry an identifier are listed — a
    geological-model export yields an empty list, which
    ``format_mapping_table`` renders as no table at all.

    Parameters
    ----------
    snapshot : SectionSnapshot
        Materialised section geometry.
    layer_by_formation_id : dict[UUID, str]
        ``formation_id -> layer name`` from ``_setup_layers``.
    fill_units : Sequence[SectionPolygonUnit]
        Units the drawn fill references; the ones the snapshot does not
        carry are appended after the snapshot's rows.

    Returns
    -------
    list[UnitMappingRow]
        In snapshot order, so the table reads in the same order as the
        formation list the exporter emitted.
    """
    rows: list[UnitMappingRow] = []
    listed: set[UUID] = set()
    for f in snapshot.formations:
        if f.nad_class is None and not f.litho_main_soil_code:
            continue
        layer_name = layer_by_formation_id.get(f.formation_id)
        if layer_name is None:
            continue
        listed.add(f.formation_id)
        rows.append(
            UnitMappingRow(
                export_label=layer_name,
                nad_class=f.nad_class,
                soil_code=f.litho_main_soil_code,
                display_name=f.name,
                formation_id=f.formation_id,
                absorbed=f.absorbed_unit_names,
            )
        )
    for unit in fill_units:
        if unit.formation_id in listed:
            continue
        if unit.nad_class is None and not unit.litho_main_soil_code:
            continue
        layer_name = layer_by_formation_id.get(unit.formation_id)
        if layer_name is None:
            continue
        rows.append(
            UnitMappingRow(
                export_label=layer_name,
                nad_class=unit.nad_class,
                soil_code=unit.litho_main_soil_code,
                display_name=unit.name,
                formation_id=unit.formation_id,
                absorbed=(),
            )
        )
    return rows


def _formation_layer_name(formation_name: str) -> str:
    """Sanitise a formation name into a DXF-safe layer name.

    DXF forbids these characters in layer names: ``< > / \\ " : ; ? * | = '``.
    We strip them rather than substitute — geological formation
    names rarely contain them, and the few that do (e.g. names with
    slashes) read better with the character dropped than with a
    placeholder underscore. CR/LF are stripped first (``strip_dxf_line_breaks``)
    because a line break in a layer name corrupts the line-oriented DXF stream,
    and ezdxf's own guard against it is an ``assert`` that ``python -O`` removes.
    """
    safe = "".join(
        c for c in strip_dxf_line_breaks(formation_name) if c not in DXF_FORBIDDEN_LAYER_CHARS
    )
    # AutoCAD truncates layer names at 255 chars; we use the prefix
    # + a generous body so the user sees ``GeoModel-Formation name``
    # in CAD without surprise truncation on common names.
    return (_FORMATION_LAYER_PREFIX + safe.strip())[:_MAX_LAYER_NAME_LEN]


def _disambiguated_layer_name(
    taken_name: str,
    formation_id: UUID,
    is_taken: Callable[[str], bool],
) -> str:
    """Derive a free layer name for a formation whose name is already claimed.

    Appends the formation's short id (first 8 hex chars of the UUID) so
    the two colliding layers are told apart in CAD by something stable
    and traceable back to the model, rather than by an arbitrary ``(2)``.
    Re-derives through ``_formation_layer_name`` so the result is still
    DXF-safe and still truncated at 255 characters.

    Parameters
    ----------
    taken_name : str
        The already-claimed candidate layer name (prefix included).
    formation_id : UUID
        The formation whose layer is being renamed.
    is_taken : Callable[[str], bool]
        Predicate answering "does the layer table already hold this
        name?" — ``doc.layers.has_entry`` in production. Passed in so
        this helper stays pure and unit-testable.

    Returns
    -------
    str
        A layer name no existing layer holds.
    """
    short_id = str(formation_id).replace("-", "")[:8]
    # Strip the prefix before re-deriving so it isn't applied twice.
    body = taken_name[len(_FORMATION_LAYER_PREFIX) :]

    def _with_suffix(suffix: str) -> str:
        # Trim the BODY, not the finished name: truncating afterwards would
        # cut the suffix off a 255-char name and reproduce the collision.
        budget = _MAX_LAYER_NAME_LEN - len(_FORMATION_LAYER_PREFIX) - len(suffix)
        return _formation_layer_name(body[:budget].rstrip() + suffix)

    candidate = _with_suffix(f" ({short_id})")
    # Two formations sharing the first 8 hex chars of their UUID is not a
    # real-world case, but a name collision must never crash the export —
    # widen the suffix until the name is free.
    counter = 2
    while is_taken(candidate):
        candidate = _with_suffix(f" ({short_id}-{counter})")
        counter += 1
    return candidate


def _parse_hex_color(hex_str: str) -> RGB | None:
    """Parse a ``#rrggbb`` (or 3-digit ``#rgb``) string into ezdxf's RGB.

    Returns ``None`` on unparseable input — caller falls back to the
    DXF default colour rather than raising. The formation colour
    string comes from the API; a malformed colour should NOT block
    the export of valid layer geometry.
    """
    if not hex_str:
        return None
    s = hex_str.lstrip("#")
    try:
        if len(s) == 3:
            r = int(s[0] * 2, 16)
            g = int(s[1] * 2, 16)
            b = int(s[2] * 2, 16)
        elif len(s) == 6:
            r = int(s[0:2], 16)
            g = int(s[2:4], 16)
            b = int(s[4:6], 16)
        else:
            return None
    except ValueError:
        return None
    # deferred: keeps ezdxf off the API boot path (see the module imports).
    from ezdxf.colors import RGB

    return RGB(r, g, b)
