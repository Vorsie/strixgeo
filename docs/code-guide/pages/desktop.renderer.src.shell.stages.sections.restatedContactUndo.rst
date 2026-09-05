desktop.renderer.src.shell.stages.sections.restatedContactUndo
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/restatedContactUndo.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/restatedContactUndo.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/restatedContactUndo.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the module that builds the undo command for a restated-contact move on the geotech axis — the inverse the move dialog promises.

**Why it is here.** The dialog has said 'One step on the undo stack. Ctrl+Z puts all of it back' since it shipped, and until audit finding F11 nothing pushed that step, so Ctrl+Z silently reverted an unrelated earlier edit. A plain move's inverse is a move back (classes re-derive exactly), but a merge also deleted a packing band, so its inverse is two calls in a fixed order — move the contact back, then split the neighbour at the old boundary — each redo cycle re-anchoring onto the row the previous revert's split created. Pure with respect to React: no hooks, no state.

.. CG-EXPLANATION-END id=module-header

``interface RestatedContactMoveFacts``
--------------------------------------

.. CG-BLOCK id=interface:RestatedContactMoveFacts lines=25-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/restatedContactUndo.ts
   :language: typescript
   :lines: 25-44
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RestatedContactMoveFacts

**What this does.** What the canvas captured before the commit — ids the response does not carry: the project and model ids, the dragged pair, the pre-drag and landed depths, and the bands directly below and above the pair.

**Why it is here.** A merge's inverse addresses those neighbour bands, and the response cannot name them — it only says what was deleted — so they are captured before the commit while they still exist.

.. CG-EXPLANATION-END id=interface:RestatedContactMoveFacts

``interface RestatedContactUndoApi``
------------------------------------

.. CG-BLOCK id=interface:RestatedContactUndoApi lines=45-73

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/restatedContactUndo.ts
   :language: typescript
   :lines: 45-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RestatedContactUndoApi

**What this does.** The two endpoints the inverse calls: move a restated contact, and split a geotech band (returning the created row ids).

**Why it is here.** Narrowing to these two keeps the undo builder free of the whole API surface and testable with a small stub.

.. CG-EXPLANATION-END id=interface:RestatedContactUndoApi

``function buildRestatedContactUndoCommand``
--------------------------------------------

.. CG-BLOCK id=function:buildRestatedContactUndoCommand lines=74-157

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/restatedContactUndo.ts
   :language: typescript
   :lines: 74-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildRestatedContactUndoCommand

**What this does.** Builds the command. A plain move (nothing deleted) is inverted by the same gesture at the old depth. A merge-down (the lower band absorbed) is inverted by moving the contact back then splitting the below-band at the landed depth, re-anchoring the fresh lower id across redo cycles; merge-up is the mirror, re-anchoring on the reapply side. It returns null when the outcome cannot be inverted — a merge whose needed neighbour was not on the section — and the caller then logs and pushes nothing.

**Why it is here.** The order in the merge inverse is load-bearing: the contact must be back at the old depth before the split, because at the merged geometry the restored packing boundary would sit exactly on the litho contact and be refused. Returning null rather than guessing is deliberate — a wrong undo is worse than a missing one.

.. CG-EXPLANATION-END id=function:buildRestatedContactUndoCommand

