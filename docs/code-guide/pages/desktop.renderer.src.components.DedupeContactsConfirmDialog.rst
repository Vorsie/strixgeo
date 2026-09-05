desktop.renderer.src.components.DedupeContactsConfirmDialog
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/DedupeContactsConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/DedupeContactsConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/DedupeContactsConfirmDialog.tsx
   :language: tsx
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the dedupe-contacts confirmation. The comment explains that Dedupe deletes duplicate formation-contact rows from the database — and that where the engineer placed two picks on the same formation at the same investigation, one is deleted and nothing puts it back. It imports the shared ``ConfirmDialog`` and the translator.

**Why it is here.** The comment spells out why this is irreversible in the ``docs/ux.md`` sense (the engine returns the removed ids but no command re-creates them, and a re-insert would be refused because the survivor still holds the key), so it gets the full treatment introduced on the ``CptRefreshConfirmDialog`` page: Cancel default-focused, an action-named confirm, and a body that states what is at stake before the click rather than a count in a toast afterwards. It also notes the count is a preview of the engine's decision, not a promise, and that a zero count still allows the run because the loaded list can lag the saved model and a cleanup that refuses to check is worse than a redundant run.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=27-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/DedupeContactsConfirmDialog.tsx
   :language: tsx
   :lines: 27-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, how many contacts the run is expected to delete, across how many investigation-and-formation pairs, cancel and confirm callbacks, and a busy flag.

**Why it is here.** The counts feed the body's preview of the loss, and the pair count answers the question the engineer actually has — how spread out the duplicates are — while the busy flag disables the buttons while the cleanup runs.

.. CG-EXPLANATION-END id=interface:Props

``function DedupeContactsConfirmDialog``
----------------------------------------

.. CG-BLOCK id=function:DedupeContactsConfirmDialog lines=51-109

.. literalinclude:: ../../../desktop/src/renderer/src/components/DedupeContactsConfirmDialog.tsx
   :language: tsx
   :lines: 51-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:DedupeContactsConfirmDialog

**What this does.** The dialog component. It draws a ``ConfirmDialog`` whose body states the expected deletion count (or a "nothing found" line when zero), which pick survives each pair, and that the deletion cannot be undone. The go-ahead button reads "Remove duplicates" and is destructive-styled; Cancel is the safe default.

**Why it is here.** The survivor rule is stated because that is the real question behind a delete count and it is not obvious from the button (per the comment). The undo note is worth naming precisely because the only recovery is the project-wide revert, which rolls back everything since the last save and does nothing for a never-saved project. It follows the irreversible-action template from the ``CptRefreshConfirmDialog`` page.

.. CG-EXPLANATION-END id=function:DedupeContactsConfirmDialog

