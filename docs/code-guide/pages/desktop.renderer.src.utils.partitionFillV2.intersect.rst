desktop.renderer.src.utils.partitionFillV2.intersect
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/intersect.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/intersect.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module takes the set of grid-snapped line segments and finds every place two of them meet — a proper crossing, a T-junction where one segment's endpoint lands on another's interior, a shared endpoint, or a collinear overlap — snaps each meeting point back onto the grid, and splits every segment at the points that lie on it. The result is a set of segments that touch only at endpoints, which is exactly what the DCEL builder needs.

**Why it is here.** The docstring records the single-snapping-pass rule (crossings are computed in floating point then immediately snapped, and all later work is exact integer) and that the algorithm is a simple pairwise sweep because section arrangements have only hundreds of segments.

.. CG-EXPLANATION-END id=module-header

``interface GridSegment``
-------------------------

.. CG-BLOCK id=interface:GridSegment lines=25-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 25-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GridSegment

**What this does.** A type for one segment between two grid points, tagged with the input-line id it came from.

**Why it is here.** The id must ride each sub-segment through the split so the traced face can later be coloured from its bounding lines.

.. CG-EXPLANATION-END id=interface:GridSegment

``const T_JUNCTION_PERP_TOL``
-----------------------------

.. CG-BLOCK id=const:T_JUNCTION_PERP_TOL lines=47-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 47-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:T_JUNCTION_PERP_TOL

**What this does.** A constant, one grid unit (1 mm): the perpendicular-distance tolerance for snapping a near-collinear T-junction onto a segment.

**Why it is here.** The docstring records a synthesized flank apex is computed to lie exactly on a sloping tie in floating point, but its x and y each snap independently to the grid, so a sloped line almost never passes through a lattice point and the snapped apex lands a fraction of a unit off the tie's integer line; the exact-collinear test then misses the junction and the flank dead-ends as a spur. A one-unit tolerance snaps it on, well below the 1 mm feature scale so it only ever catches this snap-rounding drift.

.. CG-EXPLANATION-END id=const:T_JUNCTION_PERP_TOL

``function cross``
------------------

.. CG-BLOCK id=function:cross lines=55-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 55-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:cross

**What this does.** Returns the cross product of two vectors from a shared point, in integer grid units.

**Why it is here.** The docstring notes its sign gives the turn direction of an ordered triple (left, right, or collinear), exact on integers — the primitive under every crossing and collinearity test.

.. CG-EXPLANATION-END id=function:cross

``function inBBox``
-------------------

.. CG-BLOCK id=function:inBBox lines=60-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 60-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:inBBox

**What this does.** A yes/no test: is a grid point inside the axis-aligned bounding box of a segment?

**Why it is here.** A cheap containment pre-check used with the collinearity test to confirm a collinear point actually lies on the segment, not its extension.

.. CG-EXPLANATION-END id=function:inBBox

``function onCollinearSegment``
-------------------------------

.. CG-BLOCK id=function:onCollinearSegment lines=69-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 69-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:onCollinearSegment

**What this does.** A yes/no test: does a point lie exactly on a segment (collinear and within its bounding box)?

**Why it is here.** The exact on-segment test for collinear and endpoint cases, used to decide where to register a cut.

.. CG-EXPLANATION-END id=function:onCollinearSegment

``function nearInteriorT``
--------------------------

.. CG-BLOCK id=function:nearInteriorT lines=85-119

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 85-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearInteriorT

**What this does.** A yes/no test: is a point a near-collinear T-junction on a segment's interior — within the perpendicular tolerance, projecting strictly between the endpoints, and not already exactly collinear?

**Why it is here.** The docstring records it recovers an onlap or lens flank apex whose grid snap drifted a fraction of a unit off the tie it was computed to ride, so the flank still splits the crossed segment and its face closes. It compares squared distances to stay in exact integer arithmetic.

.. CG-EXPLANATION-END id=function:nearInteriorT

``function segmentIntersections``
---------------------------------

.. CG-BLOCK id=function:segmentIntersections lines=120-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 120-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentIntersections

**What this does.** Computes where two segments meet: for a proper crossing it solves the crossing point in floating point and snaps it; for collinear, touching, and T-junction cases it collects each endpoint of one segment that lies on the other.

**Why it is here.** The docstring records endpoint-coincident points are still returned so the caller can register them as shared vertices, and the split step ignores endpoint-only hits that do not lie in a segment's interior.

.. CG-EXPLANATION-END id=function:segmentIntersections

``function splitSegments``
--------------------------

.. CG-BLOCK id=function:splitSegments lines=173-314

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 173-314
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitSegments

**What this does.** Splits every segment at the intersection points on its interior, snaps all coordinates, and drops zero-length pieces. It builds each segment's cut set (seeded with its own endpoints), uses an x-ordered sweep to visit only pairs whose boxes come within tolerance, registers each cut on whichever segment it lies on, and cuts each segment into ordered sub-segments.

**Why it is here.** The docstring records the tolerant cut registration (a proper crossing's rounded point lands up to root-two-over-two units off each integer line, so an exact test silently dropped the cut and faces straddled a line — debt #271), the kind-scoping (the tolerant arm applies only when neither party is a synthesized closing line, because those historically dead-ended and the shipped fallback output depends on it), and the one widening for bridge crossings (owner 2026-08-18, the bracketed VD quad). The near-T recovery is gated on the product flag so the fallback path stays byte-identical. The x-ordered sweep replaces the old quadratic scan (778 segments on the busiest section was 302,253 pairs).

.. CG-EXPLANATION-END id=function:splitSegments

``function pointOnOrNearSegment``
---------------------------------

.. CG-BLOCK id=function:pointOnOrNearSegment lines=315-333

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 315-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointOnOrNearSegment

**What this does.** A yes/no test: does a point lie on a segment exactly, or when tolerant, within the perpendicular tolerance with its projection inside the segment?

**Why it is here.** The docstring records the tolerant arm exists for proper-crossing cut registration (the rounded crossing sits up to root-two-over-two units off each line, and exact collinearity would drop the cut — debt #271); the caller scopes when tolerance is allowed by line kind.

.. CG-EXPLANATION-END id=function:pointOnOrNearSegment

``function orderCutsAlong``
---------------------------

.. CG-BLOCK id=function:orderCutsAlong lines=334-344

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 334-344
   :lineno-match:

.. CG-EXPLANATION-START id=function:orderCutsAlong

**What this does.** Orders a segment's cut points from one endpoint to the other, using the integer projection along the segment direction as the key.

**Why it is here.** The docstring notes the projection is exact and monotone along the segment, so the cuts sort into the correct order for slicing into sub-segments.

.. CG-EXPLANATION-END id=function:orderCutsAlong

``function compareSegments``
----------------------------

.. CG-BLOCK id=function:compareSegments lines=345-353

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/intersect.ts
   :language: typescript
   :lines: 345-353
   :lineno-match:

.. CG-EXPLANATION-START id=function:compareSegments

**What this does.** A deterministic comparator ordering segments by their first point, then second point, then line id.

**Why it is here.** The result is sorted so the arrangement is built in a reproducible order regardless of the pairwise-scan sequence.

.. CG-EXPLANATION-END id=function:compareSegments

