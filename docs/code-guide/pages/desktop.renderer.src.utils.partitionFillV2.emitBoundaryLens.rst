desktop.renderer.src.utils.partitionFillV2.emitBoundaryLens
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts
   :language: typescript
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file emits a WATERTIGHT lens for a zero-tie minority that sits at a column boundary -- the first unit (whose top is the top-band line) or the last unit (whose base is the TD floor). Instead of the interior lens shape (which left a growing sliver hole against the boundary polyline), it draws a triangle against a KNOWN line: the unit's column vertical, one free-contact flank to the apex, and the boundary polyline itself as the tied leg. There is no separate flood wedge -- the enclosing flood already fills the width and the free flank simply carves the lens hole out of it.

**Why it is here.** The docstring records the owner directive (2026-07-17: lensing needs to be watertight by design) and the measured failure of the interior lens here (65 extra holes), and the trapezoid-slab lesson: every leg must lie on existing line art or meet another emitted leg exactly. Ruling 8q means the tied leg is also emitted as a real lens-family curve coincident with the polyline (the paint tool paints on line art), which the arrangement unions with no topology change. Pure module.

.. CG-EXPLANATION-END id=module-header

``const APEX_MARGIN``
---------------------

.. CG-BLOCK id=const:APEX_MARGIN lines=65-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts
   :language: typescript
   :lines: 65-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:APEX_MARGIN

**What this does.** A 1 mm margin so the apex sits strictly off the free contact corner.

**Why it is here.** A zero-height flank would collapse the lens into the enclosing fill; the reach halves until the apex clears this margin.

.. CG-EXPLANATION-END id=const:APEX_MARGIN

``const MIN_REACH_FRACTION``
----------------------------

.. CG-BLOCK id=const:MIN_REACH_FRACTION lines=68-104

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts
   :language: typescript
   :lines: 68-104
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_REACH_FRACTION

**What this does.** The reach floor (one-thousandth of the gap) below which the lens degenerates to a no-op.

**Why it is here.** Below it the flank is smaller than the snap grid and cannot bound a face.

.. CG-EXPLANATION-END id=const:MIN_REACH_FRACTION

``function emitBoundaryLens``
-----------------------------

.. CG-BLOCK id=function:emitBoundaryLens lines=105-230

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts
   :language: typescript
   :lines: 105-230
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitBoundaryLens

**What this does.** Emits the watertight boundary lens: it picks the boundary polyline (the top band for a surface first unit, the flat TD floor for a TD last unit) and the free contact, finds an apex on that polyline that clears the free corner (using a free-draw override reach, else the 0.45 reach halved on conflict), draws the free flank, and emits the tied leg coincident with the polyline; it returns whether it drew anything.

**Why it is here.** The docstring carries ruling 8i(e) (everything must lens -- the facing-matrix reach guard is deleted, only physical suppression remains), ruling 8b (reach halving on a tie conflict), and ruling 8q (the tied leg is emitted as real lens-family art coincident with the polyline, so the paint bucket sees a closed lens; unioned by the arrangement with no topology change).

.. CG-EXPLANATION-END id=function:emitBoundaryLens

``function emitSurfaceOnlapFlank``
----------------------------------

.. CG-BLOCK id=function:emitSurfaceOnlapFlank lines=231-284

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBoundaryLens.ts
   :language: typescript
   :lines: 231-284
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSurfaceOnlapFlank

**What this does.** Emits a watertight surface ONLAP for a first unit tied only by the top band: the same triangle as the surface lens but with the onlap convention -- the tip at fraction 0.5 (not the halved lens reach) riding the top band, a phase-2 ``oflank`` flank, and a flood wedge filling the width past the tip.

**Why it is here.** The docstring is ruling 8d-rev (the top band counts as one correlation, so such a first unit is corr-1 and onlaps), and explains the mid-gap tip needs a flood wedge here (unlike the small-reach lens the enclosing flood covered on its own) or a 2 m sliver hole appears at CS1 gap 7.

.. CG-EXPLANATION-END id=function:emitSurfaceOnlapFlank

