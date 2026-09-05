desktop.renderer.src.utils.geotechHierarchicalFill.frameClipGeometry
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module holds the pure-geometry parts of the frame clip — the step that cuts one family's packing partition to that family's own litho regions. That cut is a polygon overlay: both sets of outlines go into ONE planar arrangement (a tiling of the plane into faces, built by tracing where the lines cross), and every resulting face is identified by a point strictly inside it. The three helpers here carry no knowledge of soils, classes or families — only shapes. It imports the arrangement builder and its point and curve shapes.

**Why it is here.** The docstring records these three helpers were all proven on the owner's real model in the post-hoc clip this construction replaces, and the notes on why each is shaped as it is are the expensive part and are kept verbatim. Keeping the geometry separate from the labelling is what lets the frame clip be structural — the cover is an input to the arrangement, not a clean-up afterwards.

.. CG-EXPLANATION-END id=module-header

``const FRACTION_SCALE``
------------------------

.. CG-BLOCK id=const:FRACTION_SCALE lines=25-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 25-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:FRACTION_SCALE

**What this does.** A constant: the factor, 100, that gap-local fractions are multiplied by before the arrangement snaps them.

**Why it is here.** The arrangement snaps to a millimetre grid in both axes; scaling the fraction first makes the snap cost a hundred-thousandth of a fraction, far below render resolution, while unscaled elevations keep their real millimetres.

.. CG-EXPLANATION-END id=const:FRACTION_SCALE

``const MIN_FACE_AREA``
-----------------------

.. CG-BLOCK id=const:MIN_FACE_AREA lines=28-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 28-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_FACE_AREA

**What this does.** The area below which a face is treated as snap debris and dropped.

**Why it is here.** Snapping to a grid can mint slivers of essentially no area, and anything below this is noise, not ground.

.. CG-EXPLANATION-END id=const:MIN_FACE_AREA

``interface ClipFace``
----------------------

.. CG-BLOCK id=interface:ClipFace lines=31-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 31-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ClipFace

**What this does.** The data shape for one overlay face: its closed ring in the caller's own fraction-and-elevation coordinates, and a point strictly inside it for attribution.

**Why it is here.** The overlay returns geometry only, and the interior sample is what the labelling step later reads a soil and class from.

.. CG-EXPLANATION-END id=interface:ClipFace

``function keyholedRing``
-------------------------

.. CG-BLOCK id=function:keyholedRing lines=51-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 51-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:keyholedRing

**What this does.** Merges a face's hole rings into its outer ring with zero-width bridges cut to the nearest vertex, yielding one self-touching ring that excludes the holes under both fill rules. It bridges each hole in turn from its rightmost vertex to the nearest outer vertex.

**Why it is here.** An arrangement records an enclosed loop — a floating lens — as a hole while the loop's interior is its own separate face; without the bridge the surrounding face's outer ring would claim the hole's area too and its interior sample could land inside the hole.

.. CG-EXPLANATION-END id=function:keyholedRing

``function pointInRing``
------------------------

.. CG-BLOCK id=function:pointInRing lines=81-114

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 81-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInRing

**What this does.** Asks whether a sample fraction-and-elevation point lies inside a ring, by ray-casting under the even-odd rule.

**Why it is here.** It is the basic inside/outside test the interior-point search and the labelling both rely on.

.. CG-EXPLANATION-END id=function:pointInRing

``function interiorPoint``
--------------------------

.. CG-BLOCK id=function:interiorPoint lines=115-173

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 115-173
   :lineno-match:

.. CG-EXPLANATION-START id=function:interiorPoint

**What this does.** Returns a point strictly inside a simple ring, robust for concave rings: the centroid of the LARGEST valid convex corner, falling back to the ring's centroid and then to points walked toward the centroid from each vertex.

**Why it is here.** Largest, not first-found: a face can carry a cluster of near-coincident vertices whose tiny corner's centroid sits ON the ring, which then attributes the face across whatever boundary passes through that corner — a silt face re-labelled to clay this way (owner dogfeed 2026-08-18 evening). Returning an outside point is how a face gets attributed to a region it does not touch and painted twice (measured as a 9.3 m2 sand-over-clay overlap on CS1), so the search never gives up until it finds a genuinely interior point.

.. CG-EXPLANATION-END id=function:interiorPoint

``const EPS``
-------------

.. CG-BLOCK id=const:EPS lines=174-178

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 174-178
   :lineno-match:

.. CG-EXPLANATION-START id=const:EPS

**What this does.** A constant: the distance from a segment's start at which two cut points count as one.

**Why it is here.** It keeps near-coincident intersection points from being registered as two separate cuts.

.. CG-EXPLANATION-END id=const:EPS

``const T_TOL``
---------------

.. CG-BLOCK id=const:T_TOL lines=179-203

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 179-203
   :lineno-match:

.. CG-EXPLANATION-START id=const:T_TOL

**What this does.** A tolerance, half the snap cell, for deciding a T-junction endpoint lies on another segment.

**Why it is here.** A T-junction endpoint and its projection land in the same snap cell, so the cut vertex equals the endpoint vertex after the snap, and this tolerance recognises that.

.. CG-EXPLANATION-END id=const:T_TOL

``function overlayFaces``
-------------------------

.. CG-BLOCK id=function:overlayFaces lines=204-304

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/frameClipGeometry.ts
   :language: typescript
   :lines: 204-304
   :lineno-match:

.. CG-EXPLANATION-START id=function:overlayFaces

**What this does.** Overlays a set of rings into one planar arrangement and returns its faces, each with an interior sample. It breaks the rings into unique undirected segments, pre-splits every crossing and T-junction in floating point so each becomes a shared endpoint, builds the arrangement, and drops debris faces and repeated vertices before sampling.

**Why it is here.** Two preparations are load-bearing and both were settled against real data. Rings must be decomposed into UNIQUE segments because adjacent regions state their shared boundary twice, and feeding coincident duplicates lets face-tracing jump across the boundary. Every crossing must be pre-split in float because the arrangement only registers a snapped crossing when it lands exactly on the integer line, which a long shallow-angle crossing practically never does — the cut vanished silently and faces straddled litho boundaries — and making each crossing a shared endpoint is something the arrangement handles exactly.

.. CG-EXPLANATION-END id=function:overlayFaces

