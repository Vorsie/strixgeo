desktop.renderer.src.utils.partitionFillV2.sliceAnnulus
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module subtracts interior holes from a matrix ANNULUS and supplies the polygon-clipping primitives the slicer needs. An annulus is a simple outer ring with one or more interior holes (the enclosed-lens faces); it is decomposed into disjoint strictly-simple pieces — the replacement for the removed keyhole.

**Why it is here.** The docstring records it was split out of ``slice.ts`` for the 500-line budget (debt #201) and rebuilt for sloped-edge exactness (ruling-8e Milestone-2). For each hole the region splits into a left cap, a right cap, and the matrix above and below the hole's ACTUAL sloped envelope, not its flat bounding box. Pure module.

.. CG-EXPLANATION-END id=module-header

``function splitAnnulus``
-------------------------

.. CG-BLOCK id=function:splitAnnulus lines=36-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 36-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAnnulus

**What this does.** Splits an annulus into disjoint simple pieces whose union is the outer ring minus every hole, subtracting the holes one at a time (left to right for determinism) and re-splitting each surviving piece against the next hole.

**Why it is here.** The docstring pins that piece boundaries are kept EXACT with no grid snap: the pieces share a sloped contact with the neighbouring band, and snapping a shared vertex to the 1 mm lattice would push it half a millimetre off the true contact line and overlap the neighbour (the cs1void sand-over-sand exact-overlap gate). The crossings are solved analytically so adjacent pieces meet on the exact same line.

.. CG-EXPLANATION-END id=function:splitAnnulus

``function subtractHole``
-------------------------

.. CG-BLOCK id=function:subtractHole lines=66-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 66-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:subtractHole

**What this does.** Subtracts one hole from a simple piece. The cuts are confined to the hole's elevation band: above and below that band the matrix stays one full-width strip, and within the band the piece is split into a left cap, a right cap, and the two matrix wedges beside the hole's actual sloped edges.

**Why it is here.** The docstring explains both choices. Keeping the matrix outside the band as a single strip means a top or base contour shared with a neighbouring band stays a single straight edge, avoiding the half-millimetre snap sliver. Following the hole's real sloped envelope inside the band is required because an enclosed lens hole is a TRIANGLE — a flat-line box split would drop the wedges beside it (the CS1 g15 silt 44 cm coverage hole).

.. CG-EXPLANATION-END id=function:subtractHole

``function clipToStrip2Y``
--------------------------

.. CG-BLOCK id=function:clipToStrip2Y lines=102-118

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 102-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipToStrip2Y

**What this does.** Clips a polygon to the horizontal band between two elevations, by clipping against the low and then the high horizontal line.

**Why it is here.** It restricts the piece to the hole's elevation band so the cutting work happens only there.

.. CG-EXPLANATION-END id=function:clipToStrip2Y

``function holeEnvelopes``
--------------------------

.. CG-BLOCK id=function:holeEnvelopes lines=119-164

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 119-164
   :lineno-match:

.. CG-EXPLANATION-START id=function:holeEnvelopes

**What this does.** Splits a hole ring into its upper and lower envelope chains, each running left-to-right, deliberately excluding any vertical base edge sitting on a column at an extreme x.

**Why it is here.** An enclosed-lens hole is a triangle or convex quad with its base on a column vertical and its apex mid-gap; the two envelope chains are what the wedge clip follows. The docstring warns that including the vertical base edge would make a chain non-monotone and let the clip cover the hole itself (the silt-lens-over-sand overlap), and the caller's strip clip already owns that edge.

.. CG-EXPLANATION-END id=function:holeEnvelopes

``function clipAgainstChain``
-----------------------------

.. CG-BLOCK id=function:clipAgainstChain lines=165-200

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 165-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipAgainstChain

**What this does.** Clips a polygon to the region above (or below) an x-monotone chain, using Sutherland-Hodgman clipping against the chain, interpolating crossings and holding the chain constant outside its x-span.

**Why it is here.** This is how the matrix wedge is cut to follow the hole's real sloped edge rather than a flat line, so the wedge beside a triangular lens hole is retained instead of dropped.

.. CG-EXPLANATION-END id=function:clipAgainstChain

``function crossChain``
-----------------------

.. CG-BLOCK id=function:crossChain lines=201-228

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 201-228
   :lineno-match:

.. CG-EXPLANATION-START id=function:crossChain

**What this does.** Finds where a segment crosses the chain, by bisection on the signed vertical distance, and returns an endpoint directly when it already lies exactly on the chain.

**Why it is here.** The docstring records two bugs it fixes: without the exact-endpoint shortcut the bisection seeds with a zero distance, never sees a sign change, and drifts to the far endpoint (the silt-lens-over-sand overlap where a middle-slab edge started on the lens base corner). Bisection is robust for a piecewise-linear chain without per-segment special-casing.

.. CG-EXPLANATION-END id=function:crossChain

``function dedup``
------------------

.. CG-BLOCK id=function:dedup lines=229-244

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 229-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:dedup

**What this does.** Drops consecutive duplicate points from a ring, including a trailing point equal to the first.

**Why it is here.** Post-clip cleanup so each emitted piece is a clean simple ring with no repeated vertices.

.. CG-EXPLANATION-END id=function:dedup

``function minX``
-----------------

.. CG-BLOCK id=function:minX lines=245-248

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 245-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:minX

**What this does.** Returns the smallest x of a ring.

**Why it is here.** A small geometry helper the hole-band and cap splits use to locate a hole's extent.

.. CG-EXPLANATION-END id=function:minX

``function maxX``
-----------------

.. CG-BLOCK id=function:maxX lines=249-252

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 249-252
   :lineno-match:

.. CG-EXPLANATION-START id=function:maxX

**What this does.** Returns the largest x of a ring.

**Why it is here.** Same as ``minX``, for the opposite extreme.

.. CG-EXPLANATION-END id=function:maxX

``function minY``
-----------------

.. CG-BLOCK id=function:minY lines=253-256

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 253-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:minY

**What this does.** Returns the smallest elevation of a ring.

**Why it is here.** Used to locate the bottom of a hole's elevation band.

.. CG-EXPLANATION-END id=function:minY

``function maxY``
-----------------

.. CG-BLOCK id=function:maxY lines=257-265

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 257-265
   :lineno-match:

.. CG-EXPLANATION-START id=function:maxY

**What this does.** Returns the largest elevation of a ring.

**Why it is here.** Used to locate the top of a hole's elevation band.

.. CG-EXPLANATION-END id=function:maxY

``function clipToStrip``
------------------------

.. CG-BLOCK id=function:clipToStrip lines=266-275

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 266-275
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipToStrip

**What this does.** Clips a polygon to the vertical strip between two x lines, treating an infinite bound as a no-op so the annulus caps can clip on one line only.

**Why it is here.** It is the vertical clip the slicer uses to cut a face to a gap strip and the annulus code uses to carve the left and right caps.

.. CG-EXPLANATION-END id=function:clipToStrip

``function clipHalfPlane``
--------------------------

.. CG-BLOCK id=function:clipHalfPlane lines=276-301

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 276-301
   :lineno-match:

.. CG-EXPLANATION-START id=function:clipHalfPlane

**What this does.** Clips a polygon against a single axis-aligned line — vertical or horizontal — keeping whichever side a supplied test approves, and interpolating the crossings.

**Why it is here.** It is the one Sutherland-Hodgman primitive every strip and band clip in the module is built from.

.. CG-EXPLANATION-END id=function:clipHalfPlane

``function intersectX``
-----------------------

.. CG-BLOCK id=function:intersectX lines=302-309

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 302-309
   :lineno-match:

.. CG-EXPLANATION-START id=function:intersectX

**What this does.** Returns the point where a segment crosses a given vertical line.

**Why it is here.** The vertical half-plane clip needs the exact crossing point on that line.

.. CG-EXPLANATION-END id=function:intersectX

``function intersectY``
-----------------------

.. CG-BLOCK id=function:intersectY lines=310-315

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/sliceAnnulus.ts
   :language: typescript
   :lines: 310-315
   :lineno-match:

.. CG-EXPLANATION-START id=function:intersectY

**What this does.** Returns the point where a segment crosses a given horizontal line.

**Why it is here.** The horizontal half-plane clip needs the exact crossing point on that line.

.. CG-EXPLANATION-END id=function:intersectY

