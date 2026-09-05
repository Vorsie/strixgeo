desktop.renderer.src.utils.partitionFillV2.conformance.classify
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring, the imports, and two re-export blocks. This file holds pure classifier helpers for the full 2/1/0 conformance gate — the test that checks the engine's rendered partition against the correlation rules. It handles two concerns: classifying the rendered shape of a region set (band, onlap, lens, or absent) and deriving the effective ties the engine used. It re-exports the merge predicates and the correlation-arithmetic from the engine package.

**Why it is here.** The docstring records that it was extracted from the diagnostics file to keep that under the 500-line budget (debt #201), and that the merge predicates and the correlation-arithmetic now live in the ENGINE package as the single source of truth. They are re-exported here so the gate keeps its import surface and — crucially — cannot drift from the engine: the engine emits exactly the termination the arithmetic names, and the gate checks the render against that same arithmetic. The 2/1/0 rules are documented in the partition-engine design note. The module is pure.

.. CG-EXPLANATION-END id=module-header

``const FULL_EPS``
------------------

.. CG-BLOCK id=const:FULL_EPS lines=42-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:FULL_EPS

**What this does.** How close to a column edge — within 0.02 of the gap's width — counts as a shape "reaching" that edge.

**Why it is here.** It is the edge-reach tolerance that decides whether a shape counts as spanning to a column, and so whether it is a band, an onlap, or a lens.

.. CG-EXPLANATION-END id=const:FULL_EPS

``type RenderShape``
--------------------

.. CG-BLOCK id=type:RenderShape lines=45-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 45-83
   :lineno-match:

.. CG-EXPLANATION-START id=type:RenderShape

**What this does.** The list of possible rendered shapes of a formation over a unit's elevation band in a gap: absent, band, onlap, or lens.

**Why it is here.** It is the vocabulary the classifier reports its verdict in — the 2 / 1 / 0 correlation outcomes plus "absent".

.. CG-EXPLANATION-END id=type:RenderShape

``const GX``
------------

.. CG-BLOCK id=const:GX lines=84-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 84-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:GX

**What this does.** The horizontal resolution of the grid used for the adjacency pass: 200 cells across.

**Why it is here.** The comment records that at 200 cells a fraction cell is 0.005 wide — about four times the engine's one-millimetre snap — so two regions meeting at a snapped seam land in the same or a neighbouring cell.

.. CG-EXPLANATION-END id=const:GX

``const GY``
------------

.. CG-BLOCK id=const:GY lines=85-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 85-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:GY

**What this does.** The vertical resolution of that grid: 64 cells tall.

**Why it is here.** The comment records that this gives even a sub-metre unit several rows, and that the grid is used only to test adjacency, never to measure reach.

.. CG-EXPLANATION-END id=const:GY

``function ufFind``
-------------------

.. CG-BLOCK id=function:ufFind lines=88-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 88-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:ufFind

**What this does.** The union-find root lookup with path compression — the standard way to ask which group an item currently belongs to.

**Why it is here.** It is the primitive that merges regions into connected components efficiently.

.. CG-EXPLANATION-END id=function:ufFind

``interface Component``
-----------------------

.. CG-BLOCK id=interface:Component lines=100-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 100-107
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Component

**What this does.** One connected component's data: its unclipped fraction reach (lowest and highest) and whether it reaches the left and right column edges.

**Why it is here.** It is what a shape verdict is scored from.

.. CG-EXPLANATION-END id=interface:Component

``function fracExtent``
-----------------------

.. CG-BLOCK id=function:fracExtent lines=108-118

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 108-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:fracExtent

**What this does.** Returns the lowest and highest fraction across a polygon's corners, unclipped.

**Why it is here.** The docstring records that using the full, unclipped extent matches the old classifier, so a dipping full-width band — whose band-window slice covers only part of the width but whose polygon still spans edge to edge — is still correctly scored as a band.

.. CG-EXPLANATION-END id=function:fracExtent

``function elevOverlaps``
-------------------------

.. CG-BLOCK id=function:elevOverlaps lines=119-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 119-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:elevOverlaps

**What this does.** Answers whether a polygon's elevation range overlaps the target band.

**Why it is here.** It selects which same-formation regions take part in classifying a given unit's band and excludes those at other depths.

.. CG-EXPLANATION-END id=function:elevOverlaps

``function bandComponents``
---------------------------

.. CG-BLOCK id=function:bandComponents lines=135-200

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 135-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:bandComponents

**What this does.** Groups the same-formation regions that overlap the band into connected components and returns, per component, its unclipped fraction reach and which column edges it reaches. It builds the components by rasterising each region's coverage within the band window onto a shared grid and union-finding across touching cells.

**Why it is here.** The block comment records the defect this fixes: the old classifier took the min and max fraction across ALL same-formation regions at once, so two disconnected same-formation lenses read as one full-width band (a false pass) and a facing onlap promoted the audited unit's own lens to a band (the Tie-10 false positive). Classifying per connected component, and later preferring the component touching the audited unit's own edge, cures both. Reach is measured unclipped, and the grid serves adjacency only.

.. CG-EXPLANATION-END id=function:bandComponents

``function shapeOfComponent``
-----------------------------

.. CG-BLOCK id=function:shapeOfComponent lines=201-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 201-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:shapeOfComponent

**What this does.** Classifies one component's shape from its edge reach: reaching both edges is a band, exactly one edge is an onlap, neither is a lens.

**Why it is here.** It is the direct 2 / 1 / 0 mapping from how many column edges a piece reaches to its shape name.

.. CG-EXPLANATION-END id=function:shapeOfComponent

``function renderedShape``
--------------------------

.. CG-BLOCK id=function:renderedShape lines=240-292

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 240-292
   :lineno-match:

.. CG-EXPLANATION-START id=function:renderedShape

**What this does.** Reports the rendered shape of a formation over a target band in a gap, classified per connected component. It prefers the component that touches the audited unit's own column edge (its side), scoring the widest such component; when nothing touches that edge it falls back to the widest component overall. It returns the shape plus the fraction extent, apex, edge reach, and whether the reported component was actually incident to the audited edge.

**Why it is here.** The docstring records that preferring the incident component means a facing same-formation onlap or lens on the OTHER column can no longer masquerade as the audited unit's own render; and that when the unit's own termination is genuinely missing, reporting the widest component keeps an all-facing render classified as band or onlap rather than spuriously absent, leaving it to the caller to decide whether that is a violation.

.. CG-EXPLANATION-END id=function:renderedShape

``function shallowTDForGap``
----------------------------

.. CG-BLOCK id=function:shallowTDForGap lines=293-300

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.conformance.classify.ts
   :language: typescript
   :lines: 293-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:shallowTDForGap

**What this does.** Returns the shallow bottom of a gap (in mTAW): the higher of the two facing columns' deepest base elevations.

**Why it is here.** The docstring records that below this elevation only one column has data, so a full-width fill there is the deep-to-deep substrate (owner ruling, section 8 question 3), not a same-formation termination band — and the 2/1/0 rule does not apply to it.

.. CG-EXPLANATION-END id=function:shallowTDForGap

