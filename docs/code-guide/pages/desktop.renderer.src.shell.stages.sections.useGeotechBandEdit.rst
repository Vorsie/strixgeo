desktop.renderer.src.shell.stages.sections.useGeotechBandEdit
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hand editing of packing sub-bands on the geotech axis — split, merge, move a boundary, absorb a small lens, set a borehole band's class, and clear one column — each previewing first and committing only on a second, explicit ask.

**Why it is here.** Owner rulings (debt #227): ruling 6 says the consequence must be stated before the edit lands, ruling 5 says it must never stop it — so a gesture previews, the sheet says which way the representative qc moves and what class results, and the commit only goes out if the owner asks again, at which point nothing here can refuse. Ruling 2's one correct refusal — a depth outside the band's litho body — is surfaced verbatim because the server's message names the wall and the axis to fix it on. Every committed edit pushes its inverse onto the undo stack; the hook never creates or deletes a correlation itself.

.. CG-EXPLANATION-END id=module-header

``type PendingEdit``
--------------------

.. CG-BLOCK id=type:PendingEdit lines=44-71

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts
   :language: typescript
   :lines: 44-71
   :lineno-match:

.. CG-EXPLANATION-START id=type:PendingEdit

**What this does.** The edit being previewed, kept so the commit repeats it exactly: a split (band and depth), a merge (two bands and their shared boundary), a move (two bands, new depth, and the pre-drag depth), or an absorb (the host-lens-host run and its two internal boundaries).

**Why it is here.** The boundary depths are carried on the merge and absorb because the plan's single union interval no longer records them and the undo needs them to re-split at exactly the right place. The pre-drag depth is the move's undo anchor.

.. CG-EXPLANATION-END id=type:PendingEdit

``interface BandEditUndoStack``
-------------------------------

.. CG-BLOCK id=interface:BandEditUndoStack lines=72-81

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts
   :language: typescript
   :lines: 72-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandEditUndoStack

**What this does.** The one slice of the undo stack this hook uses — a way to push a command with a description and revert/reapply functions.

**Why it is here.** Narrowing to just ``push`` keeps the hook's dependency on the undo system minimal; a command is pushed only AFTER its edit succeeds (the stack invariant).

.. CG-EXPLANATION-END id=interface:BandEditUndoStack

``interface UseGeotechBandEditDeps``
------------------------------------

.. CG-BLOCK id=interface:UseGeotechBandEditDeps lines=82-121

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts
   :language: typescript
   :lines: 82-121
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechBandEditDeps

**What this does.** What the handlers consume: the active geotech model, the project id, the layer and edge refetches, mark-dirty, an optional recompute scheduler, the toast, the undo stack, and a callback to report accepted ties an edit flagged.

**Why it is here.** The flagged-tie callback exists because flag-not-drop keeps a broken correlation and badges it, and the owner asked for the question at edit time; the hook only reports what happened, and only after the refetch, so the ids resolve against a list matching the server.

.. CG-EXPLANATION-END id=interface:UseGeotechBandEditDeps

``interface UseGeotechBandEditResult``
--------------------------------------

.. CG-BLOCK id=interface:UseGeotechBandEditResult lines=122-193

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts
   :language: typescript
   :lines: 122-193
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechBandEditResult

**What this does.** The preview handlers (split / merge / move / absorb / set-class / clear-column), the pending plan (null when no sheet is open), a busy flag, and the confirm / cancel pair. The edit handlers are undefined when there is no geotech model.

**Why it is here.** Set-class commits directly with no consequence sheet because the change is one number, fully undoable, and the outcome IS the choice; clear-column fires immediately (owner: 'you can fire it'). The sheet exists only for edits whose re-derived outcome the engineer cannot see coming.

.. CG-EXPLANATION-END id=interface:UseGeotechBandEditResult

``function useGeotechBandEdit``
-------------------------------

.. CG-BLOCK id=function:useGeotechBandEdit lines=194-695

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBandEdit.ts
   :language: typescript
   :lines: 194-695
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechBandEdit

**What this does.** Wires each gesture to its endpoints. The four sheet gestures request a server preview and store the plan; confirm repeats the exact edit, then — before the refresh — pushes the inverse onto the undo stack and toasts the tie consequences (flagged, deleted-accepted, removed-pending counts), then runs the shared post-write fan-out and warns if the view could not refresh. Set-class commits directly with its own fan-out (deliberately NOT staling the borehole division). Clear-column deletes the column's bands and runs the full fan-out. Every path re-derives classes server-side.

**Why it is here.** The bookkeeping runs BEFORE the refresh because the write has already landed on the server; letting a failed refetch fall into the catch would report a committed edit as a failure — inviting a second, doubled edit — and leave it permanently un-undoable. Set-class deliberately does not stale 'Divide boreholes' because a re-divide is exactly what ERASES a hand class. The two kinds of tie removal are named separately — a withdrawn machine proposal versus a deleted accepted tie — because naming the second as the first is the failure flag-not-drop exists to prevent.

.. CG-EXPLANATION-END id=function:useGeotechBandEdit

