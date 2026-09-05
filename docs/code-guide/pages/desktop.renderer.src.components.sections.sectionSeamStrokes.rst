desktop.renderer.src.components.sections.sectionSeamStrokes
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The seam-aware stroke pass: it decides, edge by edge, where a fill polygon should keep its thin hairline-closing stroke and where it should drop it.

**Why it is here.** Owner clause 5, merge touching lithos: the finished section shows only boundaries between DIFFERENT lithologies. Every fill polygon used to carry a self-colour stroke to close the antialiasing hairline, but where two same-lithology regions abut along a termination line, each stroked the shared edge and the doubled stroke read as a visible diagonal helper line inside a merged sand mass (owner dogfeed 2026-07-19). So the stroke is kept only where the outward side is a different formation or unfilled space, and dropped where it is the same formation. Classification is by midpoint-normal sampling and point-in-polygon rather than exact edge matching, so T-junctions and collinear-vertex mismatches classify correctly, and a degenerate sub-pixel edge keeps its stroke as a safe default.

.. CG-EXPLANATION-END id=module-header

``interface SeamStrokeElement``
-------------------------------

.. CG-BLOCK id=interface:SeamStrokeElement lines=29-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 29-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SeamStrokeElement

**What this does.** One strokable fill element: its closed screen ring and its lithology id.

**Why it is here.** The same id on both sides of an edge means the edge is interior to a merged body and carries no stroke.

.. CG-EXPLANATION-END id=interface:SeamStrokeElement

``const SAMPLE_OFFSET_PX``
--------------------------

.. CG-BLOCK id=const:SAMPLE_OFFSET_PX lines=41-42

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 41-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_OFFSET_PX

**What this does.** How far to step off an edge to sample its outward side, 0.6 px.

**Why it is here.** It sits just under the 0.75 px stroke width: big enough to clear the antialiasing at the shared edge, small enough to land inside any neighbour that is more than a sub-pixel sliver.

.. CG-EXPLANATION-END id=const:SAMPLE_OFFSET_PX

``const MIN_EDGE_PX``
---------------------

.. CG-BLOCK id=const:MIN_EDGE_PX lines=43-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 43-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_EDGE_PX

**What this does.** Edges shorter than 0.05 px are treated as degenerate and keep their stroke.

**Why it is here.** A safe default: a sub-pixel edge contributes nothing visible, and the pass must never drop a real line by mistake.

.. CG-EXPLANATION-END id=const:MIN_EDGE_PX

``interface Bbox``
------------------

.. CG-BLOCK id=interface:Bbox lines=45-51

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 45-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Bbox

**What this does.** A bounding box: minimum and maximum X and Y.

**Why it is here.** A cheap first check before the expensive inside test.

.. CG-EXPLANATION-END id=interface:Bbox

``function bboxOf``
-------------------

.. CG-BLOCK id=function:bboxOf lines=52-66

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 52-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:bboxOf

**What this does.** Computes the bounding box of a ring of points.

**Why it is here.** It lets the neighbour search skip any element whose box the sample point falls outside, before running the costly inside test.

.. CG-EXPLANATION-END id=function:bboxOf

``function pointInPoly``
------------------------

.. CG-BLOCK id=function:pointInPoly lines=67-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 67-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInPoly

**What this does.** The standard even-odd ray-cast test for whether a screen point is inside a ring.

**Why it is here.** The primitive that decides which side of an edge is outward and whether a neighbour covers that outward point.

.. CG-EXPLANATION-END id=function:pointInPoly

``function computeSeamStrokePaths``
-----------------------------------

.. CG-BLOCK id=function:computeSeamStrokePaths lines=97-150

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionSeamStrokes.ts
   :language: typescript
   :lines: 97-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSeamStrokePaths

**What this does.** For each element and each of its edges, it samples both sides of the edge to find which is outward, then checks whether any same-formation element covers that outward point; it keeps the edge's stroke only when none does. It returns one path string per element, empty when every edge is an interior same-lithology seam.

**Why it is here.** Sampling both offsets and taking whichever the element itself does not contain makes the outward test winding-agnostic, so it works whichever way the ring is wound; an ambiguous thin sliver, where both samples fall the same way, keeps the stroke, identical to the earlier render and never removing a real line.

.. CG-EXPLANATION-END id=function:computeSeamStrokePaths

