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
One ``3DFACE`` entity per triangle. Faces are grouped onto DXF layers
named by the unit's **machine identifier** — ``Fence-NAD-06_ZAND`` for a
geotech unit, ``Fence-ZAND`` for a litho unit — built by the shared
``unit_identifier`` scheme the section DXF and Plaxis exports already use
(debt #104), NOT by the panel's display ``name``. Two consequences the
owner asked for (2026-08-28):

* **A layer name identifies the unit.** ``Fence-NAD-06_ZAND`` tells a CAD
  user which packing class the panel is, where the old ``Fence-SAND``
  (display name) plus a uuid8 collision suffix told them nothing — 34 of
  the owner's formations shared one uuid8 prefix.
* **Panels of the same identifier share ONE layer** ("extend thinning to
  the fence"). The #104b ``ThinExportUnits`` pass cannot run here — it
  needs a ``SectionSnapshot``'s per-column depth contacts, which a
  triangulated 3-D fence does not carry — but naming the layer by the
  bare identifier delivers the same outcome: every same-class body lands
  on one material layer. No panel GEOMETRY is merged (owner: connected
  bodies are already merged upstream in the sections stage); a visible
  seam between two same-identifier panels is an UPSTREAM connectivity
  bug, not the exporter's to paper over.

The unit's ``nad_class`` + ``litho_main_soil_code`` are NOT on the
renderer-POSTed panel; the export route looks them up from the panel's
``formation_id`` and passes them in ``identity_by_formation_id``. A unit
that carries neither (a geological formation, or a formation the lookup
could not resolve) keeps its display ``name`` as the layer, byte-
identical to before, and is disambiguated on collision as before.

Each face has its INTERIOR edges (shared with a neighbouring triangle in
the same panel) marked invisible via the 3DFACE edge-visibility flags,
so CAD renders a clean panel outline instead of a visible triangle mesh
— deterministic, with no boundary-walk / outline-polyline pass needed
(and no multi-loop failure mode to debug if one existed).

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
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # deferred: ezdxf is imported lazily inside the methods that build the drawing
    # (see ``export`` and ``_parse_hex_color``) so importing this exporter at API
    # boot (a router pulls it in to register a route) does not pay ezdxf's import
    # cost.
    from ezdxf.colors import RGB
    from ezdxf.document import Drawing
    from ezdxf.layouts.layout import Modelspace

from groundmodel.infrastructure.exporters.dxf_fence_exporter_constants import (
    BODY_ID_XDATA_APPID,
    BODY_ID_XDATA_STRING_CODE,
    DEFAULT_LAYER_RGB,
    FENCE_LAYER_PREFIX,
    FORBIDDEN_LAYER_CHARS,
    MAX_LAYER_NAME_LEN,
    SECTION_UNIT_SEPARATOR,
)
from groundmodel.infrastructure.exporters.dxf_layer_style import style_layer
from groundmodel.infrastructure.exporters.dxf_text_safety import strip_dxf_line_breaks
from groundmodel.infrastructure.exporters.fence_panel_source import FencePanelSource
from groundmodel.infrastructure.exporters.unit_identifier import unit_identifier
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class FenceFormationIdentity:
    """The machine-identity a fence layer name is derived from (debt #104).

    The renderer-POSTed panel carries no ``nad_class`` / ``litho_main_soil_code``
    — the export route looks them up from the panel's ``formation_id`` and hands
    them in, keyed by that id. Data only, no behaviour, so it does not inherit
    ``GroundModelLogger`` (CLAUDE.md "Logging via inheritance").

    Attributes
    ----------
    nad_class : int | None
        Belgian NAD packing class 1..31 on a geotechnical unit; ``None`` on a
        litho unit, a geological formation, or an unclassified geotech band.
    litho_main_soil_code : str | None
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN) on a litho or
        geotech unit; ``None`` on a geological formation.
    """

    nad_class: int | None
    litho_main_soil_code: str | None


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
        identity_by_formation_id: Mapping[str, FenceFormationIdentity] | None = None,
        section_name_by_id: Mapping[str, str] | None = None,
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
        identity_by_formation_id : Mapping[str, FenceFormationIdentity] or None
            The ``nad_class`` + ``litho_main_soil_code`` of each panel's
            formation, resolved by the export route from the panel's
            ``formation_id`` (debt #104). Used to name each layer by the
            unit's machine identifier. ``None`` / empty (or a formation not
            in the map) falls back to the panel's display ``name`` for that
            layer — the pre-#104 behaviour, so a geological-model fence and
            any caller that omits the map are unchanged.
        section_name_by_id : Mapping[str, str] or None
            ``section_id -> section name``, resolved by the export route from
            each panel's ``section_id`` (owner ruling 2026-09-05). Splits the
            layers per section — a layer is ``Fence-<section>_<unit>`` — so a
            whole section can be switched off in CAD while a unit stays
            selectable across sections. ``None`` / empty (or a panel whose
            ``section_id`` is ``None`` or absent from the map) keeps the
            pre-section ``Fence-<unit>`` name, so a legacy caller is unchanged
            and never loses geometry.

        Returns
        -------
        bytes
            DXF file content (UTF-8 encoded) ready to stream as an HTTP
            response body.
        """
        identities = identity_by_formation_id or {}
        section_names = section_name_by_id or {}
        self.info(
            f"Exporting fence DXF: project={project_name!r} "
            f"panels={len(panels)} crs_epsg={crs_epsg} "
            f"identities={len(identities)} sections={len(section_names)}"
        )
        # deferred: keeps ezdxf off the API boot path (see the module imports).
        import ezdxf
        from ezdxf.units import M as INSUNITS_METRES

        doc = ezdxf.new(dxfversion="R2018", setup=True)
        msp = doc.modelspace()
        # Register the app id BEFORE any entity sets XDATA under it — ezdxf
        # requires the APPID table entry to exist first. Each wall's body id
        # rides here (see ``_draw_panels``).
        doc.appids.add(BODY_ID_XDATA_APPID)

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

        layer_by_key = self._setup_layers(doc, panels, identities, section_names)
        # Layer count per section (owner ruling 2026-09-05) — "my CS3 walls
        # vanished" must be diagnosable from the log alone. ``None`` groups the
        # sectionless panels (a legacy caller, or a section the route could not
        # resolve to a name).
        layers_per_section: dict[str | None, set[str]] = {}
        for (section_label, _formation_id), layer_name in layer_by_key.items():
            layers_per_section.setdefault(section_label, set()).add(layer_name)
        for section_label, layer_names in sorted(
            layers_per_section.items(), key=lambda item: (item[0] is None, item[0] or "")
        ):
            self.info(f"Fence DXF section {section_label!r}: {len(layer_names)} layer(s)")

        face_count = self._draw_panels(msp, panels, layer_by_key, section_names)

        sink = io.StringIO()
        doc.write(sink)
        payload = sink.getvalue().encode("utf-8")
        # Identifier coverage (debt #104): "my geotech fence DXF has no NAD
        # layer names" must be diagnosable from the log alone. Count the
        # DISTINCT formations that resolved to an identifier vs fell back to
        # their display name.
        identifier_formations = sum(
            1
            for fid, identity in identities.items()
            if unit_identifier(
                nad_class=identity.nad_class,
                litho_main_soil_code=identity.litho_main_soil_code,
            )
            is not None
        )
        # Distinct layer count, not (section, formation) count — same-identifier
        # formations collapse onto one layer within a section, which is the whole
        # point of the naming.
        self.success(
            f"Fence DXF exported: project={project_name!r} "
            f"panels={len(panels)} "
            f"section_units={len(layer_by_key)} "
            f"layers={len(set(layer_by_key.values()))} "
            f"sections={len(layers_per_section)} "
            f"[identifier-named formations {identifier_formations}] "
            f"faces={face_count} size={len(payload)} bytes"
        )
        return payload

    # ------------------------------------------------------------------
    # Layer setup — one per distinct unit IDENTIFIER (debt #104), collapsing
    # same-identifier formations, with a name fallback for the unclassified.
    # ------------------------------------------------------------------

    def _setup_layers(
        self,
        doc: Drawing,
        panels: Sequence[FencePanelSource],
        identity_by_formation_id: Mapping[str, FenceFormationIdentity],
        section_name_by_id: Mapping[str, str],
    ) -> dict[tuple[str | None, str], str]:
        """Register the DXF layers and return ``(section, formation_id) -> layer``.

        The grouping key is ``(section label, formation_id)`` (owner ruling
        2026-09-05): the SAME formation crossing two sections lands on two
        layers, so a whole section can be switched off in CAD. The section label
        leads the layer name (``Fence-<section>_<unit>``); a panel with no
        resolvable section (``section_id`` ``None`` or absent from the map) keeps
        the pre-section ``Fence-<unit>`` name.

        Within one section a panel's unit part is the unit's machine identifier
        (``NAD-06_ZAND``) when the route resolved one for its formation, else the
        panel's display ``name`` (``Boom Klei``). The two paths differ in
        collision handling, which is the whole point of the earlier ruling:

        * **Identifier path** — panels of the SAME identifier IN THE SAME SECTION
          deliberately share ONE layer ("two units of the same identifier land on
          one layer"), so an already-registered identifier layer is reused, never
          disambiguated.
        * **Display-name path** — two DISTINCT formations that happen to share a
          sanitised name are disambiguated so each keeps its own surface, exactly
          as before #104 (and as ``dxf_section_exporter.py`` does).

        When several formations collapse onto one identifier layer they may carry
        different colours (a litho colour, or an engineer's ``color_override``);
        the layer takes the colour of the SHALLOWEST contributing panel — highest
        top elevation, #104b's "shallower parent wins" expressed geometrically —
        tie-broken by ``formation_id`` so the choice never depends on the order
        the panels arrive in. For the common geotech case there is no conflict:
        the NAD colour is a function of the class, so every ``NAD-06_ZAND`` panel
        already carries the same colour.

        Parameters
        ----------
        doc : ezdxf.document.Drawing
            The DXF document being built.
        panels : Sequence[FencePanelSource]
            The panels to export.
        identity_by_formation_id : Mapping[str, FenceFormationIdentity]
            ``formation_id -> (nad_class, litho_main_soil_code)`` from the route.
        section_name_by_id : Mapping[str, str]
            ``section_id -> section name`` from the route; empty when no section
            was resolvable.

        Returns
        -------
        dict[tuple[str | None, str], str]
            ``(section label, formation_id) -> layer name``. Several keys can map
            to one layer (same-identifier collapse within a section).
        """
        layer_by_key: dict[tuple[str | None, str], str] = {}
        # Per layer, the shallowest contributor decides the colour:
        # (top_elevation, formation_id, rgb). A layer is styled once, after every
        # panel has voted, so the colour never depends on registration order.
        color_winner: dict[str, tuple[float, str, RGB | None]] = {}

        for panel in panels:
            section_label = _section_label(panel, section_name_by_id)
            key = (section_label, panel.formation_id)
            layer_name = layer_by_key.get(key)
            if layer_name is None:
                layer_name = self._layer_name_for(
                    doc, panel, identity_by_formation_id, section_label
                )
                layer_by_key[key] = layer_name

            top = _panel_top(panel)
            candidate = (
                top if top is not None else float("-inf"),
                panel.formation_id,
                _parse_hex_color(panel.color),
            )
            current = color_winner.get(layer_name)
            if current is None or _colour_candidate_wins(candidate, current):
                color_winner[layer_name] = candidate

        # style_layer, not a bare ``layer.rgb =``: the visible 3DFACE edges are
        # drawn from the INDEX colour (defaults to white) and from LWDEFAULT
        # (heavier than a panel edge should be) — owner 2026-08-28, "the white
        # bounding lines are a bit thick".
        for layer_name, (_, _, rgb) in color_winner.items():
            style_layer(doc.layers.get(layer_name), rgb if rgb is not None else DEFAULT_LAYER_RGB)
        return layer_by_key

    def _layer_name_for(
        self,
        doc: Drawing,
        panel: FencePanelSource,
        identity_by_formation_id: Mapping[str, FenceFormationIdentity],
        section_label: str | None,
    ) -> str:
        """Resolve (and register, if new) the layer name for one panel.

        Parameters
        ----------
        doc : ezdxf.document.Drawing
            The DXF document being built.
        panel : FencePanelSource
            The panel whose layer is being resolved.
        identity_by_formation_id : Mapping[str, FenceFormationIdentity]
            ``formation_id -> identity`` from the route.
        section_label : str or None
            The resolved section name leading the layer name, or ``None`` for a
            sectionless panel (pre-section ``Fence-<unit>`` naming).

        Returns
        -------
        str
            The layer name this panel's faces go on.
        """
        body, is_identifier = _resolve_layer_body(panel, identity_by_formation_id)
        layer_name = _sanitise_layer_name(_compose_section_body(section_label, body))
        if is_identifier:
            # Same-identifier collapse: reuse the existing layer, do NOT
            # disambiguate — that IS the ruling.
            if not doc.layers.has_entry(layer_name):
                doc.layers.add(name=layer_name)
            return layer_name
        # Fallback display-name path — disambiguate distinct formations sharing a
        # sanitised name so neither silently absorbs the other's geometry.
        if doc.layers.has_entry(layer_name):
            layer_name = _disambiguate_layer_name(
                layer_name, panel.formation_id, doc.layers.has_entry
            )
            self.warning(
                f"DXF layer name collision on fence panel {panel.name!r} "
                f"(formation_id={panel.formation_id}) — exporting it as "
                f"{layer_name!r}"
            )
        doc.layers.add(name=layer_name)
        return layer_name

    # ------------------------------------------------------------------
    # Face emission — one 3DFACE per triangle, interior edges hidden.
    # ------------------------------------------------------------------

    def _draw_panels(
        self,
        msp: Modelspace,
        panels: Sequence[FencePanelSource],
        layer_by_key: dict[tuple[str | None, str], str],
        section_name_by_id: Mapping[str, str],
    ) -> int:
        """Emit one 3DFACE per triangle across every panel.

        Every face of a panel that carries a ``body_id`` also gets that id as
        XDATA under ``BODY_ID_XDATA_APPID`` (owner ruling 2026-09-05), so a body
        is recoverable from any one of its faces without a bespoke plugin. An
        untied wall (``body_id`` ``None``) gets no XDATA — an empty tag would
        read as "some body" and be worse than nothing.

        Parameters
        ----------
        msp
            The ezdxf modelspace to draw into.
        panels : Sequence[FencePanelSource]
            The panels to draw.
        layer_by_key : dict[tuple[str | None, str], str]
            ``(section label, formation_id) -> layer name`` from
            ``_setup_layers``.
        section_name_by_id : Mapping[str, str]
            ``section_id -> section name`` — recomputes each panel's key the same
            way ``_setup_layers`` did.

        Returns
        -------
        int
            Total number of 3DFACE entities emitted, for the success log.
        """
        total = len(panels)
        face_count = 0
        for i, panel in enumerate(panels, start=1):
            layer_name = layer_by_key[
                (_section_label(panel, section_name_by_id), panel.formation_id)
            ]
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
                if panel.body_id is not None:
                    face.set_xdata(
                        BODY_ID_XDATA_APPID, [(BODY_ID_XDATA_STRING_CODE, panel.body_id)]
                    )
                face_count += 1
            self.debug(
                f"[{i}/{total}] panel formation_id={panel.formation_id} "
                f"section_id={panel.section_id} body_id={panel.body_id} "
                f"faces={len(panel.triangles)}"
            )
        return face_count


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test.
# ---------------------------------------------------------------------------


def _section_label(
    panel: FencePanelSource,
    section_name_by_id: Mapping[str, str],
) -> str | None:
    """Return the section name that leads this panel's layer, or ``None``.

    ``None`` for a panel that carries no ``section_id`` (a legacy caller) or one
    whose id the route could not resolve to a name — both keep the pre-section
    ``Fence-<unit>`` naming, so the section split never drops geometry.

    Parameters
    ----------
    panel : FencePanelSource
        The panel whose section is being resolved.
    section_name_by_id : Mapping[str, str]
        ``section_id -> section name`` from the route.

    Returns
    -------
    str | None
        The resolved section name, or ``None`` when there is no resolvable
        section.
    """
    if panel.section_id is None:
        return None
    return section_name_by_id.get(panel.section_id)


def _compose_section_body(section_label: str | None, body: str) -> str:
    """Join a section label and a unit body into the pre-sanitisation layer text.

    ``<section>_<body>`` when a section is present, else the bare ``body`` — so a
    sectionless panel keeps the exact pre-section name and a legacy caller is
    byte-identical.

    Parameters
    ----------
    section_label : str or None
        The resolved section name, or ``None`` for a sectionless panel.
    body : str
        The unit part — a machine identifier or a display name.

    Returns
    -------
    str
        The composed text, still to be prefixed + sanitised by
        ``_sanitise_layer_name``.
    """
    if section_label:
        return f"{section_label}{SECTION_UNIT_SEPARATOR}{body}"
    return body


def _resolve_layer_body(
    panel: FencePanelSource,
    identity_by_formation_id: Mapping[str, FenceFormationIdentity],
) -> tuple[str, bool]:
    """Return ``(layer-name body, is_identifier)`` for one panel.

    The body is the unit's machine identifier when the route resolved an
    identity for the panel's formation AND that identity yields one
    (``unit_identifier`` returns non-``None``); otherwise it is the panel's
    display ``name``. The boolean tells the caller which collision rule to
    apply — identifier bodies collapse, display-name bodies disambiguate.

    Parameters
    ----------
    panel : FencePanelSource
        The panel whose layer body is being resolved.
    identity_by_formation_id : Mapping[str, FenceFormationIdentity]
        ``formation_id -> identity`` from the route.

    Returns
    -------
    tuple[str, bool]
        ``(body, is_identifier)`` — the pre-sanitisation layer text and
        whether it is a machine identifier (``True``) or a display name.
    """
    identity = identity_by_formation_id.get(panel.formation_id)
    if identity is not None:
        identifier = unit_identifier(
            nad_class=identity.nad_class,
            litho_main_soil_code=identity.litho_main_soil_code,
        )
        if identifier is not None:
            return identifier, True
    return panel.name, False


def _panel_top(panel: FencePanelSource) -> float | None:
    """The panel's shallowest vertex elevation (max z), or ``None`` if empty.

    Used only to pick the colour of a layer several formations collapse onto:
    the shallowest panel wins. An empty panel (no vertices) has no top and does
    not compete.

    Parameters
    ----------
    panel : FencePanelSource
        The panel to measure.

    Returns
    -------
    float | None
        The highest elevation among the panel's vertices, or ``None`` when the
        panel carries no vertices.
    """
    if not panel.vertices:
        return None
    return max(v[2] for v in panel.vertices)


def _colour_candidate_wins(
    candidate: tuple[float, str, RGB | None],
    current: tuple[float, str, RGB | None],
) -> bool:
    """True when ``candidate`` should replace ``current`` as a layer's colour.

    The shallowest panel wins (higher top elevation); an exact tie is broken by
    the lower ``formation_id`` so the winner is independent of panel order.

    Parameters
    ----------
    candidate, current : tuple[float, str, RGB | None]
        ``(top_elevation, formation_id, rgb)`` triples.

    Returns
    -------
    bool
        Whether ``candidate`` beats ``current``.
    """
    if candidate[0] != current[0]:
        return candidate[0] > current[0]
    return candidate[1] < current[1]


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
    with the character dropped than with a placeholder underscore). CR/LF are
    stripped first because a line break corrupts the line-oriented DXF stream
    and ezdxf's only guard against it is an ``assert`` that ``python -O`` drops.
    """
    safe = "".join(c for c in strip_dxf_line_breaks(name) if c not in FORBIDDEN_LAYER_CHARS)
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
    # deferred: keeps ezdxf off the API boot path (see the module imports).
    from ezdxf.colors import RGB

    return RGB(r, g, b)
