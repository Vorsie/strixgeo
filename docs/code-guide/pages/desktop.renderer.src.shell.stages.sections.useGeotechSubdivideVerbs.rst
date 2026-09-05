desktop.renderer.src.shell.stages.sections.useGeotechSubdivideVerbs
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechSubdivideVerbs.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechSubdivideVerbs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechSubdivideVerbs.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook behind pipeline step 1 (Subdivide CPTs) and its re-subdivide confirmation dialog. It owns the subdivide busy flag, the dialog's open state and the parked scope, and the four functions: the actual run, the press that confirms first when it would destroy work, and the two dialog resolvers.

**Why it is here.** Extracted verbatim from ``SectionsToolbar`` (debt #201). The hook sits after the tie-status hook in the toolbar because a run refreshes the tie status.

.. CG-EXPLANATION-END id=module-header

``interface UseGeotechSubdivideVerbsDeps``
------------------------------------------

.. CG-BLOCK id=interface:UseGeotechSubdivideVerbsDeps lines=18-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechSubdivideVerbs.ts
   :language: typescript
   :lines: 18-33
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechSubdivideVerbsDeps

**What this does.** What the verbs need: the active litho model, the two rebuild signals (statistic-stale and columns-needing-re-derive), the pre-model pending statistic, the subdivide handler, the tie-status refresh, and the scope (band and hand-edit counts, model-wide and this-section).

**Why it is here.** The scope is what the confirmation gates on; the two rebuild signals are what decide whether a press means 'rebuild' rather than 'skip existing'.

.. CG-EXPLANATION-END id=interface:UseGeotechSubdivideVerbsDeps

``interface UseGeotechSubdivideVerbsResult``
--------------------------------------------

.. CG-BLOCK id=interface:UseGeotechSubdivideVerbsResult lines=34-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechSubdivideVerbs.ts
   :language: typescript
   :lines: 34-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechSubdivideVerbsResult

**What this does.** What it returns: the busy flag, the dialog open state, and the press / cancel / confirm verbs.

**Why it is here.** The toolbar renders the step-1 button and dialog from these.

.. CG-EXPLANATION-END id=interface:UseGeotechSubdivideVerbsResult

``function useGeotechSubdivideVerbs``
-------------------------------------

.. CG-BLOCK id=function:useGeotechSubdivideVerbs lines=56-153

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechSubdivideVerbs.ts
   :language: typescript
   :lines: 56-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechSubdivideVerbs

**What this does.** Runs the subdivide, scoping it to the open section (or model-wide on a statistic re-run), passing the pre-model statistic on the model-creating press, and skipping already-banded columns unless the button itself announced a rebuild. The press function confirms first only when there are bands to destroy — model-wide for a statistic re-run, this-section otherwise — and goes straight through otherwise; the two resolvers close or run the parked scope.

**Why it is here.** Step 1 proposes nothing (owner ruling 2026-08-04). A statistic re-run is model-wide (owner 2026-08-18) because the stamp that clears the tag is model-level, so a scoped re-run would freeze a discrepancy in via first-subdivision-wins. The confirmation gate is 'this press has bands to destroy', not 'a model exists', after the owner saw an overwrite popup on a section with no subdivision that read as a threat to a different section (2026-08-15).

.. CG-EXPLANATION-END id=function:useGeotechSubdivideVerbs

