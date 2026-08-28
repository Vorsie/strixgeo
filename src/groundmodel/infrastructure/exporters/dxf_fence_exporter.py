"""DXF exporter for the 3-D fence diagram — v1.0 MVP gate (owner ballot 2026-08-26).

The fence diagram (vertical cross-section wall panels standing in 3-D
space) becomes a deliverable via DXF rather than a picture: a PNG scene
capture is not something an engineer can open in AutoCAD/Civil3D,
isolate by layer, or measure. The wall geometry itself is assembled
**client-side** by ``desktop/src/renderer/src/utils/fencePanels.ts`` from
the section partition engine — the server has no way to rebuild it, so
this exporter RECEIVES already-triangulated panels
(:class:`~groundmodel.infrastructure.exporters.fence_panel_source.FencePanelSource`)
rather than deriving them from the database.

Coordinate system in the DXF
----------------------------
Coordinates are written **as-is** in the project's projected CRS, in
metres (``$INSUNITS`` = 6 = ``ezdxf.units.M``) — no reprojection. The
source CRS is the project's ``default_horizontal_epsg`` (EPSG 31370 or
28992 for BE/NL projects); the caller passes it through and this module
records it as a ``$CUSTOMPROPERTY`` named ``EPSG`` in the DXF header
(visible in AutoCAD's Drawing Properties dialog) so a receiver can tell
which projected CRS the X/Y values are in.

What the DXF carries
---------------------
One ``3DFACE`` entity per triangle, grouped onto one DXF layer per
``formation_id`` (named after the panel's display ``name``, coloured
with the panel's ``color``). Each face has its INTERIOR edges (shared
with a neighbouring triangle in the same panel) marked invisible via
the 3DFACE edge-visibility flags, so CAD renders a clean panel outline
instead of a visible triangle mesh — deterministic, with no boundary-
walk / outline-polyline pass needed (and no multi-loop failure mode to
debug if one existed).

Why this is NOT a ``SectionExporter``
--------------------------------------
``SectionExporter.export()`` (``section_exporter.py``) takes a
``SectionSnapshot`` — one section's geometry, assembled by an
application-layer use case from the database. A fence is the opposite
shape: pre-triangulated 3-D wall geometry the RENDERER assembles from
its own partition-fill state and hands to the server whole, because the
server cannot reconstruct it. Bending the ABC to accept "a snapshot or a
bag of client-built panels" would blur the one input shape it exists to
enforce, for a debt (#109, the ``BaseExporter`` ABC split) this change
does not need to resolve tonight. ``DxfFenceExporter`` is therefore a
standalone ``GroundModelLogger`` class with its own ``export()`` shape.
"""

from __future__ import annotations

import io
from collections import Counter
from collections.abc import Callable, Sequence

import ezdxf
from ezdxf.colors import RGB
from ezdxf.document import Drawing
from ezdxf.layouts.layout import Modelspace
from ezdxf.units import M as INSUNITS_METRES

from groundmodel.infrastructure.exporters.dxf_fence_exporter_constants import (
    DEFAULT_LAYER_RGB,
    FENCE_LAYER_PREFIX,
    FORBIDDEN_LAYER_CHARS,
    MAX_LAYER_NAME_LEN,
)
from groundmodel.infrastructure.exporters.dxf_layer_style import style_layer
from groundmodel.infrastructure.exporters.fence_panel_source import FencePanelSource
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# A 3DFACE built from 3 vertices gets a 4th, duplicated vertex from ezdxf
# (vtx3 = vtx2) so DXF edge index 2 (vtx2-vtx3) is always a zero-length,
# degenerate edge — hiding it is cosmetic (it can never draw) but keeps
# the emitted flags honest about what is a "real" triangle edge.
_DEGENERATE_CLOSING_EDGE_INDEX = 2

# Maps a triangle's three real edges, in vertex order (a, b, c), to the
# 3DFACE edge-visibility index ezdxf exposes for a 3-vertex face: edge
# (a, b) -> 0, edge (b, c) -> 1, edge (c, a) -> 3 (index 2 is the
# degenerate closing edge above, never one of the triangle's real edges).
_TRIANGLE_EDGE_TO_FACE_INDEX = (0, 1, 3)


