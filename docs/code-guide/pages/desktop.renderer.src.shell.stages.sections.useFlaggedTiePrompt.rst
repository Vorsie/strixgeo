desktop.renderer.src.shell.stages.sections.useFlaggedTiePrompt
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useFlaggedTiePrompt.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useFlaggedTiePrompt.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useFlaggedTiePrompt.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook that holds the 'these correlations no longer match — delete them?' question and carries out its answer. A hand edit on the geotech axis re-derives touched bands' classes, and an accepted tie whose ends stop agreeing is flagged, not deleted; this hook raises the question at the moment of the edit.

**Why it is here.** The owner once found a violet review badge later and had to reconstruct which edit put it there, and asked for the question at edit time instead. The deletion reuses the ordinary disconnect handler — same undo entry, same refetches, same failure toast — so a tie deleted from this prompt is indistinguishable from one disconnected by hand; that is deliberate, it is a shortcut to an existing gesture, not a second way to remove a correlation.

.. CG-EXPLANATION-END id=module-header

``interface UseFlaggedTiePromptDeps``
-------------------------------------

.. CG-BLOCK id=interface:UseFlaggedTiePromptDeps lines=25-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useFlaggedTiePrompt.ts
   :language: typescript
   :lines: 25-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseFlaggedTiePromptDeps

**What this does.** What the hook needs: the packing ties currently on screen (to resolve a flagged id back to the layer pair the delete addresses) and the ordinary disconnect gesture.

**Why it is here.** The on-screen edge list is read at answer time, not flag time, because the edit re-anchors ties and the list is refetched first.

.. CG-EXPLANATION-END id=interface:UseFlaggedTiePromptDeps

``interface UseFlaggedTiePromptResult``
---------------------------------------

.. CG-BLOCK id=interface:UseFlaggedTiePromptResult lines=42-67

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useFlaggedTiePrompt.ts
   :language: typescript
   :lines: 42-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseFlaggedTiePromptResult

**What this does.** What it returns: how many ties the last edit flagged, a busy flag, and three actions — raise the question, keep them flagged (just close), and delete them all.

**Why it is here.** The count of zero means no question is open; keep is the cancel path because the flags are already written.

.. CG-EXPLANATION-END id=interface:UseFlaggedTiePromptResult

``function useFlaggedTiePrompt``
--------------------------------

.. CG-BLOCK id=function:useFlaggedTiePrompt lines=68-141

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useFlaggedTiePrompt.ts
   :language: typescript
   :lines: 68-141
   :lineno-match:

.. CG-EXPLANATION-START id=function:useFlaggedTiePrompt

**What this does.** Filters the asked ids to those still flagged as a genuine mismatch (not merely 'the band was absorbed but the survivor still matches'), derived at render so a slow refetch delays the dialog rather than emptying it. Delete-all disconnects each still-present flagged tie independently, counts and logs any that vanished between question and answer, and does not abandon the rest when one fails.

**Why it is here.** The question is 'these no longer MATCH — delete them?', so only mismatches belong in it — offering a still-correct absorbed-band tie under that sentence would be false about it. One failure does not stop the batch because the engineer answered 'delete them', not 'delete them until one fails'.

.. CG-EXPLANATION-END id=function:useFlaggedTiePrompt

