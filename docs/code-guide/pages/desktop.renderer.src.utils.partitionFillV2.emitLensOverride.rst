desktop.renderer.src.utils.partitionFillV2.emitLensOverride
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitLensOverride.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitLensOverride.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLensOverride.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module lets the engineer reshape a no-tie (corr-0) lens tip that the sweep drew, by dragging its grab handle. When the section carries a saved apex override for the lens's body-and-gap key, the apex moves to the drawn fraction and elevation, and the flanks and flood wedge re-close around it so the partition stays gap- and overlap-free. A lens takes both a fraction (its reach) and an elevation (unlike an onlap tip, whose elevation rides its tie), and the fraction is clamped so the tip never reaches or crosses the far column.

**Why it is here.** The docstring records owner ruling of 2026-07-22 (the third engine grant, make every handle reshape): the sweep-drawn corr-0 lens tips had a dead grab handle because they read no override, so this gives them the same override consumption the enclosed lens already had. An overridden apex passes uncapped by the 8b reach cap because it is the engineer's explicit reach.

.. CG-EXPLANATION-END id=module-header

``interface SweepLensOverrideApex``
-----------------------------------

.. CG-BLOCK id=interface:SweepLensOverrideApex lines=32-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLensOverride.ts
   :language: typescript
   :lines: 32-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SweepLensOverrideApex

**What this does.** A type holding a resolved overridden lens apex: its x and elevation, plus the fraction measured from the emitting column toward the facing column.

**Why it is here.** The caller needs both the placed point (for the flanks) and the fraction (to drive the flood wedge apex), so both are returned together.

.. CG-EXPLANATION-END id=interface:SweepLensOverrideApex

``function sweepLensOverrideApex``
----------------------------------

.. CG-BLOCK id=function:sweepLensOverrideApex lines=60-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLensOverride.ts
   :language: typescript
   :lines: 60-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:sweepLensOverrideApex

**What this does.** Resolves a sweep lens's overridden apex, or returns nothing when no override applies. It looks up the per-body-per-gap override, then converts the gap-local fraction (0 at the left column, 1 at the right) into a fraction measured from whichever column is emitting the lens — used directly for a left-column emit, mirrored for a right-column emit.

**Why it is here.** The docstring explains the sweep's emitting column may be on either side of the gap, so the stored gap-local fraction must be converted to a from-the-emitting-column fraction for the placement formula to put the apex on the correct side.

.. CG-EXPLANATION-END id=function:sweepLensOverrideApex

``function emitOverriddenLensClosing``
--------------------------------------

.. CG-BLOCK id=function:emitOverriddenLensClosing lines=101-121

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLensOverride.ts
   :language: typescript
   :lines: 101-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitOverriddenLensClosing

**What this does.** Draws the two closing flanks of an overridden lens (top to apex, apex to base) directly at the moved apex, records each flank's colour label, and returns whether both were drawn. It emits neither flank when the moved apex collapses a flank to a single grid cell.

**Why it is here.** The docstring notes it bypasses the 8b reach cap because an overridden apex is the engineer's explicit reach, and its degenerate guard mirrors the default lens closing so a sub-snap apex is a clean no-op the enclosing fill covers, keeping holes and overlaps at zero.

.. CG-EXPLANATION-END id=function:emitOverriddenLensClosing

