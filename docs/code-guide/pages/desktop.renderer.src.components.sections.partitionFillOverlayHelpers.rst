desktop.renderer.src.components.sections.partitionFillOverlayHelpers
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and borrows the shared vocabulary it needs. This is a module, one file of code with a name other files can borrow from. It collects small helper functions (a function is a named recipe: give it inputs, get a result back) plus type definitions (a type is a written note about the shape of a piece of data) that the partition-fill overlay shares. An overlay is one drawing layer painted on top of another; the section is drawn as a stack of overlays. The one import line borrows the lens pinch fraction and two data-shape names from the shared partition vocabulary next door.

**Why it is here.** The docstring records that this was lifted out of ``PartitionFillOverlay.tsx`` verbatim during the debt #201 round-2 cleanup, the large drawing component that paints the coloured section fill. Everything here is pure screen-space work: a pure function touches nothing outside its own inputs, reads no files and paints no screen, and there is no React in the file, so these helpers can be tested on their own away from the big component. The drawing itself is done in SVG (Scalable Vector Graphics, the language the section picture is painted in), and these helpers work in screen coordinates (pixels on the display) rather than section coordinates (real along-distance in metres and elevation in metres).

.. CG-EXPLANATION-END id=module-header

``function polygonCentroid``
----------------------------

.. CG-BLOCK id=function:polygonCentroid lines=30-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 30-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:polygonCentroid

**What this does.** Works out the balance point (the centroid) of a polygon drawn on screen. A polygon is a closed ring of points. It walks the ring adding up the standard shoelace-formula terms, divides to get the signed area, and returns the weighted centre point. When the ring is so thin it has almost no area (a triangle squashed down to a line), it gives back the middle of the supplied bounding box instead.

**Why it is here.** The overlay drops a text label, the soil name, inside each coloured region, and the label needs a point near the middle of the shape. The bounding-box fallback stops a near-flat sliver from producing a nonsense centre, which would happen when the area is so close to zero that dividing by it explodes.

.. CG-EXPLANATION-END id=function:polygonCentroid

``function widestScanlinePoint``
--------------------------------

.. CG-BLOCK id=function:widestScanlinePoint lines=65-108

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 65-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:widestScanlinePoint

**What this does.** Finds a point that is guaranteed to sit inside the polygon. It draws one horizontal line across the shape at its mid-height, collects every place that line crosses the ring's edges, and returns the middle of the widest gap between two crossings.

**Why it is here.** The docstring says this is the fallback for when the shoelace centroid of a concave or pinched shape lands outside the polygon. A lens or a wedge can be curved enough that its true balance point is off the paint, and a label must sit on the paint, so this guarantees an interior point to place it on.

.. CG-EXPLANATION-END id=function:widestScanlinePoint

``function labelAnchor``
------------------------

.. CG-BLOCK id=function:labelAnchor lines=109-120

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 109-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:labelAnchor

**What this does.** Chooses where to put a region's label. It tries the centroid first; if that point falls even outside the polygon's bounding box, it falls back to the widest-scanline point.

**Why it is here.** This is the single call the overlay makes to place a label, combining the two helpers above. The bounding-box test is a fast reject, because a point outside the box is certainly outside the shape, so the more expensive scanline search only runs when the cheap centroid has actually failed.

.. CG-EXPLANATION-END id=function:labelAnchor

``interface ColumnScreen``
--------------------------

.. CG-BLOCK id=interface:ColumnScreen lines=121-162

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 121-162
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ColumnScreen

**What this does.** A tiny data shape describing one column as the overlay sees it on screen: its right-edge pixel X, its left-edge pixel X, and its true along-section distance in metres. An interface is just a named list of the fields a piece of data carries. The long comment that follows this shape is the explanation of the base-contact function that comes next.

**Why it is here.** The overlay needs both the pixel edges of a column, to draw on, and its real along-section position, to feed the fill engine, which works in real metres and never in pixels. The comment records two earlier wrong ways of finding a fill's lower boundary, so the reader can trust the robust method the next block finally uses.

.. CG-EXPLANATION-END id=interface:ColumnScreen

``function baseContactEdge``
----------------------------

.. CG-BLOCK id=function:baseContactEdge lines=163-214

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 163-214
   :lineno-match:

.. CG-EXPLANATION-START id=function:baseContactEdge

