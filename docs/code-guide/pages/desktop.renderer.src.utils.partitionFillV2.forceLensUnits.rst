desktop.renderer.src.utils.partitionFillV2.forceLensUnits
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is the safe-default repair channel. After one fill pass, a drilled unit's own column edge must show that unit's own soil; but a combination of suppressions could leave a drilled unit unbounded so the enclosing fill painted it a foreign soil — hidden data loss the holes gate cannot see. The fix: run the fill once, find every such flooded unit, and re-run with those units forced to a lens (their 2/1/0 count demoted to 0). Clean sections lose nothing, so they never re-run and the default is completely preserved.

**Why it is here.** The docstring cites the owner ruling of 2026-09-04 (on the packaged build, a SAND at the bottom of a column with no correlation rendering as a half-band onlap with an amber marker): I can't correlate to left, zero ties is a lens. So a rescued unit renders as a lens, never a forced onlap, superseding the original 2026-07-26 re-emit-the-onlaps form. The channel is a process-global set so the repair can force specific units without threading a parameter through every emitter; it is set, re-run, and cleared within one call.

.. CG-EXPLANATION-END id=module-header

``let FORCED``
--------------

.. CG-BLOCK id=let:FORCED lines=31-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 31-38
   :lineno-match:

.. CG-EXPLANATION-START id=let:FORCED

**What this does.** A module-level set of keys naming the units currently forced to a lens, keyed by layer id, gap index, and side.

**Why it is here.** The docstring records the repair pass sets it and clears it synchronously within one call, so it never leaks across calls (there is no await between).

.. CG-EXPLANATION-END id=let:FORCED

``interface ReviewFlag``
------------------------

.. CG-BLOCK id=interface:ReviewFlag lines=39-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 39-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ReviewFlag

**What this does.** A type recording one drilled unit the repair had to rescue: its layer id, the gap it terminates into, and the side.

**Why it is here.** The docstring records it is kept on the fill result as data other code may read, but the litho overlay no longer draws a marker for it (owner 2026-09-04: the correlate invitation confused the user).

.. CG-EXPLANATION-END id=interface:ReviewFlag

``function parseForceLensKey``
------------------------------

.. CG-BLOCK id=function:parseForceLensKey lines=52-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 52-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseForceLensKey

**What this does.** Parses a force-lens key back into a structured review flag, returning nothing on a malformed key.

**Why it is here.** The docstring notes layer ids contain no separator character, so a three-part split is unambiguous; this is the inverse of the key builder.

.. CG-EXPLANATION-END id=function:parseForceLensKey

``function forceLensKey``
-------------------------

.. CG-BLOCK id=function:forceLensKey lines=75-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 75-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:forceLensKey

**What this does.** Builds the force-lens key for a unit's termination into one gap on one side from its layer id, gap index, and side.

**Why it is here.** The docstring records the same builder is used both to name the flooded units and to test a unit in the sweep, so the two cannot drift.

.. CG-EXPLANATION-END id=function:forceLensKey

``function setForceLensUnits``
------------------------------

.. CG-BLOCK id=function:setForceLensUnits lines=80-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 80-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:setForceLensUnits

**What this does.** Replaces the forced-lens set.

**Why it is here.** The repair pass sets it before re-running the fill.

.. CG-EXPLANATION-END id=function:setForceLensUnits

``function clearForceLensUnits``
--------------------------------

.. CG-BLOCK id=function:clearForceLensUnits lines=85-89

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 85-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:clearForceLensUnits

**What this does.** Clears the forced-lens set.

**Why it is here.** The repair pass clears it after re-running the fill so the state never leaks to the next call.

.. CG-EXPLANATION-END id=function:clearForceLensUnits

``function isForcedLens``
-------------------------

.. CG-BLOCK id=function:isForcedLens lines=90-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/forceLensUnits.ts
   :language: typescript
   :lines: 90-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:isForcedLens

**What this does.** A yes/no test: is this unit forced to a lens on this gap and side?

**Why it is here.** The sweep calls it to decide whether to demote a unit's 2/1/0 count to 0 for exactly the flooded units.

.. CG-EXPLANATION-END id=function:isForcedLens

