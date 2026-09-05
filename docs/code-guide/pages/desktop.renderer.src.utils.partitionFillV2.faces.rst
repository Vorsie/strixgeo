desktop.renderer.src.utils.partitionFillV2.faces
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/faces.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/faces.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module traces the faces of the arrangement. After all the lines are laid down and cut at their crossings, the engine has a DCEL — a doubly-connected edge list, a data structure where every line segment is stored as two directed half-edges (one each way) wired so that following the ``next`` pointer walks around one enclosed tile. This module walks every such loop, measures each loop's signed area (positive for a counter-clockwise loop, which is a real filled cell; negative for a clockwise loop, which is either the outside of the whole drawing or a hole inside a cell), drops zero-area loops, and attaches each hole to the smallest cell that contains it.

**Why it is here.** The docstring states the design rule: degenerate and zero-area loops are dropped at trace time, never repaired afterwards, and hole containment is resolved by a point-in-polygon test so a clockwise loop inside a counter-clockwise face becomes that face's hole.

.. CG-EXPLANATION-END id=module-header

``interface Loop``
------------------

.. CG-BLOCK id=interface:Loop lines=24-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 24-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Loop

**What this does.** A type for one raw traced boundary loop before it is classified: its half-edge indices and vertex indices in walk order, its signed area in grid units squared, and the set of input-line ids along it.

**Why it is here.** The trace records these four things per loop so the later steps can tell filled cells from holes (signed area), rebuild the polygon (vertices), and colour the face (line ids).

.. CG-EXPLANATION-END id=interface:Loop

``function traceFaces``
-----------------------

.. CG-BLOCK id=function:traceFaces lines=51-132

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 51-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:traceFaces

**What this does.** The entry point. It walks every loop, splits them into bounded faces (positive area) and hole candidates (negative area), identifies the single largest clockwise loop as the outside of the drawing and discards it, then for each remaining clockwise loop finds the smallest bounded face strictly larger than it that contains it and attaches it as a hole. It returns the bounded faces in a deterministic order.

**Why it is here.** The docstring records the containment rule (attach a hole to the smallest, immediately-enclosing face, requiring the container to be strictly larger so a hole attaches to the annulus, not the fill face that shares its vertices) and the deterministic sort so the output is reproducible.

.. CG-EXPLANATION-END id=function:traceFaces

``function walkLoops``
----------------------

.. CG-BLOCK id=function:walkLoops lines=133-229

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 133-229
   :lineno-match:

.. CG-EXPLANATION-START id=function:walkLoops

**What this does.** Walks every ``next`` cycle of the DCEL exactly once (guarded so each boundary is emitted only one time), producing raw loops. It strips zero-width spurs, splits self-touching loops into simple sub-loops, computes each sub-loop's signed area, and assigns each sub-loop only the line ids of its own edges.

**Why it is here.** The docstring records the per-sub-loop line-id rule is the increment-17 adjacent-minority fix: without it, splitting a figure-8 ring hands every sub-triangle the whole band's line ids and the enclosed minority's notch gets voted to the matrix colour (S6 gap19 KLEI read SILT). It records spurs and self-touching rings must be cleaned because they break the coverage scan and the per-gap slice.

.. CG-EXPLANATION-END id=function:walkLoops

``function stripSpurs``
-----------------------

.. CG-BLOCK id=function:stripSpurs lines=230-285

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 230-285
   :lineno-match:

.. CG-EXPLANATION-START id=function:stripSpurs

**What this does.** Removes zero-width out-and-back tendrils from a loop: any vertex whose two ring-neighbours are the same vertex is a spur tip and is dropped, iterating to a fixpoint so nested spurs also collapse.

**Why it is here.** The docstring records a synthesized closing line that dead-ends (an onlap tip landing mid-tie, a lens apex shared with the matrix) leaves such a tendril, which makes the polygon non-simple and produces spurious holes and overlaps; collapsing it at trace time canonicalises the ring without changing the real area.

.. CG-EXPLANATION-END id=function:stripSpurs

``function splitAtRepeats``
---------------------------

.. CG-BLOCK id=function:splitAtRepeats lines=286-305

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 286-305
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAtRepeats

**What this does.** Splits a self-touching loop into strictly-simple sub-loops at every repeated vertex: the segment between the two sightings of a vertex is cut off as its own loop and the remainder is stitched back, recursing for nested pinches.

**Why it is here.** The docstring records a traced boundary visits a pinch or apex vertex twice when two lobes of a face meet at one point, making a figure-8 loop that triangulates as non-simple; splitting there gives simple polygons that share the pinch only as a corner.

.. CG-EXPLANATION-END id=function:splitAtRepeats

``function signedGridArea``
---------------------------

.. CG-BLOCK id=function:signedGridArea lines=306-316

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 306-316
   :lineno-match:

.. CG-EXPLANATION-START id=function:signedGridArea

**What this does.** Computes a polygon's signed area in grid units squared using the shoelace formula (counter-clockwise is positive).

**Why it is here.** The sign tells a filled cell (positive) from a hole or the outside (negative), and the magnitude ranks holes and containers; a small exact helper delivers both.

.. CG-EXPLANATION-END id=function:signedGridArea

``function gridAreaToMetres``
-----------------------------

.. CG-BLOCK id=function:gridAreaToMetres lines=317-328

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 317-328
   :lineno-match:

.. CG-EXPLANATION-START id=function:gridAreaToMetres

**What this does.** Converts a signed grid area into a positive area in square metres using the grid step.

**Why it is here.** Faces report their area in metres for downstream consumers, so the grid-unit area is scaled once here.

.. CG-EXPLANATION-END id=function:gridAreaToMetres

``function ringContainsRing``
-----------------------------

.. CG-BLOCK id=function:ringContainsRing lines=329-339

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 329-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:ringContainsRing

**What this does.** A yes/no test: does one ring lie inside another? It tests a point guaranteed strictly inside the inner ring against the outer ring with a ray-cast.

**Why it is here.** The docstring notes arrangement faces are either nested or disjoint (never partially overlapping), so a single strict-interior point decides containment.

.. CG-EXPLANATION-END id=function:ringContainsRing

``function interiorPoint``
--------------------------

.. CG-BLOCK id=function:interiorPoint lines=340-372

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 340-372
   :lineno-match:

.. CG-EXPLANATION-START id=function:interiorPoint

**What this does.** Returns a point guaranteed strictly inside a ring, robust for concave rings: it finds a convex corner (an ear) whose triangle is interior to the ring and returns that triangle's centroid.

**Why it is here.** The docstring notes arrangement faces can be concave, so a simple centroid of all vertices might fall outside; a verified ear centroid is always inside a simple polygon.

.. CG-EXPLANATION-END id=function:interiorPoint

``function pointInRing``
------------------------

.. CG-BLOCK id=function:pointInRing lines=373-385

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/faces.ts
   :language: typescript
   :lines: 373-385
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInRing

**What this does.** A ray-cast point-in-polygon test on a grid-unit ring, counting how many edges a horizontal ray crosses.

**Why it is here.** The containment and interior-point checks both need to know whether a point is inside a ring; this is the shared primitive.

.. CG-EXPLANATION-END id=function:pointInRing

