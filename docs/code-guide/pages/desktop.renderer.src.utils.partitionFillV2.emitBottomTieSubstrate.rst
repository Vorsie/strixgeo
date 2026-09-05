desktop.renderer.src.utils.partitionFillV2.emitBottomTieSubstrate
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts
   :language: typescript
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file fills the wedge below a shallow column's TD down to a FLAT deep-to-deep floor. Where a base-tie correlation reaches below a shallow TD, it emits a horizontal floor curve across the gap and a vertical curtain on each column from that column's deepest anchor down to the floor, so the deep band's base is flat rather than sloping and leaves no triangular void.

**Why it is here.** The docstring explains the v1 ``computeBottomTieLine`` semantics this reproduces, and why the curtain starts at the deepest anchor (the lower of the column's TD and any deep bridge line through it) rather than the shallow TD: an intervening shallow column of a bridged run has the bridge band filling its deep space, so starting at the shallow TD would slice the multi-gap bridge band (a measured regression). A strip with no bracket stays empty (owner section 8 question 3). Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=47-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts
   :language: typescript
   :lines: 47-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A 1 mm tolerance below which a contact is treated as already anchored.

**Why it is here.** The floor and curtain no-op when a column already anchors that deep, within this tolerance.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function emitBottomTieSubstrate``
-----------------------------------

.. CG-BLOCK id=function:emitBottomTieSubstrate lines=64-147

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts
   :language: typescript
   :lines: 64-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitBottomTieSubstrate

**What this does.** The public pass: it reconstructs the depth-based column shape ``computeBottomTieLine`` expects, computes the bottom-tie floor from the base-base ties, and for each gap whose floor sits below the deepest fill emits a flat floor curve plus a curtain on each column -- each curve carrying an explicit bottom-tie soil label.

**Why it is here.** The docstring explains the floor is the deeper of the two columns' bottom-tie values (v1's deepest-bridge flattening) taken no higher than the two columns' deepest anchors (so a sloping bridge line never crosses the floor and splits the face), and the label is the deeper endpoint's soil, so the sub-TD wedge is stamped with the tie formation rather than the shallow column's deepest unit. A gap with no bracket on either side stays empty (owner section 8 question 3).

.. CG-EXPLANATION-END id=function:emitBottomTieSubstrate

``function deepestAnchorPerColumn``
-----------------------------------

.. CG-BLOCK id=function:deepestAnchorPerColumn lines=148-178

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts
   :language: typescript
   :lines: 148-178
   :lineno-match:

.. CG-EXPLANATION-START id=function:deepestAnchorPerColumn

**What this does.** Returns, per column, the deepest elevation any deep-to-deep bridge line reaches there, by sampling each jump-tie's straight line at every intervening column; infinity where no bridge reaches.

**Why it is here.** The curtain starts at the lower of the column's TD and this bridge reach, so it stays below a bridge band on an intervening column and never slices it.

.. CG-EXPLANATION-END id=function:deepestAnchorPerColumn

``function deepestBase``
------------------------

.. CG-BLOCK id=function:deepestBase lines=179-188

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts
   :language: typescript
   :lines: 179-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:deepestBase

**What this does.** Returns a column's deepest base -- its TD.

**Why it is here.** One half of the deepest anchor the curtain starts from.

.. CG-EXPLANATION-END id=function:deepestBase

``function emitCurtain``
------------------------

.. CG-BLOCK id=function:emitCurtain lines=189-210

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitBottomTieSubstrate.ts
   :language: typescript
   :lines: 189-210
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitCurtain

**What this does.** Emits one vertical curtain curve from a column's deepest anchor down to the flat floor, with the bottom-tie label; a no-op when the anchor already sits at or below the floor.

**Why it is here.** The curtain is the vertical that closes the sub-TD wedge on a column that has no footprint edge of its own that deep.

.. CG-EXPLANATION-END id=function:emitCurtain

