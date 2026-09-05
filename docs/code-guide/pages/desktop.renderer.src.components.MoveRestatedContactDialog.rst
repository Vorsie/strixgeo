desktop.renderer.src.components.MoveRestatedContactDialog
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/MoveRestatedContactDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/MoveRestatedContactDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/components/MoveRestatedContactDialog.tsx
   :language: tsx
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the move-restated-contact prompt, shown when the engineer drags a restated contact on the geotech axis. The comment records that the owner asked for a warning that moving this boundary will move the litho (and sometimes the geological) contact alongside it. It imports the shared ``ConfirmDialog`` and the translator.

**Why it is here.** The comment explains why this drag alone earns a prompt: every other geotech-axis gesture stays inside the geotechnical model, but this one gesture reaches up the hierarchy and edits the level above (and sometimes the level above that), and nothing on screen tells the engineer the row is shared — a drag whose blast radius is invisible is what the prompt exists to prevent. Crucially it is NOT styled as destructive: nothing is lost, the move is a single undo step and refining a contact from the evidence is the intended workflow, so the move is the default and Cancel is the way out — the opposite of the re-subdivide dialog next door, and the reversible side of the rule from the ``CptRefreshConfirmDialog`` page.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=23-47

.. literalinclude:: ../../../desktop/src/renderer/src/components/MoveRestatedContactDialog.tsx
   :language: tsx
   :lines: 23-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, cancel and confirm callbacks, a busy flag, the depth the contact will land at, and a flag saying whether this litho row is derived from a geological contact.

**Why it is here.** The geology flag is passed rather than assumed because (per the comment) only about a third of litho rows carry a geological parent, so the sentence about what will move has to be built from the actual row — the "might even be litho and geo sometimes" case.

.. CG-EXPLANATION-END id=interface:Props

``function MoveRestatedContactDialog``
--------------------------------------

.. CG-BLOCK id=function:MoveRestatedContactDialog lines=48-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/MoveRestatedContactDialog.tsx
   :language: tsx
   :lines: 48-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:MoveRestatedContactDialog

**What this does.** The dialog component. It draws a ``ConfirmDialog`` whose title and bullet list name what the drag will move — the litho contact always, and the geological contact only when this row has a geological parent — plus the target depth and an undo note. The go-ahead button reads "Move it" and is the primary (non-destructive) action.

**Why it is here.** The geology bullet is shown only when the row actually has a geological parent, because a fixed sentence would be wrong most of the time (per the comment). The action is the default and Cancel the escape, matching the reversible framing: the move is one undo step, not a loss.

.. CG-EXPLANATION-END id=function:MoveRestatedContactDialog

