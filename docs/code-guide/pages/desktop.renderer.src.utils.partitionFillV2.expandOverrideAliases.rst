desktop.renderer.src.utils.partitionFillV2.expandOverrideAliases
================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/expandOverrideAliases.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/expandOverrideAliases.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/expandOverrideAliases.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module fixes a mismatch between the body id a grab handle is keyed on and the body id the engine emits under. The app keys an override on the rendered region's body id, which is the representative after touching same-soil regions are merged; the engine emits per raw unit and consumes the raw body id before that merge. In a single-soil section the merge unions many raw bodies under one representative, so the handle key rarely matches the emitting body and the override is never consumed. This module runs a no-override base pass, learns the exact rendered-to-raw grouping, and aliases each override to every raw body in its rendered body's group.

**Why it is here.** The docstring cites the owner grant of 2026-07-22 (make every handle reshape) and records the dead-handle wall it fixes (a gap-9 tip emitted by one body rendered under another whose raw unit lived on column 0). With no override the map is returned unchanged and the base pass is skipped, so the ordinary path stays a single, byte-identical pass.

.. CG-EXPLANATION-END id=module-header

``function polygonKey``
-----------------------

.. CG-BLOCK id=function:polygonKey lines=29-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/expandOverrideAliases.ts
   :language: typescript
   :lines: 29-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:polygonKey

**What this does.** Builds a stable text key for a region's polygon by joining its rounded fraction and elevation coordinates.

**Why it is here.** The docstring notes the merge only relabels a region, never moves a vertex, so a raw region and its merged version share the exact polygon, and this key matches them.

.. CG-EXPLANATION-END id=function:polygonKey

``function expandOverrideAliasesFromBase``
------------------------------------------

.. CG-BLOCK id=function:expandOverrideAliasesFromBase lines=50-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/expandOverrideAliases.ts
   :language: typescript
   :lines: 50-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:expandOverrideAliasesFromBase

**What this does.** Expands the override map with rendered-to-raw aliases. It returns the map unchanged when there are no overrides; otherwise it runs the no-override base pass, matches each raw region's body id to its rendered body id by identical polygon, groups the raw bodies by rendered representative, and for each override aliases it to every raw body in that group (filling only empty slots so an explicit override wins).

**Why it is here.** The docstring explains this reveals the exact merge equivalence so whichever raw unit emits a tip finds the override under its own body id, and that aliases only fill empty slots so an explicit override on the true emitting body always wins.

.. CG-EXPLANATION-END id=function:expandOverrideAliasesFromBase

