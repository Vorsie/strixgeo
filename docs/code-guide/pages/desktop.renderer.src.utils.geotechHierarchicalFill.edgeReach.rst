desktop.renderer.src.utils.geotechHierarchicalFill.edgeReach
============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is a tripwire: a gap that emits packing fill must be readable at its two column edges, or the 3-D build silently drops a whole section's contribution there. The 3-D build samples a section's stack a little inside each column edge — it cannot sample exactly at the edge because the 2-D engine snaps coordinates to a millimetre grid — and if the classed fill does not reach that inset line while the litho cover does, the build reports an empty column and quietly extrudes the neighbouring section alone. This module reports every such gap. It imports a polygon-slicing helper, the snap-grid size, and the region shape.

**Why it is here.** The tempting fix — dragging every emitted edge onto the column — was rejected deliberately when debt #259 was closed, because it drags a lens that genuinely pinches out mid-gap all the way to the test, inventing geology to paper over a rounding artefact. So the invariant is stated against the litho cover, the only authority on where the ground actually ends. The docstring records why the check earns its lines: the "geotech payload stops 25 mm short" claim has been raised twice and refuted twice by hand, both times over which denominator to divide by — an argument that does not survive the next session, but this check does.

.. CG-EXPLANATION-END id=module-header

``const EDGE_MARGIN_CELLS``
---------------------------

.. CG-BLOCK id=const:EDGE_MARGIN_CELLS lines=50-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 50-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_MARGIN_CELLS

**What this does.** A constant: how many snap cells, two, the build's query is inset from a column edge by.

**Why it is here.** It mirrors the backend's own margin — the two must agree or this tripwire watches a line the build never samples. Two rather than one because a coordinate can be snapped away from the edge by a full cell and the scan then has to land strictly inside what is left.

.. CG-EXPLANATION-END id=const:EDGE_MARGIN_CELLS

``const FRACTION_EPS``
----------------------

.. CG-BLOCK id=const:FRACTION_EPS lines=53-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:FRACTION_EPS

**What this does.** A fraction resolution floor, one part in a million, mirroring the backend's own.

**Why it is here.** It keeps the computed edge fractions off exactly 0 and 1 to match what the build actually samples.

.. CG-EXPLANATION-END id=const:FRACTION_EPS

``const EMPTY_EXTENT_M``
------------------------

.. CG-BLOCK id=const:EMPTY_EXTENT_M lines=56-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 56-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_EXTENT_M

**What this does.** The elevation, a billionth of a metre, below which a slice counts as holding nothing.

**Why it is here.** It distinguishes a real slice of ground from floating-point noise when measuring what the fill and the cover hold at an edge.

.. CG-EXPLANATION-END id=const:EMPTY_EXTENT_M

``interface EdgeReachViolation``
--------------------------------

.. CG-BLOCK id=interface:EdgeReachViolation lines=59-81

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 59-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EdgeReachViolation

**What this does.** The report shape for one gap the fill cannot be read at: the gap, which of its two edges (0 left, 1 right), the fraction the build samples at, how much elevation the litho cover holds there, and how much the classed fill holds — zero, by definition.

**Why it is here.** It hands an engineer the exact gap, edge and depths so the shortfall can be seen rather than argued about.

.. CG-EXPLANATION-END id=interface:EdgeReachViolation

``function clampedEdgeFractions``
---------------------------------

.. CG-BLOCK id=function:clampedEdgeFractions lines=82-89

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 82-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampedEdgeFractions

**What this does.** Returns the two gap-local fractions the 3-D build samples a gap's edges at, given the gap's width — both strictly inside 0 and 1 and strictly ordered around the midpoint however narrow the gap.

**Why it is here.** A pair of stations a millimetre apart would otherwise produce a margin past its own midpoint and the two clamps would cross — debt #259's own signature reached through debt #259's own fix — so the margin is capped just under the midpoint.

.. CG-EXPLANATION-END id=function:clampedEdgeFractions

``function extentAt``
---------------------

.. CG-BLOCK id=function:extentAt lines=90-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 90-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:extentAt

**What this does.** Returns the total elevation the given regions hold on the vertical line at a fraction, by slicing each region there and taking the UNION of the resulting spans.

**Why it is here.** Union, not sum: the fill's faces are disjoint but the litho cover's are not always (an overlay tier paints over its host), and double-counting the cover would make the tripwire compare two different quantities.

.. CG-EXPLANATION-END id=function:extentAt

``function byGap``
------------------

.. CG-BLOCK id=function:byGap lines=114-142

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 114-142
   :lineno-match:

.. CG-EXPLANATION-START id=function:byGap

**What this does.** Groups regions by the gap they stand on.

**Why it is here.** The check works one gap at a time, so it needs the faces bucketed by gap first — a small shared helper.

.. CG-EXPLANATION-END id=function:byGap

``function edgeReachViolations``
--------------------------------

.. CG-BLOCK id=function:edgeReachViolations lines=143-168

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/edgeReach.ts
   :language: typescript
   :lines: 143-168
   :lineno-match:

.. CG-EXPLANATION-START id=function:edgeReachViolations

**What this does.** The tripwire itself. For every gap that has classed faces, it computes the two clamped edge fractions and checks each edge: if the classed fill holds nothing there but the litho cover holds ground, that edge is a violation. It returns one entry per failing edge, empty when every emitting gap is readable at both.

**Why it is here.** A gap with no classed faces is blank, not short — an un-divided column blanks its two flanking gaps by ruling (2026-08-15) — and a gap whose cover itself ends before the column is followed, not corrected; the litho cover is the authority on where ground is owed.

.. CG-EXPLANATION-END id=function:edgeReachViolations