**What this does.** Given a filled region's outline on screen, returns the polyline (the ordered run of points) that is its true BOTTOM boundary, the contact line it shares with the band below it. It keeps only the vertices that have nothing of the polygon deeper than them at their own horizontal position (the lower envelope), orders them left to right, and returns nothing for a degenerate shape with fewer than three points.

**Why it is here.** The docstring gives the history. The engineer grabs and bends this contact, so the grab box must sit exactly ON the visible line. Two earlier shortcuts broke: taking the polygon's last two vertices grabbed a vertical stub on a full-width band (the reported can-not-grab-a-base-tie-unit case), and taking the two extreme-x vertices near the deepest point rode ABOVE the real contact whenever a stored node bent it (owner dogfeed 2026-07-24: the grab box seems to be ABOVE the marker). The lower-envelope rule keeps the real bottom, bends and all, while excluding both the top edge and any interior lens notch carved into the shape.

.. CG-EXPLANATION-END id=function:baseContactEdge

``interface BoundaryDrag``
--------------------------

.. CG-BLOCK id=interface:BoundaryDrag lines=215-281

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 215-281
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoundaryDrag

**What this does.** The data describing one live drag of a single control point on a shared boundary between two stacked bands. It records which two bodies the boundary sits between, which gap it spans, which node is being dragged, the live clamped cursor X and Y, the vertical clamp limits (the upper body's top and the lower body's base), the gap's facing-edge X values, and several flags for the drag's lifecycle.

**Why it is here.** The flags each carry a session tag in the source. ``isNew`` marks a node the press itself created; ``x0``/``y0`` remember the mousedown origin so a click without real movement never reshapes or correlates (S105); ``crossedThreshold`` is a sticky flag set once the cursor has truly moved past the drag threshold; ``onlapIntervening`` (S110) means the drag bends the shared contact so an onlap rides it without ever posting a banding tie, which is what caused an earlier re-absorb bug. The ``gapIndex`` is the stable identity part so a rejected drag reddens only THIS contact node, never every handle on the body.

.. CG-EXPLANATION-END id=interface:BoundaryDrag

``interface LensDrag``
----------------------

.. CG-BLOCK id=interface:LensDrag lines=282-329

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 282-329
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LensDrag

**What this does.** The same idea as ``BoundaryDrag`` but for dragging a node on a lens edge. It records the body, which on-screen copy (``regionIdx``) and which gap the node is in, which side and which edge (upper or lower) it belongs to, the dragged node index, the live position, and the clamp box (the gap's X extent and the lens's elevation band), plus the same press-to-grab and drag-threshold flags as the boundary drag.

**Why it is here.** A lens that pinches into TWO gaps renders two copies with the SAME body id, so ``gapIndex`` is the stable ownership key that says which copy owns the drag, while ``regionIdx`` (which re-indexes as the partition regenerates mid-drag) only discriminates which copy shows the live handle. The lifecycle flags mean the same thing as on ``BoundaryDrag`` above.

.. CG-EXPLANATION-END id=interface:LensDrag

``interface ScreenRegion``
--------------------------

.. CG-BLOCK id=interface:ScreenRegion lines=330-348

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 330-348
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScreenRegion

**What this does.** One fill region already converted to screen polygon points, tagged with its gap's left and right edge X values and its bounding box.

**Why it is here.** Caching the screen points and bounds once means the drag and render passes do not have to recompute them on every frame.

.. CG-EXPLANATION-END id=interface:ScreenRegion

``interface SharedBoundary``
----------------------------

.. CG-BLOCK id=interface:SharedBoundary lines=349-376

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 349-376
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SharedBoundary

**What this does.** One shared boundary between two stacked non-lens regions in the same gap. It carries the two bodies, the two region indices, the gap, the resolved control-point handles (sorted left to right, and possibly empty when the edge is a natural straight line with no handles), the vertical clamp bounds, the gap edge X values, and the natural base-contact polyline used to position the grab box.

**Why it is here.** This supports multi-node freedraw: the boundary can carry N control points, not just one. The ``naturalEdge`` follows the fill's visible lower boundary, bends included (built by ``baseContactEdge`` above), so the grab tolerance is centred on the marker the engineer actually sees (S104).

.. CG-EXPLANATION-END id=interface:SharedBoundary

``interface ScreenLens``
------------------------

.. CG-BLOCK id=interface:ScreenLens lines=377-411

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 377-411
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScreenLens

