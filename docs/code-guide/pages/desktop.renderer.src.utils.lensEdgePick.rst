desktop.renderer.src.utils.lensEdgePick
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lensEdgePick.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lensEdgePick.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensEdgePick.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. It describes a helper that decides which edge of a pinch-out wedge a click on a ghost node belongs to — the upper edge or the lower edge.

**Why it is here.** The comment records the problem: a pinch-out wedge has two invisible click-strips, one along each edge, that meet at the apex, and on a thin wedge they overlap. Left alone, the drawing order (SVG paint order) silently sends every click to whichever strip was painted last, so the user feels the node grabbing both sides at once. Sending the click to the edge physically nearest the cursor removes that ambiguity.

.. CG-EXPLANATION-END id=module-header

``type Point``
--------------

.. CG-BLOCK id=type:Point lines=12-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensEdgePick.ts
   :language: typescript
   :lines: 12-12
   :lineno-match:

.. CG-EXPLANATION-START id=type:Point

**What this does.** Names a Point as a simple pair of numbers — an ``x`` and a ``y`` coordinate.

**Why it is here.** Giving the two-number coordinate a name lets the geometry below talk about points and segments plainly instead of repeating ``{x, y}`` everywhere.

.. CG-EXPLANATION-END id=type:Point

``type Segment``
----------------

.. CG-BLOCK id=type:Segment lines=13-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensEdgePick.ts
   :language: typescript
   :lines: 13-32
   :lineno-match:

.. CG-EXPLANATION-START id=type:Segment

**What this does.** Names a Segment as a pair of Points — the two endpoints of a straight edge. The comment that follows it documents the squared-distance helper below.

**Why it is here.** Naming the two-point edge keeps the distance maths readable; the comment records that the helper returns the squared distance rather than the true distance, because only two distances are ever compared, so taking a square root would be wasted work.

.. CG-EXPLANATION-END id=type:Segment

``function distSqToSegment``
----------------------------

.. CG-BLOCK id=function:distSqToSegment lines=33-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensEdgePick.ts
   :language: typescript
   :lines: 33-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:distSqToSegment

**What this does.** Computes the squared distance from a point to the nearest spot on a straight segment. It projects the point onto the segment's line, clamps that spot to stay between the two endpoints, and returns the squared gap to it.

**Why it is here.** The docstring records that the squared distance (not the true rooted distance) is enough because the caller only compares two distances, so the ``Math.sqrt`` is skipped; a zero-length segment — the apex sitting on the source corner — is handled by falling back to the distance to that single point.

.. CG-EXPLANATION-END id=function:distSqToSegment

``function nearerLensEdge``
---------------------------

.. CG-BLOCK id=function:nearerLensEdge lines=63-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensEdgePick.ts
   :language: typescript
   :lines: 63-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearerLensEdge

**What this does.** Given the click position and the upper and lower edge segments, returns whichever edge is physically nearer the cursor; an exact tie is resolved to the upper edge.

**Why it is here.** The docstring records that ties resolve to the upper edge so the choice is deterministic on a perfectly symmetric wedge — this is the fix for the overlapping click-strips described in the header.

.. CG-EXPLANATION-END id=function:nearerLensEdge

