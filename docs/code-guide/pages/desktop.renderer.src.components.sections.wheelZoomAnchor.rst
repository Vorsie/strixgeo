desktop.renderer.src.components.sections.wheelZoomAnchor
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The section's horizontal column layout pass together with the cursor-anchored wheel-zoom solve, in one file.

**Why it is here.** The docstring explains that the two belong together because the second is only exact when it uses the first. The layout is the single source of truth: the panel builds its placed columns from it, and the wheel zoom re-runs it to ask where the columns would land at a candidate viewport. The exact solve is possible because the layout is translation-equivariant in the viewport's left edge: shifting that edge shifts every column's true X by the same pixels, and the packing origin, the spacing lerp and the collision nudge all move with it. So one layout simulation fixes the layout's shape at the new scale, and the remaining unknown is a single translation solved in closed form. The old approach instead picked the nearest column and stood in a band-half-width ratio for the packed offset, which snapped to a neighbour between columns and crept the camera left over repeated wheeling.

.. CG-EXPLANATION-END id=module-header

``interface ZoomLayoutColumn``
------------------------------

.. CG-BLOCK id=interface:ZoomLayoutColumn lines=48-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 48-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ZoomLayoutColumn

**What this does.** One column as the horizontal layout sees it: its investigation id, its true along-section distance, the part of its width that is fixed across a zoom, and the multiple of the band half-width its data band adds.

**Why it is here.** The width is split so the wheel zoom can re-derive the post-zoom width, because the band half-width changes with the horizontal scale, without re-reading any of the toggle state.

.. CG-EXPLANATION-END id=interface:ZoomLayoutColumn

``interface HasId``
-------------------

.. CG-BLOCK id=interface:HasId lines=60-82

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 60-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HasId

**What this does.** A minimal has-this-id shape for the per-id lookups the footprint builder needs. The comment after it describes the footprint builder.

**Why it is here.** It keeps the footprint builder decoupled from the full lookup types, taking only the has-check it actually uses.

.. CG-EXPLANATION-END id=interface:HasId

``function zoomLayoutColumn``
-----------------------------

.. CG-BLOCK id=function:zoomLayoutColumn lines=83-107

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 83-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:zoomLayoutColumn

**What this does.** Builds one column's layout footprint from its id, its along-distance, its data-band half-width multiple, a litho-ghost-band flag, and the ghost-rail width.

**Why it is here.** It is called from BOTH the render layout and the wheel-zoom simulation so the two can never drift, and the drift between them is exactly what walked the camera sideways. The half-width multiple is taken as the maximum of the data-band and ghost-band multiples, so the fixed-versus-scaling split survives the band half-width changing under a zoom.

.. CG-EXPLANATION-END id=function:zoomLayoutColumn

``function columnLayoutWidthPx``
--------------------------------

.. CG-BLOCK id=function:columnLayoutWidthPx lines=108-115

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 108-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnLayoutWidthPx

**What this does.** A column's layout width at a given band half-width: the fixed part plus the multiple times the half-width.

**Why it is here.** It is the width the packer uses at whatever scale is being laid out.

.. CG-EXPLANATION-END id=function:columnLayoutWidthPx

``interface HorizontalLayoutInput``
-----------------------------------

.. CG-BLOCK id=interface:HorizontalLayoutInput lines=116-139

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 116-139
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HorizontalLayoutInput

**What this does.** The inputs to the horizontal layout: the columns, the viewport's left edge, the horizontal scale, the band half-width, the spacing slider, the left margin, the base edge gap, and an optional per-pair gap override.

**Why it is here.** The per-pair gap override lets a correlated pair claim a wider gap so the ribbon between them has room.

.. CG-EXPLANATION-END id=interface:HorizontalLayoutInput

``interface HorizontalPlacement``
---------------------------------

.. CG-BLOCK id=interface:HorizontalPlacement lines=140-167

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 140-167
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HorizontalPlacement

**What this does.** One column's placement out of the layout: its id, its along-distance, its pre-nudge true X (after the spacing lerp), its post-nudge drawn X, its width, and a displaced flag.

**Why it is here.** The renderer draws the tie-back diagonal from the drawn X back to the true X.

.. CG-EXPLANATION-END id=interface:HorizontalPlacement

``function layoutColumnsHorizontally``
--------------------------------------

.. CG-BLOCK id=function:layoutColumnsHorizontally lines=168-240

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 168-240
   :lineno-match:

.. CG-EXPLANATION-START id=function:layoutColumnsHorizontally

**What this does.** The full horizontal layout: compute each column's true screen X, pack the columns edge-to-edge in projection order, lerp each one back toward its true X by the Spacing slider, then run the collision nudge, returning the placements left to right.

**Why it is here.** This is the single source of truth for horizontal layout, used by both the panel and the wheel zoom. Running the nudge over the LERPED positions rather than the packed ones is what makes the edge-gap rule hold at every spacing value.

.. CG-EXPLANATION-END id=function:layoutColumnsHorizontally

``function simulateWarpAnchors``
--------------------------------

.. CG-BLOCK id=function:simulateWarpAnchors lines=241-247

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 241-247
   :lineno-match:

.. CG-EXPLANATION-START id=function:simulateWarpAnchors

**What this does.** Runs the layout and returns just the warp anchors, each an along-distance paired with a drawn X, sorted by along-distance.

**Why it is here.** It is the shape the warp map consumes.

.. CG-EXPLANATION-END id=function:simulateWarpAnchors

``interface CursorAnchoredZoomInput``
-------------------------------------

.. CG-BLOCK id=interface:CursorAnchoredZoomInput lines=248-293

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 248-293
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CursorAnchoredZoomInput

**What this does.** The inputs to the zoom solve: the cursor pixel, the current on-screen anchors, the current viewport left edge and scale, the post-zoom scale and band half-width, the column footprints, the spacing, the margin, and the gaps.

**Why it is here.** The current anchors are what the cursor is actually pointing at, and the footprints are focus-filtered exactly as the render is, so the simulation matches the screen.

.. CG-EXPLANATION-END id=interface:CursorAnchoredZoomInput

``function solveCursorAnchoredXMin``
------------------------------------

.. CG-BLOCK id=function:solveCursorAnchoredXMin lines=294-339

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/wheelZoomAnchor.ts
   :language: typescript
   :lines: 294-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:solveCursorAnchoredXMin

**What this does.** Computes the post-zoom viewport left edge that keeps the point under the cursor under the cursor: read the warped along-distance the cursor points at, lay the columns out at the post-zoom scale at any reference left edge and measure where that along-distance lands, then translate by one subtraction.

**Why it is here.** All three steps are exact because the layout is translation-equivariant in the left edge. Reading the WARPED along-distance keeps a cursor sitting between two columns from snapping to a neighbour, and with no columns the warp degenerates to the plain straight-line map so the result is the standard linear cursor anchor with no special case needed.

.. CG-EXPLANATION-END id=function:solveCursorAnchoredXMin

