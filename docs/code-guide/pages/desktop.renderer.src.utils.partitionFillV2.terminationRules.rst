desktop.renderer.src.utils.partitionFillV2.terminationRules
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/terminationRules.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/terminationRules.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationRules.ts
   :language: typescript
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module holds the shared ruled-exception predicates for the termination sweep: the only cases where a unit that otherwise would draw a boundary line takes NO termination because it legitimately merges into its own soil's band. It imports the gap-band type.

**Why it is here.** The sweep emits a termination for every 0-corr and 1-corr unit unconditionally; the only ruled suppressions are the owner's merge rulings 8e and 8g(b). The docstring stresses these are DERIVED FROM THE RULES (the gap bands plus the facing stack), not a tiler-local heuristic — they are the SAME predicates the conformance gate re-exports, so the engine suppresses exactly the terminations the gate accepts as a band. Pure module.

.. CG-EXPLANATION-END id=module-header

``function sameFormationEnclosedByTiedBand``
--------------------------------------------

.. CG-BLOCK id=function:sameFormationEnclosedByTiedBand lines=50-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationRules.ts
   :language: typescript
   :lines: 50-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:sameFormationEnclosedByTiedBand

**What this does.** Returns whether a unit's soil carries a matched-pair band across the gap — a drawn or derived same-side same-soil tie between the two facing units.

**Why it is here.** Ruling 8e (same-formation enclosure conforms, "it should be one sand"): a unit enclosed by its own soil's legitimately-tied band is ONE body and takes no separate termination. The negative guard (ruling 8): with no band of that soil in the gap, two untied same-soil units are opposing lenses (the retired auto-match), so it returns false and the unit terminates.

.. CG-EXPLANATION-END id=function:sameFormationEnclosedByTiedBand

``function sameFormationBaseTiedPair``
--------------------------------------

.. CG-BLOCK id=function:sameFormationBaseTiedPair lines=88-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/terminationRules.ts
   :language: typescript
   :lines: 88-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:sameFormationBaseTiedPair

**What this does.** Returns whether a purely base-tied unit (top untied) faces a same-soil run on the other column that vertically overlaps its own elevation band.

**Why it is here.** Ruling 8g(b) (base-tied same-formation pairs are one band, "with or without the extra sand-top tie the sands connect"): such a unit connects into one band through the shared base tie, so its expected render is a band and the sweep suppresses its onlap. The docstring distinguishes this ASYMMETRIC case (each unit rides a different tie) from the symmetric matched pair the other predicate covers.

.. CG-EXPLANATION-END id=function:sameFormationBaseTiedPair

