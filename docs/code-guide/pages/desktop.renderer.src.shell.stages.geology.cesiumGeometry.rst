desktop.renderer.src.shell.stages.geology.cesiumGeometry
========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file of pure geometry maths for the 3-D geology viewer (debt #41). It gathers a polygon triangulator and the coordinate converters, and its notes explain that the viewer component itself is far too large and graphics-bound to test, but its coordinate maths — the basemap footprint box, sampling a surface's height at a point, and slicing triangles against a plane — touch only Cesium's MATH classes, which run fine in tests without a graphics canvas. Cesium is the 3-D globe library the viewer draws on.

**Why it is here.** These functions were lifted VERBATIM out of the viewer, behaviour byte-for-byte identical, precisely so they can carry real automated tests — the class of bug being guarded against was a missing-variable crash that once shipped inside the untestable viewer's cut-face camera code.

.. CG-EXPLANATION-END id=module-header

``function trianglesToWireframeEdgeIndices``
--------------------------------------------

.. CG-BLOCK id=function:trianglesToWireframeEdgeIndices lines=42-53

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 42-53
   :lineno-match:

.. CG-EXPLANATION-START id=function:trianglesToWireframeEdgeIndices

**What this does.** Turns a list of triangles into the line-edge list a wireframe draw needs. For each triangle (three corner numbers) it emits its three boundary edges as index pairs — six numbers per triangle — leaving the actual corner positions untouched.

**Why it is here.** The filled solid and its wireframe share the exact same corner positions; only the index list — which corners to connect — differs between the two draws. Being pure numbers-in, numbers-out, it is testable without any 3-D context.

.. CG-EXPLANATION-END id=function:trianglesToWireframeEdgeIndices

``const GEOPUNT_ORTHO_WMS``
---------------------------

.. CG-BLOCK id=const:GEOPUNT_ORTHO_WMS lines=54-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 54-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOPUNT_ORTHO_WMS

**What this does.** Holds the web address of the Flemish Geopunt orthophoto map service.

**Why it is here.** A comment records that this whole-image service is used because the tiled version never lined up correctly under Cesium — it produced a storm of errors and a smeared wall instead of a clean image.

.. CG-EXPLANATION-END id=const:GEOPUNT_ORTHO_WMS

``interface BasemapBounds``
---------------------------

.. CG-BLOCK id=interface:BasemapBounds lines=60-87

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 60-87
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BasemapBounds

**What this does.** Names the plain, Cesium-free result of the footprint calculation: the WGS84 longitude/latitude rectangle to drape the aerial photo in, the elevation to place it at (the model top), and the one-shot image-request URL. WGS84 is the global longitude/latitude system.

**Why it is here.** Keeping the result Cesium-free is what makes it testable; the caller is the one that wraps the degree rectangle in a Cesium rectangle object.

.. CG-EXPLANATION-END id=interface:BasemapBounds

``function computeBasemapBounds``
---------------------------------

.. CG-BLOCK id=function:computeBasemapBounds lines=88-145

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 88-145
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeBasemapBounds

**What this does.** Computes the lid footprint — the rectangle for one aerial-photo image covering the model, placed flat at the model's top elevation. It walks every surface vertex for the smallest and largest easting, northing and top elevation, pads the box by 8 %, converts the corners to longitude/latitude, sizes the requested image to the box's aspect (capped at 2048 px on the long side), and builds the map-service image URL. It returns ``null`` for non-Belgian projects or when there are no vertices yet.

**Why it is here.** It is restricted to Belgian Lambert-72 projects because that is the only coordinate system Geopunt serves this layer in. It requests the image in map-service version 1.1.1 to sidestep the axis-order trap of version 1.3.0 (1.1.1 always orders the box easting-first). Lambert-72 is EPSG:31370 — an EPSG code is just the integer that names a coordinate system in code.

.. CG-EXPLANATION-END id=function:computeBasemapBounds

``interface TinLike``
---------------------

.. CG-BLOCK id=interface:TinLike lines=146-169

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 146-169
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TinLike

**What this does.** Names the least a surface needs to be sampled: projected vertices plus triangle indices. A TIN is a triangulated surface, a sheet of triangles. The block also carries the next function's docstring.

**Why it is here.** It is deliberately broader than the formation-surface response type so the DEM ground surface — which carries different metadata but identical geometry — can be sampled by the very same code.

.. CG-EXPLANATION-END id=interface:TinLike

``function sampleTinZ``
-----------------------

.. CG-BLOCK id=function:sampleTinZ lines=170-189

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 170-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleTinZ

**What this does.** Finds the elevation of a triangulated surface at a given horizontal point. It walks the triangles and, for the one that contains the point (tested in plan), blends the three corner elevations by their barycentric weights to get the height there. It returns ``null`` when the point falls outside every triangle — the surface has pinched out or is absent there.

**Why it is here.** Returning ``null`` rather than a guessed value keeps no surface here distinct from surface at height zero, which matters wherever a formation wedges out. Barycentric interpolation is the standard exact way to read a value inside a triangle from its three corners.

.. CG-EXPLANATION-END id=function:sampleTinZ

``interface StationFormationZ``
-------------------------------

.. CG-BLOCK id=interface:StationFormationZ lines=190-200

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 190-200
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StationFormationZ

**What this does.** Names one present formation at one sampling station along the cut line: its surface elevation (with the per-order z-offset already applied) and the formation id.

**Why it is here.** It is the small record the cut-face band builder works in — one entry per formation that actually reaches that station.

.. CG-EXPLANATION-END id=interface:StationFormationZ

``const CUT_FACE_BASE_SLIVER_M``
--------------------------------

.. CG-BLOCK id=const:CUT_FACE_BASE_SLIVER_M lines=201-239

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 201-239
   :lineno-match:

.. CG-EXPLANATION-START id=const:CUT_FACE_BASE_SLIVER_M

**What this does.** Holds two metres — the visible thickness given to the deepest present formation's band at a station, since it has no formation beneath to bound it. The block also carries the cut-face band builder's docstring.

**Why it is here.** It is a small UNIFORM sliver hugging that formation's own flat top, deliberately NOT a ramp down to a global floor: the ramp was the old cut-face droop bug, where a band's bottom plunged toward a far-below floor wherever a deeper formation pinched out between stations, even though the surfaces themselves were flat.

.. CG-EXPLANATION-END id=const:CUT_FACE_BASE_SLIVER_M

``function buildCutFaceBands``
------------------------------

.. CG-BLOCK id=function:buildCutFaceBands lines=240-327

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 240-327
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildCutFaceBands

**What this does.** Builds the coloured cross-section bands on the split face, one triangle-soup per formation, walking pairs of adjacent stations along the cut line. At each station it sets each formation's band as top-to-next-present-below (the deepest gets the uniform sliver); between two stations a formation present at both draws a full four-sided band, and one present at only one station wedges to a point — an honest pinch-out.

**Why it is here.** The previous version marched two independently-sorted, variable-length station columns by matching index positions, so when a deeper formation was absent at one station the indices lined up different formations and the band's bottom fell back to a global floor — the steep droop on the cut face while every surface was actually flat. Basing each band's bottom on the next PRESENT formation at its own station means every edge follows a real, flat surface sample, and no global floor exists any more.

.. CG-EXPLANATION-END id=function:buildCutFaceBands

``function clipTrisToHalfSpace``
--------------------------------

.. CG-BLOCK id=function:clipTrisToHalfSpace lines=328-371

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 328-371
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipTrisToHalfSpace

**What this does.** The split-view cut. Given a soup of 3-D triangles and a plane, it returns only the part on the kept side: triangles fully inside pass through, triangles straddling the plane are cut along it and re-triangulated, triangles fully outside are dropped. A flag chooses which side to keep, so the other pane keeps the opposite half.

**Why it is here.** This is the actual slice-the-cake operation, done per triangle by the standard Sutherland-Hodgman clip, because Cesium has no built-in clipping for the raw shapes this viewer builds. The secondary pane passes the opposite keep-flag, so the two panes are genuinely the two halves of the same body.

.. CG-EXPLANATION-END id=function:clipTrisToHalfSpace

``type TexVert``
----------------

.. CG-BLOCK id=type:TexVert lines=372-394

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 372-394
   :lineno-match:

.. CG-EXPLANATION-START id=type:TexVert

**What this does.** Names a clip vertex that also carries a texture coordinate — a corner plus where it sits within an image. The block also carries the next function's docstring. A texture is an image painted onto a surface.

**Why it is here.** It exists so the aerial-photo lid quad can be sliced along the same split plane as the geology, with the image staying pinned to the ground.

.. CG-EXPLANATION-END id=type:TexVert

``function clipTexTrisToHalfSpace``
-----------------------------------

.. CG-BLOCK id=function:clipTexTrisToHalfSpace lines=395-453

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 395-453
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipTexTrisToHalfSpace

**What this does.** The same half-space cut as ``clipTrisToHalfSpace``, but for triangles that carry texture coordinates: where an edge crosses the plane, both the new position AND its image coordinate are blended by the same fraction.

**Why it is here.** Blending the image coordinate by the identical fraction keeps the aerial photo georeferenced across the cut — the sliced halves of the picture still land in the right place on the ground.

.. CG-EXPLANATION-END id=function:clipTexTrisToHalfSpace

``interface CapPlane``
----------------------

.. CG-BLOCK id=interface:CapPlane lines=454-464

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 454-464
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CapPlane

**What this does.** Names a plane written as ``normal·X + constant = 0``, matching Cesium's own plane convention so the two convert cleanly. The normal need not be unit length.

**Why it is here.** It is the plane shape the solid-cap cutter takes; the note records that the signed-distance test normalises internally, so the tolerance comparisons are always in metres regardless of the normal's length.

.. CG-EXPLANATION-END id=interface:CapPlane

``interface CapTriangles``
--------------------------

.. CG-BLOCK id=interface:CapTriangles lines=465-523

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 465-523
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CapTriangles

**What this does.** Names the cutter's result: a flat position array plus an index array, with every position lying on the cut plane. The block also carries the long docstring describing the cap algorithm step by step.

**Why it is here.** Deduplicating positions into a shared array with an index list is the compact form Cesium wants, and every position sits on the plane because they are the exposed cross-section.

.. CG-EXPLANATION-END id=interface:CapTriangles

``function computeSolidCapTriangles``
-------------------------------------

.. CG-BLOCK id=function:computeSolidCapTriangles lines=524-786

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/cesiumGeometry.ts
   :language: typescript
   :lines: 524-786
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSolidCapTriangles

**What this does.** Computes the filled cross-section a plane exposes when it slices a closed watertight body. It finds, per triangle, where the plane crosses its edges, collects those crossing segments, stitches them into closed loops (the outline of the cut), flattens each loop into the plane's own 2-D frame, triangulates it with the existing ear-clip triangulator, and lifts the triangles back onto the plane in 3-D.

**Why it is here.** Cutting the ACTUAL body mesh — rather than sampling surfaces at stations, as the geology caps do — gives the exact cross-section, correctly non-convex when the body is. The note records the one accepted limitation: a loop inside another loop is treated as a separate region, not a hole, which is fine because real subsurface bodies are simply connected, never ring-shaped.

.. CG-EXPLANATION-END id=function:computeSolidCapTriangles

