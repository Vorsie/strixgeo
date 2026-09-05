desktop.renderer.src.utils.lithoBoundaryHelpers
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the one import. This file holds pure helpers — functions whose answers depend only on their inputs, with no side effects — for working out the allowed range of a litho-suggestion boundary while the user drags it. It imports only the suggestion data shape.

**Why it is here.** The comment records that these were extracted out of the ghost-columns render component so the drag hook (and a shared bound walker) can import the maths without dragging the whole render component along. Because every export is pure — no React, no reading or writing, no shared module state — the maths has a small, tight unit-test surface and the hook can call it inside a useEffect without the dependency list constantly changing.

.. CG-EXPLANATION-END id=module-header

``const ZERO_THICKNESS_M``
--------------------------

.. CG-BLOCK id=const:ZERO_THICKNESS_M lines=31-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 31-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:ZERO_THICKNESS_M

**What this does.** A tolerance of one millimetre. Any pending layer thinner than this is treated as if it had been rejected by all the boundary walkers below.

**Why it is here.** The comment records the trap it guards against: dragging a layer's top down onto its base commits a depth edit but does NOT mark that layer rejected, so it lingers as a paper-thin entry sitting exactly on the shared boundary and would otherwise lock the next layer's drag at that spot. The real fix is auto-rejecting on release in the drag hook; folding these zero-thickness layers into the rejected set here is the safety net. One millimetre absorbs rounding error without catching a genuinely thin layer.

.. CG-EXPLANATION-END id=const:ZERO_THICKNESS_M

``function effectiveDepths``
----------------------------

.. CG-BLOCK id=function:effectiveDepths lines=38-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 38-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveDepths

**What this does.** Returns the current top and base depths of one suggestion, preferring a committed edit for that layer over the raw value the segmenter first produced.

