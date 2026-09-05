desktop.renderer.src.shell.stages.geology.geology3DPrimitives
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1-54
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the big file of Cesium shape-builders and camera helpers for the 3-D geology viewer. Cesium is the 3-D globe library the viewers draw on; a primitive is one drawable object handed to it; a mesh is a shape built from many triangles; the camera is the virtual eye. It gathers the confidence and distance helpers that fade shapes by how far they sit from real data, the pure geometry maths from ``cesiumGeometry.ts``, and the footprint-ring builder, then disables Cesium's online ion account token because every basemap and the terrain come from the app's own providers. It ends by opening the block of visual constants.

**Why it is here.** The whole file was lifted verbatim out of the 1,700-line viewer component (debt #201) to get the primitive builders, the per-vertex-colour appearance, the scene rebuild, the fly-to helpers and the split-plane maths out of React and into one place. Disabling the ion token keeps the viewer fully offline and free of any cloud dependency.

.. CG-EXPLANATION-END id=module-header

``const Z_OFFSET_PER_ORDER``
----------------------------

.. CG-BLOCK id=const:Z_OFFSET_PER_ORDER lines=55-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 55-62
   :lineno-match:

.. CG-EXPLANATION-START id=const:Z_OFFSET_PER_ORDER

**What this does.** Holds 0.2 m — how far apart, vertically, successive formation surfaces are nudged by their stratigraphic order (``display_order``, oldest first).

**Why it is here.** It stops near-parallel surfaces from z-fighting — flickering because the graphics card cannot decide which is in front — and keeps their depth order stable against the opaque cut-face caps. The old 0.01 m was below the depth-buffer's resolution and never actually separated anything; 0.2 m is still invisible at a few-kilometre project extent but comfortably beats that precision.

.. CG-EXPLANATION-END id=const:Z_OFFSET_PER_ORDER

``const DEFAULT_BASEMAP_LID_ALPHA``
-----------------------------------

.. CG-BLOCK id=const:DEFAULT_BASEMAP_LID_ALPHA lines=63-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 63-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_BASEMAP_LID_ALPHA

**What this does.** Holds 0.65 — the transparency the shared 3-D stages draw the aerial-photo lid at.

**Why it is here.** It was a baked-in value until it was named here, so the Parameters fence cutout could dial ITS own copy without disturbing the stages (owner ruling B6b, 2026-08-27).

.. CG-EXPLANATION-END id=const:DEFAULT_BASEMAP_LID_ALPHA

``const SURFACE_CLIP_INSET_M``
------------------------------

.. CG-BLOCK id=const:SURFACE_CLIP_INSET_M lines=71-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 71-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:SURFACE_CLIP_INSET_M

**What this does.** Holds 0.5 m — how far the translucent surfaces are pulled back from the true split plane before being cut.

**Why it is here.** If a translucent cut edge landed exactly on the opaque cap that sits on the true plane, the two coincident surfaces would fail the depth test at random and shimmer along every band edge; receding the surfaces avoids that, and the caps fill the small gap so no step shows.

.. CG-EXPLANATION-END id=const:SURFACE_CLIP_INSET_M

``const ALPHA_FRESH``
---------------------

.. CG-BLOCK id=const:ALPHA_FRESH lines=74-76

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 74-76
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALPHA_FRESH

**What this does.** Holds 0.75 — the opacity of an up-to-date (non-stale) surface.

**Why it is here.** Fresh and stale surfaces follow the same current-versus-out-of-date opacity convention as the 2-D section canvas, so a surface reads the same way in both views; a fresh surface is the more solid of the two.

.. CG-EXPLANATION-END id=const:ALPHA_FRESH

``const ALPHA_STALE``
---------------------

.. CG-BLOCK id=const:ALPHA_STALE lines=77-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 77-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALPHA_STALE

**What this does.** Holds 0.35 — the opacity of a stale, out-of-date surface.

**Why it is here.** The comment ties it to the 2-D section canvas: a stale surface is drawn fainter, using the same convention as the section view, so needs-rebuilding reads the same way across both.

.. CG-EXPLANATION-END id=const:ALPHA_STALE

``const MIN_SPLIT_LINE_M``
--------------------------

.. CG-BLOCK id=const:MIN_SPLIT_LINE_M lines=81-84

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 81-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_SPLIT_LINE_M

**What this does.** Holds 10 m — the shortest drawn line that will be accepted as a valid split.

**Why it is here.** A near-zero-length line gives a degenerate, unstable plane normal, so the floor rejects it.

.. CG-EXPLANATION-END id=const:MIN_SPLIT_LINE_M

``const ALPHA_GROUND_SURFACE``
------------------------------

.. CG-BLOCK id=const:ALPHA_GROUND_SURFACE lines=85-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 85-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:ALPHA_GROUND_SURFACE

**What this does.** Holds 0.45 — the opacity of the DEM ground-surface mesh.

**Why it is here.** Semi-transparent so the formation surfaces below it stay visible through the terrain.

.. CG-EXPLANATION-END id=const:ALPHA_GROUND_SURFACE

``const GROUND_SURFACE_COLOR``
------------------------------

.. CG-BLOCK id=const:GROUND_SURFACE_COLOR lines=88-93

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 88-93
   :lineno-match:

.. CG-EXPLANATION-START id=const:GROUND_SURFACE_COLOR

**What this does.** Holds the ground-surface mesh colour — a warm earth-tone grey at the 0.45 opacity above.

**Why it is here.** An earth tone reads as terrain, and the transparency lets the model show through.

.. CG-EXPLANATION-END id=const:GROUND_SURFACE_COLOR

``const FLAGGED_SOLID_ALPHA``
-----------------------------

.. CG-BLOCK id=const:FLAGGED_SOLID_ALPHA lines=94-105

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 94-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:FLAGGED_SOLID_ALPHA

**What this does.** Holds 0.45 — the opacity used for a flagged body's marker disk. The block also carries the section comment and the start of the lid docstring.

**Why it is here.** The backend emits a translucent disk for a body when it could not build a proper watertight solid; drawing it semi-transparent makes it read as a local occurrence with no confirmed lateral extent rather than a filled body.

.. CG-EXPLANATION-END id=const:FLAGGED_SOLID_ALPHA

``interface BasemapLid``
------------------------

.. CG-BLOCK id=interface:BasemapLid lines=106-131

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 106-131
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BasemapLid

**What this does.** Names the aerial-photo lid: the Cesium rectangle to place it in, the elevation to place it at (the model top), and the one-shot image URL. The block also carries the builder's docstring.

**Why it is here.** It is the shape describing one georeferenced image draped flat as a cap on the geological block — not whole-globe imagery.

.. CG-EXPLANATION-END id=interface:BasemapLid

``function buildBasemapLid``
----------------------------

.. CG-BLOCK id=function:buildBasemapLid lines=132-158

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 132-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildBasemapLid

**What this does.** Builds the lid description by calling the pure footprint maths in ``cesiumGeometry.ts`` and, when it returns a result, wrapping the degree bounds in a Cesium rectangle. It returns ``null`` for non-Belgian projects or when there are no vertices yet.

**Why it is here.** The footprint and URL maths lives in the pure, testable file; this thin wrapper does only the one Cesium-object step that could not live there.

.. CG-EXPLANATION-END id=function:buildBasemapLid

``function flyToBounds``
------------------------

.. CG-BLOCK id=function:flyToBounds lines=159-197

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 159-197
   :lineno-match:

.. CG-EXPLANATION-START id=function:flyToBounds

**What this does.** Flies the camera to frame the whole model. It gathers every surface vertex as a globe position, fits a bounding sphere around them, and flies the camera to look down on that sphere from an oblique angle at a distance scaled to the model's size (at least 600 m).

**Why it is here.** A comment records that the earlier hand-rolled camera placement left the data off-centre and at the wrong distance (zoom is off); fitting a bounding sphere frames it correctly. The oblique look-down is chosen because a straight-down view is disorienting for inspecting surfaces.

.. CG-EXPLANATION-END id=function:flyToBounds

``interface SplitLine``
-----------------------

.. CG-BLOCK id=interface:SplitLine lines=198-210

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 198-210
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SplitLine

**What this does.** Names the two endpoints of the user-drawn split line in the project's projected metres. The block also carries the next function's docstring.

**Why it is here.** These projected endpoints are what the cut-face builders sample along; the drawn line is echoed here in ground coordinates so the caps can be placed.

.. CG-EXPLANATION-END id=interface:SplitLine

``function flyToCutFace``
-------------------------

.. CG-BLOCK id=function:flyToCutFace lines=211-302

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 211-302
   :lineno-match:

.. CG-EXPLANATION-START id=function:flyToCutFace

**What this does.** Flies the camera to look at the exposed cut FACE head-on, rather than the oblique top-down of ``flyToBounds``. It frames only the KEPT half's points, then places the camera on the side the removed half used to be, looking toward the kept body along the plane's normal with a slight downward tilt so the layered section reads.

**Why it is here.** Framing only the kept half fixes the asymmetric panes the user saw — the full-model sphere was centred on the cut, so a thin half ended up tiny and far while the big half filled the frame. The camera sign is chosen so the cut face is the first thing the eye hits; the earlier sign put the camera behind the kept body, showing its outside and hiding the cut entirely.

.. CG-EXPLANATION-END id=function:flyToCutFace

``function buildCapPrimitives``
-------------------------------

.. CG-BLOCK id=function:buildCapPrimitives lines=303-460

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 303-460
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildCapPrimitives

**What this does.** Builds the coloured cut-face caps for the formation surfaces. It finds the model's bounding box, extends the drawn line across it, lays 160 evenly spaced stations along it, samples every visible formation's surface height at each station (top-first, with the per-order z-offset applied), assigns each formation its colour, then asks ``buildCutFaceBands`` for the band triangles and turns each formation's band soup into an opaque flat-coloured Cesium primitive.

**Why it is here.** Filling the ribbon between each formation top and the next-deeper one makes the slice read as a solid layered cake rather than a hollow shell. The caps are drawn in both panes because the cut face is shared; each pane clips its other geometry away on the far side, so the shared caps read as that pane's own exposed cross-section. Hidden formations are dropped before sampling so the legend toggle works here too.

.. CG-EXPLANATION-END id=function:buildCapPrimitives

``function hexToCesiumColor``
-----------------------------

.. CG-BLOCK id=function:hexToCesiumColor lines=461-491

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 461-491
   :lineno-match:

.. CG-EXPLANATION-START id=function:hexToCesiumColor

**What this does.** Turns a hex colour string (with or without a leading ``#``) into a Cesium colour, falling back to grey when the string does not parse.

**Why it is here.** A single shared converter so every builder resolves formation colours the same way and a malformed value degrades to grey instead of crashing.

.. CG-EXPLANATION-END id=function:hexToCesiumColor

``function buildMeshBuffers``
-----------------------------

.. CG-BLOCK id=function:buildMeshBuffers lines=492-567

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 492-567
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildMeshBuffers

**What this does.** Converts a mesh's vertices to globe (ECEF) positions and produces the position and triangle-index buffers every mesh builder here shares. With no clip it keeps the compact shared-vertex form; with a clip it slices the mesh to the kept half and emits a triangle soup, since cut triangles no longer share corners. It returns ``null`` when there are no triangles or the clip removes everything.

**Why it is here.** The two paths — shared-vertex fast path, or clipped soup — are identical across the surface, fence and solid builders, so they live in one place instead of three. ECEF is the earth-centred 3-D coordinate frame Cesium draws in.

.. CG-EXPLANATION-END id=function:buildMeshBuffers

``function makeMeshGeometry``
-----------------------------

.. CG-BLOCK id=function:makeMeshGeometry lines=568-605

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 568-605
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeMeshGeometry

**What this does.** Assembles a position-only Cesium geometry from prepared buffers, tagging it as triangles (the default) or as lines (for a wireframe draw).

**Why it is here.** A shared step so every builder makes its geometry the same way; the geometry carries only positions because these surfaces are drawn flat, with no lighting normals.

.. CG-EXPLANATION-END id=function:makeMeshGeometry

``function makeColorPrimitive``
-------------------------------

.. CG-BLOCK id=function:makeColorPrimitive lines=606-643

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 606-643
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeColorPrimitive

**What this does.** Wraps a geometry in a single-instance Cesium primitive with one per-instance colour and the given appearance flags (translucent, flat, and optionally closed). An appearance is how a surface is drawn.

**Why it is here.** Those appearance flags are the only thing that differs between the surface, fence and solid builders, so factoring out the wrapper leaves each builder to set just its own flags.

.. CG-EXPLANATION-END id=function:makeColorPrimitive

``function buildTinPrimitive``
------------------------------

.. CG-BLOCK id=function:buildTinPrimitive lines=644-700

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 644-700
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTinPrimitive

**What this does.** Builds one Cesium primitive for a triangulated surface: it makes the buffers (optionally clipped to a half-space), builds the geometry, and wraps it as a translucent flat-shaded coloured primitive; it returns ``null`` for an empty or fully-clipped-away mesh.

**Why it is here.** The comment records why it is flat-shaded: these translucent fills need no lighting normals, and turning shading on would demand vertex data that was never computed and crash every surface with an appearance-versus-geometry mismatch. Flat-shading uses a position-only vertex format that matches exactly what is supplied.

.. CG-EXPLANATION-END id=function:buildTinPrimitive

``function buildFencePrimitive``
--------------------------------

.. CG-BLOCK id=function:buildFencePrimitive lines=701-798

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 701-798
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFencePrimitive

**What this does.** Builds a Cesium primitive for a vertical fence-diagram wall — the same as ``buildTinPrimitive`` but double-sided (back-face culling off) and honouring the split clip. A fence diagram places the section walls in 3-D over the basemap.

**Why it is here.** The camera may orbit behind a wall, so it must be visible from both sides. It honours the clip because without it the walls floated whole over both panes of a split view (dogfeed 2026-06-10).

.. CG-EXPLANATION-END id=function:buildFencePrimitive

``function buildSolidPrimitive``
--------------------------------

.. CG-BLOCK id=function:buildSolidPrimitive lines=799-904

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 799-904
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSolidPrimitive

**What this does.** Builds a Cesium primitive for a watertight closed body solid. A normal body is drawn opaque, flat-shaded and back-face-culled — a filled volume; a flagged body is drawn translucent at the flagged opacity; and a wireframe request re-keys the same triangles into their boundary edges and draws them as lines instead of filled faces.

**Why it is here.** Opaque means the solid writes depth and correctly hides the translucent surfaces behind it — it reads as filled rock, not a ghost. Back-face culling is correct and cheaper for a closed outward-wound solid, which never shows its inside. A flagged body is a best-effort marker disk with no confirmed extent, so it is deliberately made ghostly, and wireframe drops culling because a line has no faces. A body is a connected mass of same-litho layers; body id is identity, not shape.

.. CG-EXPLANATION-END id=function:buildSolidPrimitive

``function buildSolidCapPrimitive``
-----------------------------------

.. CG-BLOCK id=function:buildSolidCapPrimitive lines=905-986

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 905-986
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSolidCapPrimitive

**What this does.** Builds the filled cap a body shows where the split plane cuts it. Unlike the formation caps (sampled at stations), it intersects the ACTUAL solid mesh with the plane via ``computeSolidCapTriangles``, converts the resulting cross-section to globe positions, and draws it opaque, flat and single-sided. It returns ``null`` when the plane misses the solid.

**Why it is here.** Cutting the real mesh gives the exact cross-section, correctly non-convex when the body is. It is opaque so the cap reads as filled material, and single-sided because the cut face is viewed head-on and either side of the plane can be the front.

.. CG-EXPLANATION-END id=function:buildSolidCapPrimitive

``const _vertexColorAppearanceVS``
----------------------------------

.. CG-BLOCK id=const:_vertexColorAppearanceVS lines=987-999

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 987-999
   :lineno-match:

.. CG-EXPLANATION-START id=const:_vertexColorAppearanceVS

**What this does.** Holds the small GPU vertex-shader program that positions each corner and passes its per-corner colour through. A shader is a tiny program the graphics card runs, this one once per corner.

**Why it is here.** A single fixed colour per shape is not enough to draw the confidence fade as a true gradient, so each corner carries its own colour and the graphics card blends between them. The comment records it is written in the modern GLSL ES 3.0 style Cesium's WebGL2 context needs — the older style would throw a reserved-word error.

.. CG-EXPLANATION-END id=const:_vertexColorAppearanceVS

``const _vertexColorAppearanceFS``
----------------------------------

.. CG-BLOCK id=const:_vertexColorAppearanceFS lines=1000-1006

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1000-1006
   :lineno-match:

.. CG-EXPLANATION-START id=const:_vertexColorAppearanceFS

**What this does.** Holds the matching GPU pixel-shader program: it paints each pixel with the colour the vertex shader handed it, blended across the triangle.

**Why it is here.** Together with the vertex shader it lets the graphics card interpolate the per-corner colours, producing the smooth confidence fade across each triangle rather than two flat bins.

.. CG-EXPLANATION-END id=const:_vertexColorAppearanceFS

``function makeVertexColorAppearance``
--------------------------------------

.. CG-BLOCK id=function:makeVertexColorAppearance lines=1007-1038

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1007-1038
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeVertexColorAppearance

**What this does.** Bundles the two shaders into a Cesium appearance — how a surface is drawn — set up for translucent alpha-blended rendering with no back-face culling.

**Why it is here.** This is the custom-shader appearance the per-vertex-colour builder uses; its blend and depth settings match the standard translucent setup the plain coloured surfaces already use, so the gradient surfaces sit correctly among them.

.. CG-EXPLANATION-END id=function:makeVertexColorAppearance

``function buildTinPrimitiveWithVertexColor``
---------------------------------------------

.. CG-BLOCK id=function:buildTinPrimitiveWithVertexColor lines=1039-1184

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1039-1184
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTinPrimitiveWithVertexColor

**What this does.** Builds a surface primitive that carries a colour per corner — the true-gradient path. With no clip the per-corner colours line up one-to-one with the corners; with a clip (split view) it re-runs the cut per source triangle so it can paint each clipped fragment with its source triangle's colour. It raises an error early if the colour count does not match the corner count.

**Why it is here.** Per-corner colour is what lets the graphics card fade the confidence signal smoothly across a triangle instead of in two flat bins. In split view the cut creates new corners that share nothing, so the within-triangle gradient is lost there — accepted, because the split view is for inspection and the across-triangle fade still reads as a gradient.

.. CG-EXPLANATION-END id=function:buildTinPrimitiveWithVertexColor

``function rebuildSurfacePrimitives``
-------------------------------------

.. CG-BLOCK id=function:rebuildSurfacePrimitives lines=1185-1653

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1185-1653
   :lineno-match:

.. CG-EXPLANATION-START id=function:rebuildSurfacePrimitives

**What this does.** Clears the scene and rebuilds every 3-D shape from the current data, in painter's order — drawn back to front: first the cut-face caps (in split mode), then the aerial-photo lid (sliced to the cut), then the DEM ground surface, then the fence walls, then the formation surface sheets (with or without the confidence gradient), then the closed body solids (faded by distance to data when asked), then the body cut-face caps, and finally the never-clipped footprint ring. It honours every legend toggle — hidden formations, hidden bodies, ground-surface / surfaces / basemap on-off, fence-versus-solid mode — and clips each translucent surface to the receded plane in split view.

**Why it is here.** It is called on every data or toggle change and clears the scene first so nothing accumulates. The draw order is deliberate — Cesium paints in insertion order, so the ground goes under the formations, the opaque solids over the translucent sheets, and the ring goes last so it draws over everything. Fence mode suppresses the caps and solids so the section walls stand alone, and the footprint ring is never clipped because the model's extent does not change just because the view was cut in half.

.. CG-EXPLANATION-END id=function:rebuildSurfacePrimitives

``type DrawState``
------------------

.. CG-BLOCK id=type:DrawState lines=1654-1676

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1654-1676
   :lineno-match:

.. CG-EXPLANATION-START id=type:DrawState

**What this does.** Names the two states of the split-line drawing: ``idle`` (nothing drawn yet) and ``first-click`` (one point placed, carried with it). The block also carries the next function's docstring.

**Why it is here.** The split line is drawn in two clicks; this tiny state machine is what remembers the first click while waiting for the second.

.. CG-EXPLANATION-END id=type:DrawState

``function computeSplitPlane``
------------------------------

.. CG-BLOCK id=function:computeSplitPlane lines=1677-1713

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/geology3DPrimitives.ts
   :language: typescript
   :lines: 1677-1713
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSplitPlane

**What this does.** Computes the vertical cutting plane from the two clicked points. It measures their horizontal distance, rejects a line shorter than the 10 m floor, then builds a plane whose normal is perpendicular to the horizontal line direction — a vertical plane of infinite depth.

**Why it is here.** The split is always a vertical cut, so the plane is fully defined by the horizontal line and the up direction; rejecting a too-short line avoids a degenerate, unstable normal.

.. CG-EXPLANATION-END id=function:computeSplitPlane

