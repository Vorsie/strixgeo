groundmodel.infrastructure.exporters.dxf_fence_exporter
=======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 1-102
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's long description of the fence DXF export — why it is a DXF and not a picture, that it RECEIVES already-triangulated wall panels from the renderer, its coordinate system (project CRS metres, no reprojection, EPSG recorded in the header), what the DXF carries (one 3DFACE per triangle, layers named by the unit's machine identifier, same-identifier panels sharing one layer, interior edges hidden), and why it is not a ``SectionExporter`` — followed by the deferred ezdxf imports and the imports of the fence constants, the styling and text helpers, the panel Protocol, the identifier builder, and the logging base class.

**Why it is here.** The fence diagram (the vertical section walls standing in 3-D space) becomes a deliverable via DXF because a PNG scene capture cannot be opened in CAD, isolated by layer, or measured. A *3DFACE* is a DXF flat three- or four-cornered face. The wall geometry is assembled client-side and the server has no twin able to rebuild it, so this exporter receives the triangulated panels rather than deriving them. Naming layers by the machine identifier (debt #104) and letting same-identifier panels share one layer delivers the same outcome as export thinning without merging any geometry (a visible seam between two same-identifier panels is an upstream connectivity bug, not this exporter's to paper over). It is NOT a ``SectionExporter`` because that base class takes a database-assembled snapshot and a fence is the opposite shape — pre-triangulated client geometry — so it is a standalone ``GroundModelLogger`` class (docs/exports.md).

.. CG-EXPLANATION-END id=module-header

Class ``FenceFormationIdentity``
--------------------------------

.. CG-BLOCK id=class:FenceFormationIdentity lines=103-129

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 103-129
   :lineno-match:

.. CG-EXPLANATION-START id=class:FenceFormationIdentity

**What this does.** A frozen data holder for the machine identity a fence layer name is derived from: the NAD class and the base lithology soil code.

**Why it is here.** The renderer-POSTed panel carries no NAD class or soil code, so the export route looks them up from the panel's formation id and hands them in, keyed by that id. It holds data only, so it does not inherit the logger (CLAUDE.md).

.. CG-EXPLANATION-END id=class:FenceFormationIdentity

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=130-138

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 130-138
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Two module constants that map a triangle's edges to the 3DFACE edge-visibility slots: the index of the degenerate closing edge ezdxf adds to a three-vertex face, and the mapping from the triangle's three real edges (a-b, b-c, c-a) to the face's visibility indices.

**Why it is here.** A 3DFACE built from three vertices gets a fourth, duplicated vertex, so one of its four edges is always a zero-length closing edge; naming these indices keeps the edge-hiding code readable and honest about which edges are real triangle edges.

.. CG-EXPLANATION-END id=module-statements

Class ``DxfFenceExporter`` — header
-----------------------------------

.. CG-BLOCK id=class:DxfFenceExporter lines=139-141

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 139-141
   :lineno-match:

.. CG-EXPLANATION-START id=class:DxfFenceExporter

**What this does.** Declares the fence exporter as a plain ``GroundModelLogger`` class — not one of the three exporter base classes.

**Why it is here.** Its input is client-built panels, not a snapshot, so it does not fit any of the three input-contract base classes and inherits only the logging mixin; its single-instance shape does not justify minting a fourth base class (docs/exports.md).

.. CG-EXPLANATION-END id=class:DxfFenceExporter

Method ``DxfFenceExporter``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:DxfFenceExporter.__init__ lines=142-145

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 142-145
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfFenceExporter.__init__

**What this does.** The set-up method; it only registers the module-named logger.

**Why it is here.** The exporter keeps no state between calls, so the logger is all there is to set up.

.. CG-EXPLANATION-END id=method:DxfFenceExporter.__init__

Method ``DxfFenceExporter``. ``def export``
-------------------------------------------

.. CG-BLOCK id=method:DxfFenceExporter.export lines=146-247

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 146-247
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfFenceExporter.export

**What this does.** The entry point that builds the fence DXF and returns the bytes. It logs the inputs; creates a fresh R2018 drawing; stamps the project name, the metres unit and (when known) the EPSG code into the header; registers the layers; draws one 3DFACE per triangle across every panel; writes and encodes the drawing; logs identifier coverage and a success line (counting distinct layers, not formations); and returns.

**Why it is here.** The EPSG rides in the header as a custom property so a receiver can tell which projected CRS the X/Y values are in; when the project has no resolvable CRS the DXF is still emitted, just without that property, with a warning. Counting distinct layers reflects that same-identifier formations collapse onto one layer, which is the whole point of the naming.

.. CG-EXPLANATION-END id=method:DxfFenceExporter.export

Method ``DxfFenceExporter``. ``def _setup_layers``
--------------------------------------------------

.. CG-BLOCK id=method:DxfFenceExporter._setup_layers lines=248-320

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 248-320
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfFenceExporter._setup_layers

**What this does.** Registers the DXF layers and returns a formation-id-to-layer-name map. A panel's layer name is the unit's machine identifier (``Fence-NAD-06_ZAND``) when the route resolved one, otherwise the panel's display name; same-identifier panels deliberately share one layer, while distinct formations that share a sanitised display name are disambiguated. When several formations collapse onto one layer, the layer takes the colour of the shallowest contributing panel (tie-broken by formation id), styled once after every panel has voted.

**Why it is here.** Sharing one layer per identifier is the ruling (``two units of the same identifier land on one layer``), and it is the fence's stand-in for export thinning, which cannot run here because it needs the per-column depth contacts a triangulated fence does not carry. The shallowest-panel-wins colour rule is debt #104b's ``shallower parent wins`` expressed geometrically; for the common geotech case there is no conflict, because the NAD colour is a function of the class so every same-class panel already carries the same colour. Styling once, after voting, keeps the colour independent of the order the panels arrived in.

.. CG-EXPLANATION-END id=method:DxfFenceExporter._setup_layers

Method ``DxfFenceExporter``. ``def _layer_name_for``
----------------------------------------------------

.. CG-BLOCK id=method:DxfFenceExporter._layer_name_for lines=321-368

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 321-368
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfFenceExporter._layer_name_for

**What this does.** Resolves — and registers, if new — the layer name for one panel: for a machine identifier it reuses an already-registered layer without disambiguating, and for a fallback display name it disambiguates a distinct formation that shares a sanitised name (with a warning).

**Why it is here.** The two collision rules are the whole point of the ruling: identifier layers COLLAPSE (every same-class body lands on one material layer), while display-name layers DISAMBIGUATE so neither formation silently absorbs the other's geometry — exactly as the section exporter does.

.. CG-EXPLANATION-END id=method:DxfFenceExporter._layer_name_for

Method ``DxfFenceExporter``. ``def _draw_panels``
-------------------------------------------------

.. CG-BLOCK id=method:DxfFenceExporter._draw_panels lines=369-422

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 369-422
   :lineno-match:

.. CG-EXPLANATION-START id=method:DxfFenceExporter._draw_panels

**What this does.** Emits one 3DFACE per triangle across every panel, marking each triangle's interior edges (those shared with a neighbouring triangle in the same panel) invisible so CAD shows a clean panel outline rather than the triangle mesh. Returns the total face count.

**Why it is here.** Hiding the shared edges is deterministic edge counting — no boundary-walk pass and no multi-loop failure mode to debug — and the degenerate closing edge is hidden too so the emitted visibility flags stay honest about what is a real triangle edge.

.. CG-EXPLANATION-END id=method:DxfFenceExporter._draw_panels

Function ``def _resolve_layer_body``
------------------------------------

.. CG-BLOCK id=function:_resolve_layer_body lines=423-458

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 423-458
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_layer_body

**What this does.** Returns the layer-name body for one panel plus a flag saying whether it is a machine identifier or a display name — the identifier when the route resolved an identity that yields one, otherwise the panel's display name.

**Why it is here.** The flag tells the caller which collision rule to apply: identifier bodies collapse onto one shared layer, display-name bodies disambiguate.

.. CG-EXPLANATION-END id=function:_resolve_layer_body

Function ``def _panel_top``
---------------------------

.. CG-BLOCK id=function:_panel_top lines=459-481

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 459-481
   :lineno-match:

.. CG-EXPLANATION-START id=function:_panel_top

**What this does.** Returns the panel's shallowest vertex elevation (its highest z), or ``None`` when the panel has no vertices.

**Why it is here.** It is used only to pick the colour of a layer several formations collapse onto — the shallowest panel wins — so an empty panel has no top and does not compete.

.. CG-EXPLANATION-END id=function:_panel_top

Function ``def _colour_candidate_wins``
---------------------------------------

.. CG-BLOCK id=function:_colour_candidate_wins lines=482-505

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 482-505
   :lineno-match:

.. CG-EXPLANATION-START id=function:_colour_candidate_wins

**What this does.** Decides whether one colour candidate should replace another as a layer's colour: the shallower panel (higher top elevation) wins, with an exact tie broken by the lower formation id.

**Why it is here.** Tie-breaking on the formation id makes the winning colour independent of the order the panels arrive in.

.. CG-EXPLANATION-END id=function:_colour_candidate_wins

Function ``def interior_triangle_edges``
----------------------------------------

.. CG-BLOCK id=function:interior_triangle_edges lines=506-541

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 506-541
   :lineno-match:

.. CG-EXPLANATION-START id=function:interior_triangle_edges

**What this does.** For each triangle, flags which of its three edges is shared with another triangle in the same panel: an undirected edge (an unordered pair of vertex indices) appearing in two triangles is interior, one appearing in only a single triangle is a boundary edge. It is a pure topology check over the index arrays and needs no vertex coordinates.

**Why it is here.** It is what lets the drawing pass hide only the interior edges, turning the panel's triangle mesh into a clean outline in CAD.

.. CG-EXPLANATION-END id=function:interior_triangle_edges

Function ``def _sanitise_layer_name``
-------------------------------------

.. CG-BLOCK id=function:_sanitise_layer_name lines=542-556

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 542-556
   :lineno-match:

.. CG-EXPLANATION-START id=function:_sanitise_layer_name

**What this does.** Turns a panel display name into a DXF-safe layer name: strips CR/LF, drops the forbidden characters, prepends the ``Fence-`` prefix, and truncates to 255 characters.

**Why it is here.** It mirrors the section exporter's ``_formation_layer_name`` — the same forbidden set, the same strip-not-substitute choice, and the same reason for stripping CR/LF first (a line break corrupts the line-oriented DXF stream and ezdxf's only guard is an ``assert`` that ``python -O`` drops).

