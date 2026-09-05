desktop.renderer.src.utils.geotechHierarchicalFill.constructive.coverStatedEdges
================================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a diagnostic module that answers, for a rendered region, whether each of its sloping edges was drawn by the geotech fill (a construct — a lens flank, an onlap flank, or a tie) or is simply an edge of the litho unit the bands sit inside (the cover). It imports the region type it inspects.

**Why it is here.** The docstring records why: the owner keeps circling geotech shapes he did not expect, and the expensive part of each report is always the same question — did the fill draw that diagonal, or is it the litho stage's own approved geometry? The two have completely different owners, and the geotech stage may never override the cover (the structural invariant that a geotech band never paints outside its parent litho soil). This module answers the question mechanically, using the 2026-08-25 CS3 five-vertex sand as the worked example, and says nothing about whether any shape is right.

.. CG-EXPLANATION-END id=module-header

``const ON_EDGE_EPS``
---------------------

.. CG-BLOCK id=const:ON_EDGE_EPS lines=46-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 46-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:ON_EDGE_EPS

**What this does.** A constant, 1e-3 — how far off a cover edge a vertex may sit and still count as lying on it: 1 mm in elevation and the same number in fraction.

**Why it is here.** Rings arrive on the millimetre grid, and a merged outline carries vertices the arrangement placed by intersection, so a point that is genuinely ON a cover edge can miss it by grid rounding. The docstring notes 1 mm is an order below the shortest edge these shapes carry and an order above the noise.

.. CG-EXPLANATION-END id=const:ON_EDGE_EPS

``interface RingEdge``
----------------------

.. CG-BLOCK id=interface:RingEdge lines=49-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 49-64
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RingEdge

**What this does.** One edge of a ring, held as its two endpoints in fraction and elevation.

**Why it is here.** It is the unit the authorship test works on.

.. CG-EXPLANATION-END id=interface:RingEdge

``function slopingEdges``
-------------------------

.. CG-BLOCK id=function:slopingEdges lines=65-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 65-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:slopingEdges

**What this does.** Returns the edges of a ring that change both fraction AND elevation at once — the sloping ones.

**Why it is here.** A horizontal edge is a band's own contact and a vertical one is a gap edge or the law's seam; neither is a shape. A silhouette is made only of its sloping edges, so those are the only ones whose authorship is in question.

.. CG-EXPLANATION-END id=function:slopingEdges

``function onSegment``
----------------------

.. CG-BLOCK id=function:onSegment lines=81-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 81-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:onSegment

**What this does.** Answers whether a point lies on a segment within the tolerance on both axes, using the clamped closest-point parameter along the segment.

**Why it is here.** The parameter is clamped to the segment's two ends because a point past an end is not on it, however close the infinite line through it runs.

.. CG-EXPLANATION-END id=function:onSegment

``function isCoverStated``
--------------------------

.. CG-BLOCK id=function:isCoverStated lines=114-129

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 114-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:isCoverStated

**What this does.** Answers whether a sloping edge is one the litho cover already states — both of its endpoints must lie on ONE cover edge.

**Why it is here.** A segment whose two ends happen to sit on two different cover edges is a chord across the cover, which is a line the fill drew, not an edge the cover states.

.. CG-EXPLANATION-END id=function:isCoverStated

``interface ShapeAuthorship``
-----------------------------

.. CG-BLOCK id=interface:ShapeAuthorship lines=130-147

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 130-147
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ShapeAuthorship

**What this does.** One region's verdict: the region itself, the list of its sloping edges the cover states, and the list of its sloping edges the cover does not state — the lines the fill drew.

**Why it is here.** It is the output shape carrying the mechanical answer for one region.

.. CG-EXPLANATION-END id=interface:ShapeAuthorship

``function shapeAuthorship``
----------------------------

.. CG-BLOCK id=function:shapeAuthorship lines=148-167

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverStatedEdges.ts
   :language: typescript
   :lines: 148-167
   :lineno-match:

.. CG-EXPLANATION-START id=function:shapeAuthorship

**What this does.** Places every region's sloping edges against its own gap's litho cover and returns one verdict per region that has a silhouette; regions made only of horizontals and verticals are omitted.

**Why it is here.** It is the diagnostic's top-level entry point; a region with no sloping edge has no silhouette to attribute, so it is left out.

.. CG-EXPLANATION-END id=function:shapeAuthorship