**Why it is here.** The docstring records that committed edits must win over the raw segmenter output so that drag bounds are computed from the live state of the neighbouring layers, not their stale first guess (debt #83).

.. CG-EXPLANATION-END id=function:effectiveDepths

``function nearestVisibleIndexAbove``
-------------------------------------

.. CG-BLOCK id=function:nearestVisibleIndexAbove lines=66-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 66-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearestVisibleIndexAbove

**What this does.** Scans upward from a given layer for the nearest layer that has not been rejected, and returns its position (or nothing if there is none).

**Why it is here.** The docstring records that only rejected layers are skipped because they are visually gone; both pending and accepted layers are returned, and the caller decides for itself how to treat an accepted neighbour.

.. CG-EXPLANATION-END id=function:nearestVisibleIndexAbove

``function nearestVisibleIndexBelow``
-------------------------------------

.. CG-BLOCK id=function:nearestVisibleIndexBelow lines=77-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 77-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearestVisibleIndexBelow

**What this does.** The same scan as the one above, but looking downward and stopping at the total number of layers.

**Why it is here.** The docstring records that it is simply the mirror of the upward scan for the other direction.

.. CG-EXPLANATION-END id=function:nearestVisibleIndexBelow

``interface VisibleNeighbour``
------------------------------

.. CG-BLOCK id=interface:VisibleNeighbour lines=103-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 103-108
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VisibleNeighbour

**What this does.** A record describing the first visible neighbour found in one direction: its position, whether it is a pending or an accepted layer, and whether a rejected layer had to be crossed to reach it.

**Why it is here.** The docstring records the four clamp cases this feeds — an immediately adjacent pending layer, a pending layer reached across a rejected gap, an accepted layer, and no visible neighbour at all (the outer ground above, or the deepest base below).

.. CG-EXPLANATION-END id=interface:VisibleNeighbour

``function findVisibleNeighbourAbove``
--------------------------------------

.. CG-BLOCK id=function:findVisibleNeighbourAbove lines=109-128

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 109-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:findVisibleNeighbourAbove

**What this does.** Scans upward skipping rejected layers (remembering that it crossed one), and returns the first visible layer as a neighbour record marked pending or accepted; nothing if there is none.

**Why it is here.** The docstring records that this identifies the neighbour the drag clamp uses, and that its pending-or-accepted kind decides how the clamp behaves.

.. CG-EXPLANATION-END id=function:findVisibleNeighbourAbove

``function findVisibleNeighbourBelow``
--------------------------------------

.. CG-BLOCK id=function:findVisibleNeighbourBelow lines=129-155

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 129-155
   :lineno-match:

.. CG-EXPLANATION-START id=function:findVisibleNeighbourBelow

**What this does.** The mirror of the upward search, scanning downward within the total layer count.

**Why it is here.** The docstring records that it is the same logic for the opposite direction.

.. CG-EXPLANATION-END id=function:findVisibleNeighbourBelow

``interface NeighbourBound``
----------------------------

.. CG-BLOCK id=interface:NeighbourBound lines=156-163

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 156-163
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NeighbourBound

**What this does.** The result of one neighbour walk: the depth the dragged edge is allowed to reach, and — when it applies — the neighbour to auto-reject if the drag is released exactly at that depth.

**Why it is here.** The docstring records that the auto-reject is what restores the gesture of dragging a bottom layer up to merge it into the layer above; the auto-reject index is left empty for an outer edge, an accepted barrier, a gap-fill, or a self-collapse.

.. CG-EXPLANATION-END id=interface:NeighbourBound

``function boundFromNeighbour``
-------------------------------

.. CG-BLOCK id=function:boundFromNeighbour lines=164-211

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 164-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:boundFromNeighbour

**What this does.** Turns a visible neighbour (or the absence of one) into a clamp bound and an auto-reject target. With no neighbour it returns the outer-edge fallback and no auto-reject; with a neighbour it clamps at that neighbour's far edge and marks it for auto-reject only when the neighbour is pending.

**Why it is here.** The comments record two owner directives. The 2026-05-31 directive removed a special case for drags that crossed a rejected layer: because rejected layers are visually gone, the user expects the drag to pass straight through them, so the code now falls through to the ordinary far-edge clamp. The 2026-05-30 "drag at any stage" directive means an accepted neighbour is no longer a hard barrier either — the drag crosses its territory like a pending one — but an accepted neighbour gets no auto-reject, because auto-rejecting a committed contact would be wrong; a later slice routes that case to a contact-depth update instead, and until then a drag snapping at an accepted neighbour leaves a deliberate, temporary visual mismatch.

.. CG-EXPLANATION-END id=function:boundFromNeighbour

``interface DragBoundsResult``
------------------------------

.. CG-BLOCK id=interface:DragBoundsResult lines=212-231

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 212-231
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DragBoundsResult

**What this does.** The bounds handed back when a drag begins: the depths above and below that the dragged edge may not cross, plus two lists of pending layers to auto-reject if the drag snaps at the upper or lower bound.

**Why it is here.** The docstring records that after the kill-cascade refactor of 2026-05-23 each of those lists only ever holds the dragged layer's own index — the self-collapse case (#81) where an edge is dragged onto its own opposite edge.

.. CG-EXPLANATION-END id=interface:DragBoundsResult

``function computeDragBounds``
------------------------------

.. CG-BLOCK id=function:computeDragBounds lines=232-290

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoBoundaryHelpers.ts
   :language: typescript
   :lines: 232-290
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeDragBounds

**What this does.** Works out the hard limits and collapse targets for a drag on one edge at the moment the mouse goes down. For a top-edge drag it walks to the neighbour above (falling back to depth zero, the ground) and clamps the upper limit at that neighbour's far edge, the lower limit at the layer's own base. For a base-edge drag it walks to the neighbour below (falling back to the deepest suggestion's base) and clamps the lower limit at that neighbour's far edge, the upper limit at the layer's own top. It then fills the collapse lists from the auto-reject target.

**Why it is here.** The comments record the edge conventions and one deliberate consequence: for the downward walk the outer fallback is the last suggestion's base, which equals the layer's own base when the dragged layer IS the last one, so the edge cannot be dragged below the bottom of the investigation — "can't drag past the test bottom". Releasing at a layer's own opposite edge with snap auto-rejects that layer, which is the self-collapse gesture (#81).

.. CG-EXPLANATION-END id=function:computeDragBounds

