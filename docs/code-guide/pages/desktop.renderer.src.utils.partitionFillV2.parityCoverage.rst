desktop.renderer.src.utils.partitionFillV2.parityCoverage
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2.parityCoverage.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2.parityCoverage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.parityCoverage.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds two things used by the partition checks: a point-in-polygon test (does a point sit inside a shape) and a helper that measures the total area a set of regions covers. The imports bring in the section point and region types.

**Why it is here.** The comment records that this was split out of the parity-comparison runner to keep that file under the 500-line budget (debt #201), and that it is a *pure function* module — no screen drawing, no file access. Its purpose is the A/B parity check between the two fill engines: for a true partition the summed area of the regions is about equal to the area they cover together, and any excess is exactly the double-painted area — space a v1 lens overlay claimed on top of the band beneath it (design note partition-engine-v2.md §6).

.. CG-EXPLANATION-END id=module-header

``function inPolygon``
----------------------

.. CG-BLOCK id=function:inPolygon lines=17-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.parityCoverage.ts
   :language: typescript
   :lines: 17-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:inPolygon

**What this does.** The point-in-polygon test. Given a point — x is the fraction across the gap, y is the elevation — and a polygon, it walks around each edge of the polygon and counts how many times the boundary winds around the point; it reports the point as inside when that winding count is not zero.

**Why it is here.** The comment records that this is the SVG nonzero-winding fill rule — the very rule the browser uses to fill the same polygon on screen. Using the identical rule means the check's idea of "inside the shape" matches, corner for corner, what the engineer actually sees painted.

.. CG-EXPLANATION-END id=function:inPolygon

``function unionCoverageArea``
------------------------------

.. CG-BLOCK id=function:unionCoverageArea lines=56-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2.parityCoverage.ts
   :language: typescript
   :lines: 56-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:unionCoverageArea

**What this does.** Measures the total area covered by one engine's regions across a whole section, counting each spot only once even when several regions overlap it. It groups the regions by gap; for each gap it finds the elevation range, works out the area of one grid cell, then sweeps a dense grid of sample points and adds one cell of area for every point that falls inside at least one region.

**Why it is here.** The comment records the arithmetic this feeds: summed region areas minus this union area equals the double-painted area, which for a true partition should be near zero. v2 is a true partition, so its sum is about equal to its union; a leftover v1 excess over v2's union is the real coverage difference (v2's vacancy holes). The 200×400 grid is fine enough to keep the measurement well under the 0.05-per-section residual gate.

.. CG-EXPLANATION-END id=function:unionCoverageArea