.. CG-EXPLANATION-END id=function:_sanitise_layer_name

Function ``def _disambiguate_layer_name``
-----------------------------------------

.. CG-BLOCK id=function:_disambiguate_layer_name lines=557-602

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 557-602
   :lineno-match:

.. CG-EXPLANATION-START id=function:_disambiguate_layer_name

**What this does.** Derives a free layer name for a formation whose sanitised name is already claimed by appending the formation id's first 8 characters, widening the suffix if needed, and re-deriving through the sanitiser.

**Why it is here.** It mirrors the section exporter's disambiguator — a stable, traceable suffix rather than an arbitrary ``(2)``, added by trimming the body so truncation can never cut the suffix off and reproduce the collision.

.. CG-EXPLANATION-END id=function:_disambiguate_layer_name

Function ``def _parse_hex_color``
---------------------------------

.. CG-BLOCK id=function:_parse_hex_color lines=603-629

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter.py
   :language: python
   :lines: 603-629
   :lineno-match:

.. CG-EXPLANATION-START id=function:_parse_hex_color

**What this does.** Parses a ``#rrggbb`` (or three-digit ``#rgb``) string into ezdxf's RGB, returning ``None`` on unparseable input.

**Why it is here.** It mirrors the section exporter's parser — a malformed colour falls back to the default grey rather than blocking the export of valid geometry.

.. CG-EXPLANATION-END id=function:_parse_hex_color

