desktop.renderer.src.utils.mergeFencePanels
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/mergeFencePanels.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/mergeFencePanels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the one import. This file collapses a section's fence panels so each connected body is drawn as ONE panel instead of one panel per gap (debt #278, phase 7).

**Why it is here.** The comment records the problem: the panel builder emits one panel per region and there is one region per gap, so a body spanning several gaps is drawn as several panels meeting at vertical seams — 775 of 898 seams on the owner's model were these false twins of one body (owner ruling 2026-08-31, "one panel per connected body per section"). It records why the body resolver is the primary grouping key and the label only a fallback: on the geotech fill the region labels are minted per gap, so the same mass carries a different label in each gap and grouping by label would merge nothing; the label-independent identity is the panels' layers resolved through the body they belong to. And it records why welding erases the seam: the right edge of one gap and the left edge of the next are the same column point cut at the same elevations, so welding their coincident vertices to shared indices makes the seam an interior shared edge, which the DXF exporter marks invisible.

.. CG-EXPLANATION-END id=module-header

``const WELD_TOLERANCE_M``
--------------------------

.. CG-BLOCK id=const:WELD_TOLERANCE_M lines=42-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 42-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:WELD_TOLERANCE_M

**What this does.** The welding tolerance in project-CRS metres: a tenth of a millimetre.

**Why it is here.** The comment records that it is deliberately finer than the section fill's one-millimetre snap grid, so two genuinely distinct cut points (a millimetre or more apart) never fuse, while the same column point computed from two adjacent gaps — differing only by floating-point round-off of about a hundred-millionth of a metre — always does.

.. CG-EXPLANATION-END id=const:WELD_TOLERANCE_M

``interface PanelGroup``
------------------------

.. CG-BLOCK id=interface:PanelGroup lines=45-94

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 45-94
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PanelGroup

**What this does.** A merge group: a grouping key, the body id the merged wall will carry, and the member panels that fall into it.

**Why it is here.** It is the intermediate bucket the panels are sorted into before each group is welded.

.. CG-EXPLANATION-END id=interface:PanelGroup

``function mergeFencePanels``
-----------------------------

.. CG-BLOCK id=function:mergeFencePanels lines=95-144

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 95-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeFencePanels

**What this does.** Groups a section's panels by the body they belong to and welds each multi-panel group into a single panel, while lone panels and panels with no body identity pass through unchanged. Group order follows each body's first appearance, preserving render order. Grouping uses the supplied body resolver first and the label only as a fallback, and a panel whose body resolves to nothing never merges.

**Why it is here.** The docstring records that a resolved-to-nothing panel means "no body identity", not "same body", so it is left alone, and that a merged panel carries its first member's formation, the resolved body id, and the combined layer ids. It flags a known limitation: a body welded across two litho families (the owner's "one mass one body" ruling of 2026-08-21) keeps only the first member's formation on the merged wall, so the cutout filter, the legend's "walled" mark and the DXF layer name credit just that one formation — a point flagged to the owner while body identity across formations is being settled as a whole (debt #278).

.. CG-EXPLANATION-END id=function:mergeFencePanels

``function mergeGroup``
-----------------------

.. CG-BLOCK id=function:mergeGroup lines=145-179

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 145-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeGroup

**What this does.** Welds one body's panels into a single triangle-soup panel: it remaps every member's vertices through the welder, concatenates the triangles with their corner indices remapped, drops any triangle whose corners welded down to fewer than three distinct points, and unions the members' layer ids.

**Why it is here.** The docstring records that vertices within the weld tolerance reuse an existing index so the shared column seam becomes an index-shared edge, and that a spatial hash on the tolerance grid keeps the weld nearly linear in the number of vertices. Dropping the collapsed triangles is cheap insurance so a future change to the snap grid can never leak a zero-area triangle to the renderer or the DXF export. The merged panel stamps the first member's formation, the known limitation noted above.

.. CG-EXPLANATION-END id=function:mergeGroup

``function cellOf``
-------------------

.. CG-BLOCK id=function:cellOf lines=180-190

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 180-190
   :lineno-match:

.. CG-EXPLANATION-START id=function:cellOf

**What this does.** Maps one coordinate value to the integer grid cell it falls in, at the weld tolerance.

**Why it is here.** It is the spatial-hash bucket index, so a vertex only has to compare itself against the handful of nearby vertices rather than all of them.

.. CG-EXPLANATION-END id=function:cellOf

``function weldVertex``
-----------------------

.. CG-BLOCK id=function:weldVertex lines=191-230

.. literalinclude:: ../../../desktop/src/renderer/src/utils/mergeFencePanels.ts
   :language: typescript
   :lines: 191-230
   :lineno-match:

.. CG-EXPLANATION-START id=function:weldVertex

**What this does.** Returns the index of a pooled vertex within tolerance of the given point, or, when there is none, adds the point to the pool and the spatial hash and returns its new index; among several in-tolerance matches the lowest index wins.

**Why it is here.** The docstring records that only the three-by-three-by-three block of cells around the point can hold a within-tolerance match, so that is all it scans, and that the lowest-index tie-break makes the remapping independent of which order the cells are visited. It notes that the single-linkage chaining a spatial weld can suffer is a non-issue here because real cut points sit at least a millimetre apart, an order of magnitude beyond the tenth-millimetre tolerance.

.. CG-EXPLANATION-END id=function:weldVertex

