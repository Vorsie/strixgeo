desktop.renderer.src.utils.countSpanningRegions
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/countSpanningRegions.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/countSpanningRegions.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/utils/countSpanningRegions.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing this helper — a count of how many partition regions span their whole gap, the single number that tells a band from an onlap or a lens at a glance — and the import of the region shape.

**Why it is here.** The comment records why it is shared: two places log this number — the section overlay (what the engineer sees) and the voxel-request builder (what the 3-D builder is given) — and those two are documented to assemble identical columns, so when they disagree the difference is the answer, which is only meaningful if both count the same way. It was extracted as the second copy per the extract-on-the-second-copy rule, which also keeps the count out of the already-oversized overlay (debt #201).

.. CG-EXPLANATION-END id=module-header

``const EDGE_TOL``
------------------

.. CG-BLOCK id=const:EDGE_TOL lines=15-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/countSpanningRegions.ts
   :language: typescript
   :lines: 15-22
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_TOL

**What this does.** A small tolerance (one hundredth): how close to the left edge (0) and right edge (1) a region's outline must reach to count as spanning its gap.

**Why it is here.** The comment records that a region rarely lands exactly on 0 and 1, so a region within this tolerance of both edges is treated as spanning.

.. CG-EXPLANATION-END id=const:EDGE_TOL

``function countSpanningRegions``
---------------------------------

.. CG-BLOCK id=function:countSpanningRegions lines=23-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/countSpanningRegions.ts
   :language: typescript
   :lines: 23-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:countSpanningRegions

**What this does.** Counts the regions whose outline reaches both column edges of its gap: for each region it finds the lowest and highest horizontal fraction in the outline and adds one when the low is near 0 and the high is near 1.

**Why it is here.** The docstring records that a region reaching both edges is a band, as opposed to a one-sided wedge or an enclosed lens — so this count distinguishes the three at a glance.

.. CG-EXPLANATION-END id=function:countSpanningRegions