class DxfFenceExporter(GroundModelLogger):
    """Serialise client-built fence wall panels to DXF bytes."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def export(
        self,
        panels: Sequence[FencePanelSource],
        *,
        project_name: str,
        crs_epsg: int | None,
    ) -> bytes:
        """Build the fence DXF and return the serialised bytes.

        Parameters
        ----------
        panels : Sequence[FencePanelSource]
            Already-triangulated, already-validated wall panels (triangle
            indices are guaranteed in range by
            ``FenceExportRequest``'s validator).
        project_name : str
            Project name, written to ``$PROJECTNAME`` and used for the
            default download filename by the caller.
        crs_epsg : int or None
            The project's horizontal EPSG code. ``None`` when the project
            has no resolvable default (legacy project with no
            investigation to fall back to) — the DXF is still emitted,
            just without the ``EPSG`` custom property.

        Returns
        -------
        bytes
            DXF file content (UTF-8 encoded) ready to stream as an HTTP
            response body.
        """
        self.info(
            f"Exporting fence DXF: project={project_name!r} "
            f"panels={len(panels)} crs_epsg={crs_epsg}"
        )
        doc = ezdxf.new(dxfversion="R2018", setup=True)
        msp = doc.modelspace()

        doc.header["$PROJECTNAME"] = project_name[:255]
        # Both BE (Lambert 72, EPSG 31370) and NL (RD New, EPSG 28992)
        # project CRSes are metric, and setup=True already defaults to
        # metres — set explicitly so the choice is documented, not implicit.
        doc.header["$INSUNITS"] = INSUNITS_METRES
        if crs_epsg is not None:
            doc.header.custom_vars.append("EPSG", str(crs_epsg))
        else:
            self.warning(
                "Fence DXF export has no resolvable project CRS EPSG — "
                "header omits the EPSG custom property "
                f"project={project_name!r}"
            )

        layer_by_formation_id = self._setup_layers(doc, panels)
        face_count = self._draw_panels(msp, panels, layer_by_formation_id)

        sink = io.StringIO()
        doc.write(sink)
        payload = sink.getvalue().encode("utf-8")
        self.success(
            f"Fence DXF exported: project={project_name!r} "
            f"panels={len(panels)} layers={len(layer_by_formation_id)} "
            f"faces={face_count} size={len(payload)} bytes"
        )
        return payload

    # ------------------------------------------------------------------
    # Layer setup — one per distinct formation_id across all panels.
    # ------------------------------------------------------------------

    def _setup_layers(self, doc: Drawing, panels: Sequence[FencePanelSource]) -> dict[str, str]:
        """Register one DXF layer per distinct ``formation_id``.

        The FIRST panel seen for a given ``formation_id`` decides that
        layer's display name and colour; later panels for the same
        formation only contribute faces to the already-registered layer.
        Mirrors ``dxf_section_exporter.py``'s ``_setup_layers`` collision
        handling: two panels can want the same sanitised layer name (two
        distinct formations that happen to share a display name), so a
        collision is disambiguated instead of raising.

        Parameters
        ----------
        doc : ezdxf.document.Drawing
            The DXF document being built.
        panels : Sequence[FencePanelSource]
            The panels to export.

        Returns
        -------
        dict[str, str]
            ``formation_id -> layer name``.
        """
        layer_by_formation_id: dict[str, str] = {}
        for panel in panels:
            if panel.formation_id in layer_by_formation_id:
                continue
            layer_name = _sanitise_layer_name(panel.name)
            if doc.layers.has_entry(layer_name):
                layer_name = _disambiguate_layer_name(
                    layer_name, panel.formation_id, doc.layers.has_entry
                )
                self.warning(
                    f"DXF layer name collision on fence panel {panel.name!r} "
                    f"(formation_id={panel.formation_id}) — exporting it as "
                    f"{layer_name!r}"
                )
            layer = doc.layers.add(name=layer_name)
            rgb = _parse_hex_color(panel.color)
            # style_layer, not a bare ``layer.rgb =``: the visible 3DFACE edges
            # are drawn from the INDEX colour, which defaults to white, and
            # from LWDEFAULT, which is heavier than a panel edge should be
            # (owner 2026-08-28: "the white bounding lines are a bit thick").
            style_layer(layer, rgb if rgb is not None else DEFAULT_LAYER_RGB)
            layer_by_formation_id[panel.formation_id] = layer_name
        return layer_by_formation_id

    # ------------------------------------------------------------------
    # Face emission — one 3DFACE per triangle, interior edges hidden.
    # ------------------------------------------------------------------

    def _draw_panels(
        self,
        msp: Modelspace,
        panels: Sequence[FencePanelSource],
        layer_by_formation_id: dict[str, str],
    ) -> int:
        """Emit one 3DFACE per triangle across every panel.

        Parameters
        ----------
        msp
            The ezdxf modelspace to draw into.
        panels : Sequence[FencePanelSource]
            The panels to draw.
        layer_by_formation_id : dict[str, str]
            ``formation_id -> layer name`` from ``_setup_layers``.

        Returns
        -------
        int
            Total number of 3DFACE entities emitted, for the success log.
        """
        total = len(panels)
        face_count = 0
        for i, panel in enumerate(panels, start=1):
            layer_name = layer_by_formation_id[panel.formation_id]
            edge_flags = interior_triangle_edges(panel.triangles)
            for triangle, (ab_interior, bc_interior, ca_interior) in zip(
                panel.triangles, edge_flags, strict=True
            ):
                a, b, c = triangle
                face = msp.add_3dface(
                    (panel.vertices[a], panel.vertices[b], panel.vertices[c]),
                    dxfattribs={"layer": layer_name},
                )
                face.set_edge_visibility(_DEGENERATE_CLOSING_EDGE_INDEX, False)
                for is_interior, face_edge_index in zip(
                    (ab_interior, bc_interior, ca_interior), _TRIANGLE_EDGE_TO_FACE_INDEX
                ):
                    if is_interior:
                        face.set_edge_visibility(face_edge_index, False)
                face_count += 1
            self.debug(
                f"[{i}/{total}] panel formation_id={panel.formation_id} "
                f"faces={len(panel.triangles)}"
            )
        return face_count


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test.
# ---------------------------------------------------------------------------


def interior_triangle_edges(
    triangles: Sequence[tuple[int, int, int]],
) -> list[tuple[bool, bool, bool]]:
    """Flag which edge of each triangle is shared with another triangle.

    An undirected edge (unordered vertex-index pair) that appears in TWO
    triangles is an interior edge of the panel's triangle mesh; one that
    appears in only one triangle is a boundary edge. This is a pure
    topology check over the index arrays — it needs no vertex coordinates.

    Parameters
    ----------
    triangles : Sequence[tuple[int, int, int]]
        Triangle faces as ``(a, b, c)`` vertex indices.

    Returns
    -------
    list[tuple[bool, bool, bool]]
        Parallel to ``triangles``. Each entry is
        ``(ab_interior, bc_interior, ca_interior)`` for that triangle's
        three edges, in the same ``(a, b), (b, c), (c, a)`` order.
    """
    edge_counts: Counter[tuple[int, int]] = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            edge_counts[(min(u, v), max(u, v))] += 1

    flags: list[tuple[bool, bool, bool]] = []
    for a, b, c in triangles:
        ab = edge_counts[(min(a, b), max(a, b))] >= 2
        bc = edge_counts[(min(b, c), max(b, c))] >= 2
        ca = edge_counts[(min(c, a), max(c, a))] >= 2
        flags.append((ab, bc, ca))
    return flags


def _sanitise_layer_name(name: str) -> str:
    """Sanitise a panel display name into a DXF-safe layer name.

    DXF forbids ``< > / \\ " : ; ? * | = '`` in layer names; we strip
    them rather than substitute, matching ``dxf_section_exporter.py``'s
    ``_formation_layer_name`` (geological/geotechnical unit names rarely
    contain these characters, and the rare one that does reads better
    with the character dropped than with a placeholder underscore).
    """
    safe = "".join(c for c in name if c not in FORBIDDEN_LAYER_CHARS)
    return (FENCE_LAYER_PREFIX + safe.strip())[:MAX_LAYER_NAME_LEN]


def _disambiguate_layer_name(
    taken_name: str,
    formation_id: str,
    is_taken: Callable[[str], bool],
) -> str:
    """Derive a free layer name for a formation whose sanitised name is already claimed.

    Appends the formation id's first 8 characters so the two colliding
    layers are told apart by something stable and traceable back to the
    model, rather than an arbitrary ``(2)``. Mirrors
    ``dxf_section_exporter.py``'s ``_disambiguated_layer_name``.

    Parameters
    ----------
    taken_name : str
        The already-claimed candidate layer name (prefix included).
    formation_id : str
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
    short_id = formation_id.replace("-", "")[:8]
    body = taken_name[len(FENCE_LAYER_PREFIX) :]

    def _with_suffix(suffix: str) -> str:
        # Trim the BODY, not the finished name: truncating afterwards
        # would cut the suffix off a 255-char name and reproduce the
        # collision it exists to resolve.
        budget = MAX_LAYER_NAME_LEN - len(FENCE_LAYER_PREFIX) - len(suffix)
        return _sanitise_layer_name(body[:budget].rstrip() + suffix)

    candidate = _with_suffix(f" ({short_id})")
    counter = 2
    while is_taken(candidate):
        candidate = _with_suffix(f" ({short_id}-{counter})")
        counter += 1
    return candidate


def _parse_hex_color(hex_str: str) -> RGB | None:
    """Parse a ``#rrggbb`` (or 3-digit ``#rgb``) string into ezdxf's RGB.

    Returns ``None`` on unparseable input — caller falls back to
    ``DEFAULT_LAYER_RGB`` rather than raising. Mirrors
    ``dxf_section_exporter.py``'s ``_parse_hex_color``.
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
