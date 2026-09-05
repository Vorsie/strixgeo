desktop.renderer.src.utils.partitionFillV2.ringSelfIntersect
============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module splits a polygon ring that crosses itself into strictly simple (non-self-crossing) sub-rings. It handles the figure-8 or bowtie case: two closing curves converging to nearly-equal but not identical elevations trace two edges that cross at an interior point that is not a shared vertex.

**Why it is here.** The docstring records it was split out of ``slice.ts`` for the 500-line file budget (debt #201). ``slice.ts`` already unfolds a WEAKLY simple ring (two lobes sharing an exact repeated vertex); this handles the harder case with no repeated vertex, exposed on the CS2 gap15 banded-silt-around-a-clay-lens face once the top band re-anchored to a sloped first-litho line (ruling 5-revised). It is a pure module — its output depends only on its input and it touches nothing else.

.. CG-EXPLANATION-END id=module-header

``const FRACTION_SNAP``
-----------------------

.. CG-BLOCK id=const:FRACTION_SNAP lines=20-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 20-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:FRACTION_SNAP

**What this does.** The output fraction snap grid, 1e-6, mirrored from ``slice.ts``.

**Why it is here.** The crossing point this module computes must round to the same fraction grid the slicer uses, so the two agree on where a vertex sits.

.. CG-EXPLANATION-END id=const:FRACTION_SNAP

``const ELEV_SNAP_M``
---------------------

.. CG-BLOCK id=const:ELEV_SNAP_M lines=22-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 22-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_SNAP_M

**What this does.** The elevation snap grid, 1 mm, mirrored from ``slice.ts``.

**Why it is here.** Same reason as the fraction grid: the computed crossing's elevation is snapped to the shared 1 mm grid so it lands on a canonical vertex.

.. CG-EXPLANATION-END id=const:ELEV_SNAP_M

``function splitAtSelfIntersections``
-------------------------------------

.. CG-BLOCK id=function:splitAtSelfIntersections lines=58-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 58-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAtSelfIntersections

**What this does.** The public wrapper: it measures the input ring's winding direction, decomposes the ring at its self-crossings, and keeps only the sub-rings whose winding matches the original — dropping the reversed-winding pieces.

**Why it is here.** This is the load-bearing detail from the docstring: a bowtie decomposes into the real painted lobes PLUS a reversed-winding fold between the two crossings that double-counts the enclosed lens's territory. Emitting that fold is exactly the residual 1.3 cm clay-over-silt overlap, so only sub-rings matching the original winding are kept. Preserving the original sign — not merely dropping negatives — keeps a clockwise input's real lobes.

.. CG-EXPLANATION-END id=function:splitAtSelfIntersections

``function signedFracArea``
---------------------------

.. CG-BLOCK id=function:signedFracArea lines=67-81

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 67-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:signedFracArea

**What this does.** Computes the signed area of a fraction-by-elevation ring with the shoelace formula; the sign tells the winding direction.

**Why it is here.** The winding sign is what the wrapper uses to tell a real lobe from the reversed-winding fold.

.. CG-EXPLANATION-END id=function:signedFracArea

``function splitSelfIntersecting``
----------------------------------

.. CG-BLOCK id=function:splitSelfIntersecting lines=82-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 82-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitSelfIntersecting

**What this does.** The recursive geometric cutter. It finds the first pair of non-adjacent edges that properly cross, computes the crossing point, splits the ring into the two loops that meet there, and recurses on both so a double crossing unfolds in two passes. An already-simple ring has no crossing and is returned unchanged.

**Why it is here.** The docstring notes it deliberately does not over-split: a legitimate concave ring (including one with several vertices at the same fraction on a column vertical) has no proper crossing, so it survives intact. The winding filter is applied by the wrapper; this helper does only the geometry.

.. CG-EXPLANATION-END id=function:splitSelfIntersecting

``function snapFraction``
-------------------------

.. CG-BLOCK id=function:snapFraction lines=127-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/ringSelfIntersect.ts
   :language: typescript
   :lines: 127-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:snapFraction

**What this does.** Rounds a fraction to the 1e-6 grid and clamps it into the range 0 to 1.

**Why it is here.** Keeps the computed crossing point on the shared output grid and inside a valid gap fraction.

.. CG-EXPLANATION-END id=function:snapFraction

