desktop.renderer.src.utils.partitionFillV2.emitTerminations
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitTerminations.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitTerminations.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminations.ts
   :language: typescript
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This small module carries the shared decision the two-sided and boundary-onlap termination emission needs, kept out of the already-large lone-pinch file.

**Why it is here.** The docstring cites ruling 8c (every unit terminates by its own 2/1/0 count) and the 500-line file budget (debt #201) as the reason to hold this decision in its own module.

.. CG-EXPLANATION-END id=module-header

``function chooseOnlapEnclosing``
---------------------------------

.. CG-BLOCK id=function:chooseOnlapEnclosing lines=52-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitTerminations.ts
   :language: typescript
   :lines: 52-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:chooseOnlapEnclosing

**What this does.** Chooses which enclosing soil floods the wedge past an onlap tip: normally the soil on the untied side, but when that soil is the onlapping unit's OWN soil it returns the tied-band-side soil instead (which is guaranteed different, because the bracket is mixed).

**Why it is here.** The docstring cites ruling 8a generalised to same-soil enclosure (ruling 8c): flooding a same-soil untied enclosing would re-merge the onlap into one full-width face (the 1corr-not-onlap leak and the retired auto-match), so the opposite, guaranteed-different neighbour is flooded so the onlap reads as a true termination and does not span the gap.

.. CG-EXPLANATION-END id=function:chooseOnlapEnclosing

