desktop.renderer.src.shell.stages.sections.useLithoCorrelateVerbs
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useLithoCorrelateVerbs.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useLithoCorrelateVerbs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoCorrelateVerbs.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the litho-axis correlation review flow — auto-correlate, re-correlate, and accept-correlations. It owns the two busy flags, the re-correlate confirmation state, and the five handlers behind the Correlate caret.

**Why it is here.** Extracted verbatim from ``SectionsToolbar`` (debt #201).

.. CG-EXPLANATION-END id=module-header

``interface UseLithoCorrelateVerbsDeps``
----------------------------------------

.. CG-BLOCK id=interface:UseLithoCorrelateVerbsDeps lines=19-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoCorrelateVerbs.ts
   :language: typescript
   :lines: 19-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoCorrelateVerbsDeps

**What this does.** What the verbs read: the project, the active litho model, the open section id, the toast action, and the three shell actions (auto-correlate, refetch edges, recompute bodies).

**Why it is here.** These are the inputs each verb fires against.

.. CG-EXPLANATION-END id=interface:UseLithoCorrelateVerbsDeps

``interface UseLithoCorrelateVerbsResult``
------------------------------------------

.. CG-BLOCK id=interface:UseLithoCorrelateVerbsResult lines=30-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoCorrelateVerbs.ts
   :language: typescript
   :lines: 30-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoCorrelateVerbsResult

**What this does.** What it returns: the two busy flags, the re-correlate dialog state and edge count, and the five verbs.

**Why it is here.** The toolbar renders the Correlate caret and its confirmation from these.

.. CG-EXPLANATION-END id=interface:UseLithoCorrelateVerbsResult

``function useLithoCorrelateVerbs``
-----------------------------------

.. CG-BLOCK id=function:useLithoCorrelateVerbs lines=56-238

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoCorrelateVerbs.ts
   :language: typescript
   :lines: 56-238
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoCorrelateVerbs

**What this does.** The auto-correlate verb first counts THIS section's unapproved auto suggestions: none means fire immediately, some means open the re-correlate confirmation. The confirm path deletes only this section's auto edges then re-runs; cancel and skip just close. Accept-correlations approves all unapproved edges in the open section, forces the canvas to re-read them, and schedules the body-identity recompute.

**Why it is here.** The count is scoped to this section (debt #3) so re-correlating section A does not report section B's suggestions — the confusing '57 edges but I didn't correlate here' bug. It counts only UNAPPROVED auto edges because accepted ones survive a re-run, so warning about them popped a spurious overwrite dialog. Delete is section-scoped too, never a neighbour's edges — the cross-section data-loss bug.

.. CG-EXPLANATION-END id=function:useLithoCorrelateVerbs

