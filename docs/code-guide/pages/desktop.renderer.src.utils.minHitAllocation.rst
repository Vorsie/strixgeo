desktop.renderer.src.utils.minHitAllocation
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/minHitAllocation.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/minHitAllocation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/minHitAllocation.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. This file works out how a thin band in a stack can borrow invisible click space from its fatter neighbours (debt #158), so a hard-to-hit sliver becomes comfortable to click without changing what is drawn.

**Why it is here.** The comment records the motivation: a thin band's clickable area is just its visual rectangle, which at real zoom can be a few pixels, and the owner mis-clicked one band low twice in a week. The fix is not to enlarge the visible band but to let it extend an invisible capture strip into a neighbour's slack — the room the neighbour has above its own minimum. It is a pure module with no reading, writing, or screen state, and the caller paints the returned expansions as invisible strips on top of the visible bands so a fat band's own surface is untouched except for the donated sliver.

.. CG-EXPLANATION-END id=module-header

``interface BandExtent``
------------------------

.. CG-BLOCK id=interface:BandExtent lines=17-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/minHitAllocation.ts
   :language: typescript
   :lines: 17-22
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandExtent

**What this does.** One band's vertical extent on screen, in pixels, from top down to bottom.

**Why it is here.** It is the input describing where each band sits so the allocation can measure heights and neighbours.

.. CG-EXPLANATION-END id=interface:BandExtent

``interface HitExpansion``
--------------------------

.. CG-BLOCK id=interface:HitExpansion lines=23-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/minHitAllocation.ts
   :language: typescript
   :lines: 23-64
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HitExpansion

**What this does.** How far a band's clickable surface may reach beyond its visual rectangle: extra capture above and extra capture below.

**Why it is here.** It is the output the caller uses to draw the invisible capture strips.

.. CG-EXPLANATION-END id=interface:HitExpansion

``function allocateMinHitExpansions``
-------------------------------------

.. CG-BLOCK id=function:allocateMinHitExpansions lines=65-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/minHitAllocation.ts
   :language: typescript
   :lines: 65-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:allocateMinHitExpansions

**What this does.** Works out the hit-target expansion for each band in an ordered stack. A band already at or above the comfortable minimum gets none. A thin band asks each side for half of what it lacks; each neighbour donates at most its own slack per side and never drops below the minimum itself, and a neighbour that is itself thin donates nothing. The top of the first band and the bottom of the last are hard walls.

**Why it is here.** The docstring records the rules in the order they bind and the reasons: growing an already-comfortable band would shadow its neighbours for nothing; two adjacent thin bands keep their shared visual boundary because there is no honest way to favour one over the other; and a side with no slack contributes nothing while the other side does not over-compensate, since over-borrowing from one side would pull the strip's centre off the band it belongs to. It also records that gaps between bands are allowed (the contacts layer feeds stacks split around a pending-ghost hole) and that what keeps a strip from interfering inside such a hole is the hard donation cap plus the ghost overlays winning the click by drawing later, not the gap being small.

.. CG-EXPLANATION-END id=function:allocateMinHitExpansions

