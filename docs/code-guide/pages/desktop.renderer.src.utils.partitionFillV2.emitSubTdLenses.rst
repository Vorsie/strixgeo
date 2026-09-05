desktop.renderer.src.utils.partitionFillV2.emitSubTdLenses
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 1-65
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws sub-TD hugging lenses: a no-tie unit that sits entirely below the facing column's drilled depth still hugs its own column with a lens on its untied side, rather than being swept away by the deep-to-deep substrate. It also draws the F5 sub-TD onlap for a one-tie unit riding a bridge tie below the facing TD. Because the substrate is the fill the lens holes into, it emits only the bare lens closing (no facing flood wedge).

**Why it is here.** The docstring cites the owner ruling of 2026-07-16 night (0 correlations, left or right, means a lens to that side, per side, unconditional, including sub-TD) and ruling 8i(e) (everything must lens): the earlier eligibility gates are deleted, and a bridge-anchored deep unit is excluded structurally because a bridge makes its contact read as tied. It cites the 2026-08-21 relocation ruling (a column that read nothing is not a boundary): below the facing TD there is no reading to meet, so the lens is measured against the first column that did read those levels.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=66-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 66-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function segmentDeg``
-----------------------

.. CG-BLOCK id=function:segmentDeg lines=69-76

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 69-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:segmentDeg

**What this does.** A yes/no helper: do a line's two endpoints round to the same 1 mm grid cell?

**Why it is here.** Written inline here to avoid a circular import back through the snap module; a zero-length line must be dropped rather than emitted.

.. CG-EXPLANATION-END id=function:segmentDeg

``function columnTD``
---------------------

.. CG-BLOCK id=function:columnTD lines=77-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 77-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnTD

**What this does.** Returns a column's own drilled depth — its deepest base elevation.

**Why it is here.** The pass needs each column's TD to decide which units of the near column lie entirely below the facing column's TD.

.. CG-EXPLANATION-END id=function:columnTD

``function emitSubTdLenses``
----------------------------

.. CG-BLOCK id=function:emitSubTdLenses lines=109-161

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 109-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSubTdLenses

**What this does.** The entry point: for every gap it emits the sub-TD lenses (and onlaps) on each side, indexing the termination plans by gap, side and unit. It sets up separate id counters for the sub-TD lens lines, the (unused-in-this-mode) flood lines, and the sub-TD onlap flanks.

**Why it is here.** The docstring records this pass owns every unit entirely below the facing TD and defers nothing to the sweep, and that the direction-blind bridge set is now vestigial because bridges feed the correlation arithmetic instead (ruling 8i(e)).

.. CG-EXPLANATION-END id=function:emitSubTdLenses

``function emitSubTdOnlap``
---------------------------

.. CG-BLOCK id=function:emitSubTdOnlap lines=162-221

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 162-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSubTdOnlap

**What this does.** Draws the F5 sub-TD onlap for a one-tie unit whose plan resolved a real bridge tie: its tied contact rides the bridge, and the free contact flank pinches to the 0.5 apex on that tie — one line, no flood wedge, because the substrate is the fill. It refuses when the apex would escape the unit's own elevation span.

**Why it is here.** The docstring records this closes the F5 hole (CS1 gap22 col23 SILT was dropped as corr not equal to 0 and rendered absent). The apex-inside-span check is a physical validity guard, not a policy: a bridge tie whose far endpoint rides a void floor above the unit's top would push the apex out of the unit and the free flank would cross a neighbouring lens (a hard partition violation).

.. CG-EXPLANATION-END id=function:emitSubTdOnlap

``function emitSideSubTd``
--------------------------

.. CG-BLOCK id=function:emitSideSubTd lines=222-298

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSubTdLenses.ts
   :language: typescript
   :lines: 222-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSideSubTd

**What this does.** Draws the sub-TD terminations for one side of one gap. For every unit it splits a merged host into its raw picked pieces, keeps only pieces below the facing TD, and for each: a no-tie piece is drawn as a lens (crossing blind columns to the first reading column, or flat to the section edge), and a one-tie piece with a plan onlaps its bridge tie.

**Why it is here.** The docstring cites ruling 8r (lines before the merge): a merged same-soil host absorbed a raw sub-piece below the facing TD, so its sub-TD lens vanished; splitting the host into raw pieces restores it. It cites the 2026-08-21 relocation ruling again (below the facing TD the facing read nothing by definition, so the lens is measured against the first column that did read those levels).

.. CG-EXPLANATION-END id=function:emitSideSubTd

