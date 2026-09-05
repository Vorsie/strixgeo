desktop.renderer.src.utils.partitionFillV2.emitTerminationSweep
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts
   :language: typescript
   :lines: 1-65
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is the hoist: the one unconditional pass that draws every unit's termination. It walks column by column, and for each picked unit asks its 2/1/0 count on each side (0 lens, 1 onlap, 2 band) and draws it, so emission is unconditional and cannot be silently suppressed by whichever tiler owned the space. This is the classify-and-iterate half; the actual drawing lives in the companion draw module.

**Why it is here.** The docstring records the problem it solves (owner: if my 2/1/0 rule is hardcoded these wouldn't have happened — classification was correct but emission was not, because every tiler carried guards that could suppress a termination). It cites ruling 8k (columns are ground truth, iterate columns not gaps), ruling 8j (merge after fill, no termination suppressed by a predicted merge), and ruling 8i (the three-function classify/draw spec). The sweep keeps only the rule-derived and physical suppressions (bridge-anchored, sub-TD deferral, sub-snap).

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=66-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts
   :language: typescript
   :lines: 66-95
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere. The block also carries the note that the old sub-snap-width policy threshold is deleted.

**Why it is here.** The comment cites ruling 8i(e) (everything must lens, no narrow gap guard): every 0-corr side draws its lens regardless of gap width, and the only permissible collapse is the physical 1 mm snap floor, so the 0.17 m CS1 gap21 minorities now emit their tiny lenses.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function emitTerminationSweep``
---------------------------------

.. CG-BLOCK id=function:emitTerminationSweep lines=96-191

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts
   :language: typescript
   :lines: 96-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitTerminationSweep

**What this does.** The entry point. It indexes the termination plans, then runs the whole column-first sweep TWICE: once into throwaway sinks purely to learn every corr-0 lens diamond it will emit, and once for real, so an onlap flank can detour around the complete set of diamonds. The inner ``runColumnSweep`` walks each column, looking right into one gap and left into the other, calling ``emitSideSweep`` for each.

**Why it is here.** The docstring explains the two-pass plan (ruling 8t is order-dependent without it): an onlap flank detours around the diamonds collected so far, but a lens on a deeper unit is emitted after a shallower unit's onlap, so the flank never detoured around it and the two overlapped into a self-touching ring that dropped the band. Running a plan pass first learns the complete diamond set without changing emission order or any curve id.

.. CG-EXPLANATION-END id=function:emitTerminationSweep

``function emitSideSweep``
--------------------------

.. CG-BLOCK id=function:emitSideSweep lines=192-463

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts
   :language: typescript
   :lines: 192-463
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSideSweep

**What this does.** Draws the terminations for one side of one gap. It computes the per-side 2/1/0 counts and the direct tie flags, then for each unit splits a merged host into raw pieces and, per piece: skips band members; defers sub-TD units to their own pass; forces a flooded drilled unit to a lens; routes a top-band-only first unit to the watertight surface onlap; and otherwise hands the piece to the draw helper.

**Why it is here.** The docstring records ruling 8r (split a merged host so each piece classifies on its own raw contacts), ruling 8l (corr is the literal count, the hidden band promotion and the same-soil-run suppression are deleted), the safe-default repair (owner 2026-09-04: a flooded drilled unit is demoted to corr-0 so it lenses, never a forced onlap — zero ties is a lens), and ruling 8d-rev (a first unit tied only by the top band onlaps riding the surface, but a same-soil facing suppresses the redundant flank).

.. CG-EXPLANATION-END id=function:emitSideSweep

``function emitCorr0Termination``
---------------------------------

.. CG-BLOCK id=function:emitCorr0Termination lines=464-518

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminationSweep.ts
   :language: typescript
   :lines: 464-518
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitCorr0Termination

**What this does.** Draws one no-tie (corr-0) unit's lens, choosing only the geometry from the unit's position: below the facing TD it emits the bare lens closing (the substrate is the fill); a first or last unit of a multi-unit column rides the top-band or the TD-floor as a watertight boundary triangle; and an interior unit takes the interior lens diamond through the draw helper.

**Why it is here.** The docstring records ruling 8i(e) (every corr-0 side lenses unconditionally; the geometry is chosen from unit index and column extent, never from any soil comparison — the deleted flood gates compared a unit's soil to its neighbours). It records the sub-TD context parameterises which fill covers the space (the substrate) but never the emission decision, and that a hole a formerly-flooded boundary unit now exposes is a fill construction defect to repair, not a reason to re-gate.

.. CG-EXPLANATION-END id=function:emitCorr0Termination

