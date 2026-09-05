desktop.renderer.src.utils.partitionFillV2.emitFloodWedge
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws the flood-closure wedge: the triangle of soil that fills the space PAST a termination apex, out toward the facing column. When a unit pinches to an apex inside a gap, the ground between that apex and the facing column belongs to the facing column's enclosing soil; this wedge is the two triangles that close that space. Those triangles touch the terminating column only at corner points, never along its full edge, so the tile they trace carries no column edge — and a face with no column edge is coloured from the ``flood`` label (the enclosing soil) as a band.

**Why it is here.** The docstring cites owner ruling 8f (fill the void with the dominant lithology between correlations) and explains the enclosing soil is read INSIDE the tie-bounded channel the space belongs to, so a steep tie cannot import a colour from the far side of a correlation the engineer drew. It also describes the session-16 sloping ride (letting the wedge's outer leg follow a dipping band edge), which is built but gated off below.

.. CG-EXPLANATION-END id=module-header

``const SLOPE_EPS``
-------------------

.. CG-BLOCK id=const:SLOPE_EPS lines=38-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 38-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:SLOPE_EPS

**What this does.** A tiny constant in metres: a band edge steeper than this across the wedge triggers the sloping-ride path.

**Why it is here.** Below this slope the edge is effectively flat and the straight wedge leg already fits, so the ride is only attempted where the slope is real.

.. CG-EXPLANATION-END id=const:SLOPE_EPS

``const SLOPING_RIDE_ENABLED``
------------------------------

.. CG-BLOCK id=const:SLOPING_RIDE_ENABLED lines=54-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 54-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:SLOPING_RIDE_ENABLED

**What this does.** A kill-switch constant, set to false, that turns the multi-segment sloping ride OFF.

**Why it is here.** The docstring records the ride was built and measured negative: inserting a mid-vertex into the wedge flank produced a self-crossing shape and exploded the test battery to 509 holes. Per owner process ruling 7 (no partial fixes and no new leaks) the plain straight wedge ships and the ride stays gated off until its geometry is made simple.

.. CG-EXPLANATION-END id=const:SLOPING_RIDE_ENABLED

``const NEUTRALISE_TIE_CLAMP``
------------------------------

.. CG-BLOCK id=const:NEUTRALISE_TIE_CLAMP lines=57-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 57-87
   :lineno-match:

.. CG-EXPLANATION-START id=const:NEUTRALISE_TIE_CLAMP

**What this does.** A test-only switch, set to false, that when flipped on disables the ruling-8n tie clamp so a red-first test can prove the clamp is doing work.

**Why it is here.** The comment records it exists to prove the 8n tie clamp goes RED when removed; it ships false so the clamp is always active in the real app.

.. CG-EXPLANATION-END id=const:NEUTRALISE_TIE_CLAMP

``function emitFloodWedge``
---------------------------

.. CG-BLOCK id=function:emitFloodWedge lines=88-241

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 88-241
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitFloodWedge

**What this does.** Emits the flood wedge for one termination. It picks the colour label for the wedge (the facing enclosing soil, read inside the tie-bounded channel, or for a lens the wrap soil read from the lens's own column), works out the convergence point on the facing column and the shared apex, and pushes the two flank lines (corner to conv) plus the single shared conv-to-apex line. For a lens it clamps that convergence point onto the matrix side of every gap tie so the wrap never crosses a correlation.

**Why it is here.** The comments cite three owner rulings. Ruling 8n (2026-07-18, stay inside the lines): for an onlap the flood fills only the untied side and reads the colour at the flooded contact, not the mid-elevation, because the mid would land on the wrong facing unit. Ruling 8n(b) (2026-07-18, x=646.74): a lens pinches inside its OWN enclosing matrix, so the wrap colour comes from the lens's own column, never from the far facing column 78 m away. Ruling 8g/8q (2026-07-19, the matrix detours around the wedge): the convergence sits AT the lens apex so the flood flanks coincide with the lens flanks and the band face owns the space past the apex hole-free.

.. CG-EXPLANATION-END id=function:emitFloodWedge

``function nearMatrixAt``
-------------------------

.. CG-BLOCK id=function:nearMatrixAt lines=242-256

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 242-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearMatrixAt

**What this does.** Returns the terminating column's own soil just beyond the unit on the flooded side — used only as a last-resort colour when the facing column has nothing at all in the tie-bounded channel.

**Why it is here.** The docstring notes that now the lookup is confined to the channel, an empty facing channel is a real signal rather than an impossibility; the ground still has to belong to somebody, and reading the terminating column at its own contact crosses no correlation by construction.

.. CG-EXPLANATION-END id=function:nearMatrixAt

``function floodedNeighbourElev``
---------------------------------

.. CG-BLOCK id=function:floodedNeighbourElev lines=257-275

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 257-275
   :lineno-match:

.. CG-EXPLANATION-START id=function:floodedNeighbourElev

**What this does.** Returns the elevation just beyond the terminating unit on whichever side is being flooded — a hair below the base for a top-closed onlap, a hair above the top for a base-closed onlap, or the mid-elevation for a lens (which floods on both sides).

**Why it is here.** The near-column fallback in ``nearMatrixAt`` needs the exact elevation just outside the unit to sample the right neighbour soil; the ``skipSide`` names the closed side, so the flood is on the other one.

.. CG-EXPLANATION-END id=function:floodedNeighbourElev

``function clampConvToTies``
----------------------------

.. CG-BLOCK id=function:clampConvToTies lines=276-303

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 276-303
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampConvToTies

**What this does.** For a lens wrap wedge, nudges the shared convergence point onto the enclosing-matrix side of every gap tie the straight flanks would cross: a tie that ends up below the base flank raises the point onto it, a tie above the top flank lowers it.

**Why it is here.** The docstring cites ruling 8n: a gap tie is drawn line art, and the wrap flood may not cross it because the space on the far side is owned by the tied fill (CS1 gap18, the KLEI wrap of the VEEN lens dipping below the rising ZAND-top tie). Clamping the point keeps the wrap on the matrix side.

.. CG-EXPLANATION-END id=function:clampConvToTies

``function rideFlankToTie``
---------------------------

.. CG-BLOCK id=function:rideFlankToTie lines=304-346

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 304-346
   :lineno-match:

.. CG-EXPLANATION-START id=function:rideFlankToTie

**What this does.** Returns a lens wrap flank as a short polyline: normally just corner to conv, but when a gap tie crosses the straight chord on the forbidden side it inserts the crossing point so the flank rides onto the tie there and then runs to the (already clamped) convergence point.

**Why it is here.** The docstring notes the ride vertex sits on the tie, which is a real arrangement line, so the wrap face and the tied fill share the boundary exactly and no gap opens between them.

.. CG-EXPLANATION-END id=function:rideFlankToTie

``function ridePolyline``
-------------------------

.. CG-BLOCK id=function:ridePolyline lines=347-382

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 347-382
   :lineno-match:

.. CG-EXPLANATION-START id=function:ridePolyline

**What this does.** The corner-to-conv leg written as a polyline that follows the facing enclosing soil's own dipping contour rather than a straight chord that would leave the enclosure; on a flat contour it collapses to the straight two-point leg.

**Why it is here.** The docstring records this is the session-16 fix for the CS2 g17 triangular hole where a straight chord exits a dipping band base — but it returns the straight leg immediately because ``SLOPING_RIDE_ENABLED`` is false (the ride self-crosses; see that kill-switch).

.. CG-EXPLANATION-END id=function:ridePolyline

``function enclosingBoundElev``
-------------------------------

.. CG-BLOCK id=function:enclosingBoundElev lines=383-403

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 383-403
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosingBoundElev

**What this does.** Returns the facing enclosing soil's own top or base contour elevation nearest a given elevation, or nothing when the facing column carries no unit of that soil.

**Why it is here.** The sloping ride needs to know where the facing enclosing soil's bounding contour sits so it can ride that line; a null means there is no sloping bracket to ride and the straight leg is kept.

.. CG-EXPLANATION-END id=function:enclosingBoundElev

``function segmentDeg``
-----------------------

.. CG-BLOCK id=function:segmentDeg lines=404-409

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitFloodWedge.ts
   :language: typescript
   :lines: 404-409
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentDeg

**What this does.** A yes/no helper: do a line's two endpoints round to the same 1 mm grid cell (a zero-length line)?

**Why it is here.** Written inline here to avoid a circular import back through the snap module; a zero-length line must be dropped rather than emitted because it cannot bound a face.

.. CG-EXPLANATION-END id=function:segmentDeg