**What this does.** One lens region mapped to screen, augmented with its per-edge node handles (the upper and lower node polylines this gap owns), the two source column corners, the gap X extent, and the lens's elevation band, all in screen coordinates.

**Why it is here.** A lens's top taper and base taper each carry their own set of nodes, so they are kept as two separate lists. Each node keeps the index it holds in the body's stored array, preserved through the per-gap ownership filter, so a drag persists back to the right stored slot rather than a wrong one.

.. CG-EXPLANATION-END id=interface:ScreenLens

``const TIP_FRACTION_EPS``
--------------------------

.. CG-BLOCK id=const:TIP_FRACTION_EPS lines=412-435

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 412-435
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIP_FRACTION_EPS

**What this does.** A small slack value, 0.02 of the gap width, for deciding when a vertex counts as sitting ON a column face rather than free inside the gap. The comment after it is the lead-in to the shapeable-termination test that follows.

**Why it is here.** A lens or a pinch tapers to a tip somewhere inside the gap; this slack tells apart a vertex touching a column edge from a genuine free tip in the middle.

.. CG-EXPLANATION-END id=const:TIP_FRACTION_EPS

``function isApexShapeable``
----------------------------

.. CG-BLOCK id=function:isApexShapeable lines=436-479

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 436-479
   :lineno-match:

.. CG-EXPLANATION-START id=function:isApexShapeable

**What this does.** Answers a yes/no question: can the engineer reshape this region's tip? Horizontal position inside a gap is measured as a fraction, from 0 at the left column to 1 at the right column. A lens is always yes. Any other shape is yes only when its outline has a vertex strictly inside the gap (a real mid-gap apex) AND the shape does not already stretch the full width of the gap.

**Why it is here.** The docstring records a real bug: the two fill engines label the same wedge differently (the old v1 engine calls a lone tip a lens or a pinch, the current v2 engine sometimes stamps it a quad), so gating the handle on the ``kind`` label alone silently dropped every v2 pinch tip's handle, which surfaced as the alt-click-gesture-is-gone dogfeed report. Reading the SHAPE instead is engine-agnostic; a full-width band touches both columns and has no free tip, so it stays correctly excluded.

.. CG-EXPLANATION-END id=function:isApexShapeable

``function resolveSourceCorners``
---------------------------------

.. CG-BLOCK id=function:resolveSourceCorners lines=480-515

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 480-515
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveSourceCorners

**What this does.** Finds which column face a shapeable region is anchored to (left or right) and the top and base corners on that face. Elevation is the height in metres TAW, the Belgian height datum; the top corner is the highest-elevation vertex on the anchored face and the base corner the lowest. It returns nothing when the region reaches neither face.

**Why it is here.** The two engines order the polygon's points differently, so the corners cannot be read from a fixed starting vertex. Deriving them from the extent instead (whichever face, fraction 0 or 1, the region reaches, then the highest and lowest vertices there) is robust to either engine's ordering.

.. CG-EXPLANATION-END id=function:resolveSourceCorners

``function buildLensPolygon``
-----------------------------

.. CG-BLOCK id=function:buildLensPolygon lines=516-556

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 516-556
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLensPolygon

**What this does.** Rebuilds a lens's outline from its two source corners plus its upper and lower edge node lists. The ring is source-top, then the upper nodes left to right, then the lower nodes right to left, then the source-base. With no stored nodes at all it falls back to a single-apex triangle at the default lens pinch fraction and mid-elevation.

**Why it is here.** Keeping the top taper and base taper as two separate node lists lets the engineer shape each edge on its own, for example a flat top with a steeply tapering base, or the reverse. Winding the top edge forward and the base edge backward keeps the ring valid so it fills correctly.

.. CG-EXPLANATION-END id=function:buildLensPolygon

``interface AddNodePreview``
----------------------------

.. CG-BLOCK id=interface:AddNodePreview lines=557-561

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillOverlayHelpers.ts
   :language: typescript
   :lines: 557-561
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AddNodePreview

**What this does.** The screen position and colour of the small hover dot that previews where a click on an add-strip would drop a new node.

**Why it is here.** Owner directive 2026-06-05 (the litho declutter). Its colour mirrors the stored handle colour, sky blue for a matched-boundary strip and amber for a lens strip, so the preview telegraphs what the click is about to create.

.. CG-EXPLANATION-END id=interface:AddNodePreview

