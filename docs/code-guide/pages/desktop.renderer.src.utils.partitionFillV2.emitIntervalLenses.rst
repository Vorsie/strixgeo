desktop.renderer.src.utils.partitionFillV2.emitIntervalLenses
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module handles enclosed minorities for the seam-based interval tiler: it pulls out any thin unit that is sandwiched top and bottom by one and the same enclosing soil, and it draws the closing lines that pinch such a minority to a lens apex. An enclosed minority is a unit whose neighbours above and below share one soil different from its own; it terminates at its own level as a lens (apex at 0.45 of the gap) while the enclosing soil stays continuous around it. It was split out of ``emitIntervals`` to keep each file under the 500-line budget.

**Why it is here.** The docstring records the split reason (debt #201, the 500-line file budget) and the geometry rule (the lens apex is clamped inside the matrix cell so a 0.45 apex never spills past the interval seam — the job v1 did by carving overlaps, done here by widening the cell instead).

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=22-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts
   :language: typescript
   :lines: 22-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The same one-millionth-of-a-metre slack for elevation comparisons before the 1 mm snap.

**Why it is here.** Same reason as elsewhere: floating-point noise must not read as a real elevation difference.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``interface IntervalUnit``
--------------------------

.. CG-BLOCK id=interface:IntervalUnit lines=25-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts
   :language: typescript
   :lines: 25-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:IntervalUnit

**What this does.** A type holding one untied unit clamped to an interval: the unit itself plus its top and base elevation within that interval.

**Why it is here.** The interval tiler works with a unit's span AS CLIPPED to the interval it is being tiled into, which can differ from the unit's own drilled span, so it carries the clipped elevations alongside the unit.

.. CG-EXPLANATION-END id=interface:IntervalUnit

``function extractEnclosedLenses``
----------------------------------

.. CG-BLOCK id=function:extractEnclosedLenses lines=53-178

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts
   :language: typescript
   :lines: 53-178
   :lineno-match:

.. CG-EXPLANATION-START id=function:extractEnclosedLenses

**What this does.** Walks one side's interval units and pulls out every enclosed minority into a lens list, returning the remaining matrix units with adjacent same-soil runs merged into one continuous band. A unit at position k is enclosed when the units at k-1 and k+1 share one soil that is not its own; it is pulled, the enclosing neighbours are merged across its level, and the scan repeats so an interbedded stack reduces to one matrix with several minorities pulled. A reach guard only fires the pull when the enclosing soil actually exists on the facing column.

**Why it is here.** The docstring ports v1's enclosed-lens rule and its iterative reduce. The reach guard mirrors v1's ``otherFormations.has(m)``: a minority is only a genuine lens when its enclosing matrix is a soil the facing column really carries, otherwise the apparent enclosure is a data void, not a lateral matrix. A documented blocker note records that boundary minorities (top or base of a stack) are NOT pulled here because their vacated wedge would be left an untraced hole; the whole stack is tiled instead when the residual is still multi-soil.

.. CG-EXPLANATION-END id=function:extractEnclosedLenses

``function extractLoneStackLenses``
-----------------------------------

.. CG-BLOCK id=function:extractLoneStackLenses lines=179-236

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts
   :language: typescript
   :lines: 179-236
   :lineno-match:

.. CG-EXPLANATION-START id=function:extractLoneStackLenses

**What this does.** Reduces a lone (one-sided) interbedded stack to a single continuous matrix band plus its pinching minority lenses. It is told which soil is the enclosing matrix, splits every unit into matrix or minority, pushes the minorities as lenses, and merges the matrix units into one band spanning the whole stack from its top to its base so each lens holes into it. It returns nothing when there is no matrix or no minority to separate.

**Why it is here.** The docstring records this is the increment-13 lone-multi-unit-stack path (owner CS1 repros S7 gap18 / S6 gap19 / B6 gap2 / B4|S13 gap3). The enclosing matrix is the bracket soil the caller supplies (v1's belowLith then aboveLith), NOT the thickest soil in the stack, because an interbedded stack is enclosed in whatever laterally wraps it even when a different soil is thicker inside it.

.. CG-EXPLANATION-END id=function:extractLoneStackLenses

``function emitLensClosing``
----------------------------

.. CG-BLOCK id=function:emitLensClosing lines=237-260

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitIntervalLenses.ts
   :language: typescript
   :lines: 237-260
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitLensClosing

**What this does.** Draws one enclosed minority's lens closing: two lines from the column's top and base corners to a shared apex, at a capped fraction of the gap width and the unit's own mid-elevation, so it terminates horizontally at its own level. It first tightens the apex fraction to the ruling-8b reach cap, and if either flank collapses to a single grid cell it emits neither line.

**Why it is here.** The docstring cites ruling 8b: the auto reach is additionally capped to about twice the unit's own thickness so a thin minority gets a hugging halo, not a long tongue — the cap only ever shrinks the lens, so the apex stays inside the widened matrix cell. The degenerate guard (session 10) drops both flanks in a sub-snap gap as an acceptable no-op, keeping holes and overlaps at zero (the CS1 col21/col22 0.17 m gap).

.. CG-EXPLANATION-END id=function:emitLensClosing

