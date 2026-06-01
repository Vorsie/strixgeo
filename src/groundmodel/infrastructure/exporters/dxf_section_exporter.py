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
2. **Per-investigation columns** — for each projected column emit
   a vertical line from the surface elevation down to
   ``surface - total_depth``. Each carries a TEXT entity at the
   top with the investigation name. Investigations go on the
   single layer ``"Investigations"``.
3. **Title block** — small TEXT entity bottom-left of the drawing
   carries the project name, section name, and length. Drops into
   AutoCAD's model space at coordinates that don't conflict with
   typical site data.

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

import ezdxf
from ezdxf.colors import RGB

from groundmodel.application.section_snapshot import SectionSnapshot
from groundmodel.infrastructure.exporters.section_exporter import SectionExporter

# DXF layer name for the investigation column track. Single layer so
# the user can toggle "show / hide all columns" in CAD without
# clicking per-investigation.
_INVESTIGATIONS_LAYER = "Investigations"

# Layer name prefix for per-formation polylines. The frontend's
# formation colours are hex strings; ezdxf accepts an RGB triplet
# per-layer so we don't have to round-trip through AutoCAD's
# 256-entry palette.
_FORMATION_LAYER_PREFIX = "GeoModel-"


class DxfSectionExporter(SectionExporter):
    """Serialise a ``SectionSnapshot`` to DXF bytes."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def export(self, snapshot: SectionSnapshot) -> bytes:
        """Build the DXF and return the serialised bytes.

        Parameters
        ----------
        snapshot : SectionSnapshot
            Materialised section geometry.

        Returns
        -------
        bytes
            DXF file content ready to write or stream. Encoded
            UTF-8 because ezdxf's R2018 output uses Unicode for
            text entities.
        """
        doc = ezdxf.new(dxfversion="R2018", setup=True)
        msp = doc.modelspace()

        # Document metadata — surfaces inside CAD's drawing
        # properties dialog so the engineer can see what project /
        # section the file came from without renaming it.
        doc.header["$PROJECTNAME"] = snapshot.project_name[:255]

        self._setup_layers(doc, snapshot)
        self._draw_investigation_columns(msp, snapshot)
        self._draw_formation_surfaces(msp, snapshot)
        self._draw_title_block(msp, snapshot)

        # ezdxf writes to a text stream; we wrap in StringIO and
        # encode to UTF-8 for the FastAPI byte-stream response.
        sink = io.StringIO()
        doc.write(sink)
        payload = sink.getvalue().encode("utf-8")
        self.success(
            f"DXF section exported: project={snapshot.project_name!r} "
            f"section={snapshot.section_name!r} "
            f"size={len(payload)} bytes "
            f"({len(snapshot.investigations)} columns, "
            f"{len(snapshot.formations)} formations, "
            f"{len(snapshot.contacts)} contacts)"
        )
        return payload

    # ------------------------------------------------------------------
    # Layer setup — one per formation + the Investigations layer.
    # ------------------------------------------------------------------

    def _setup_layers(self, doc: ezdxf.document.Drawing, snapshot: SectionSnapshot) -> None:
        """Register DXF layers up front.

        Drawing entities reference layer names; if a layer isn't
        defined ezdxf creates one with default colour. We define
        every layer we use so each formation lands with its true
        colour from the editor — engineers reading the DXF see the
        same colour-coding as the section editor.
        """
        # Black-on-white CAD default. Use the layer's true_color
        # (24-bit RGB) per-formation rather than the legacy 256-entry
        # ACI; modern AutoCAD (R2018+) honours true_color.
        invest_layer = doc.layers.add(name=_INVESTIGATIONS_LAYER)
        invest_layer.color = 7  # 7 = black/white (theme-aware in CAD)

        for f in snapshot.formations:
            layer_name = _formation_layer_name(f.name)
            layer = doc.layers.add(name=layer_name)
            rgb = _parse_hex_color(f.color)
            if rgb is not None:
                layer.rgb = rgb
            # Carry the formation code as a layer description when
            # present — surfaces in CAD's layer properties dialog.
            if f.code:
                layer.description = f"Formation '{f.name}' (code {f.code})"
            else:
                layer.description = f"Formation '{f.name}'"

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
                inv.name,
                dxfattribs={
                    "layer": _INVESTIGATIONS_LAYER,
                    "height": 0.5,
                },
            ).set_placement((x, top_y + 0.6))

    # ------------------------------------------------------------------
    # Formation top surfaces — one polyline per formation.
    # ------------------------------------------------------------------

    def _draw_formation_surfaces(self, msp, snapshot: SectionSnapshot) -> None:  # type: ignore[no-untyped-def]
        """For each formation with contacts on the section, emit one
        LWPOLYLINE through (along_distance_m, level_m) sorted by
        along-distance.

        Contacts whose anchor has no surface elevation (level_m is
        None) are skipped — without an absolute Y we can't place the
        contact on the level-axis DXF. Future work could emit a
        depth-axis variant of the export for that case.
        """
        # Group contacts by formation.
        by_formation: dict[str, list[tuple[float, float]]] = {}
        for c in snapshot.contacts:
            if c.level_m is None:
                continue
            # Use the formation name as the dict key — we already
            # have the layer registered under that name and don't
            # need to re-walk the formations list.
            formation_name = _formation_name_for_contact(c, snapshot)
            if formation_name is None:
                continue
            by_formation.setdefault(formation_name, []).append((c.along_distance_m, c.level_m))

        for formation_name, points in by_formation.items():
            if len(points) < 1:
                continue
            points.sort(key=lambda p: p[0])
            if len(points) == 1:
                # Single-point "surface" — emit a circle marker
                # instead of a degenerate polyline. AutoCAD doesn't
                # render zero-length polylines visibly.
                x, y = points[0]
                msp.add_circle(
                    center=(x, y),
                    radius=0.3,
                    dxfattribs={"layer": _formation_layer_name(formation_name)},
                )
                continue
            msp.add_lwpolyline(
                points,
                dxfattribs={"layer": _formation_layer_name(formation_name)},
            )

    # ------------------------------------------------------------------
    # Title block — bottom-left text annotation.
    # ------------------------------------------------------------------

    def _draw_title_block(self, msp, snapshot: SectionSnapshot) -> None:  # type: ignore[no-untyped-def]
        """Bottom-left TEXT entity carrying project + section identity.

        Plain TEXT (not MTEXT) so old AutoCAD verticals render it.
        Position chosen at ``(0, lowest_level - 5)`` so it sits below
        the data without overlapping the section's vertical extent.
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

        line_height = 0.8
        for i, line in enumerate(title_lines):
            msp.add_text(
                line,
                dxfattribs={"layer": _INVESTIGATIONS_LAYER, "height": 0.5},
            ).set_placement((0.0, anchor_y - i * line_height))


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _formation_layer_name(formation_name: str) -> str:
    """Sanitise a formation name into a DXF-safe layer name.

    DXF forbids these characters in layer names: ``< > / \\ " : ; ? * | = '``.
    We strip them rather than substitute — geological formation
    names rarely contain them, and the few that do (e.g. names with
    slashes) read better with the character dropped than with a
    placeholder underscore.
    """
    forbidden = set("<>/\\\":;?*|='")
    safe = "".join(c for c in formation_name if c not in forbidden)
    # AutoCAD truncates layer names at 255 chars; we use the prefix
    # + a generous body so the user sees ``GeoModel-Formation name``
    # in CAD without surprise truncation on common names.
    return (_FORMATION_LAYER_PREFIX + safe.strip())[:255]


def _formation_name_for_contact(
    contact,
    snapshot: SectionSnapshot,  # type: ignore[no-untyped-def]
) -> str | None:
    """Lookup the formation name for a contact's ``formation_id``.

    Returns ``None`` when the formation isn't in the snapshot's
    formations list — a defensive guard for the unlikely case where
    a contact references a formation that's been deleted between
    snapshot assembly and this method (shouldn't happen inside one
    transaction; here as belt-and-braces).
    """
    for f in snapshot.formations:
        if f.formation_id == contact.formation_id:
            return f.name
    return None


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
    return RGB(r, g, b)
