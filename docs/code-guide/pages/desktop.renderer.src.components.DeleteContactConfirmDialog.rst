desktop.renderer.src.components.DeleteContactConfirmDialog
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/DeleteContactConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/DeleteContactConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/components/DeleteContactConfirmDialog.tsx
   :language: tsx
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the delete-formation-contact confirmation. The comment notes it replaced an earlier bare browser confirm box. It imports the shared ``ConfirmDialog``, the translator, and a slot-interpolation helper.

**Why it is here.** The old bare confirm box violated the destructive-actions rule in ``docs/ux.md`` (debt #62), so this styled dialog was written to follow it: Cancel default-focused and an action-named danger confirm — the same irreversible-action template introduced on the ``CptRefreshConfirmDialog`` page.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=12-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/DeleteContactConfirmDialog.tsx
   :language: tsx
   :lines: 12-24
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, the formation name for the title, confirm and cancel callbacks, and a busy flag.

**Why it is here.** The formation name is passed in so the title names exactly which contact is about to be deleted, and the busy flag disables the buttons while the delete is in flight.

.. CG-EXPLANATION-END id=interface:Props

``function DeleteContactConfirmDialog``
---------------------------------------

.. CG-BLOCK id=function:DeleteContactConfirmDialog lines=25-52

.. literalinclude:: ../../../desktop/src/renderer/src/components/DeleteContactConfirmDialog.tsx
   :language: tsx
   :lines: 25-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:DeleteContactConfirmDialog

**What this does.** The dialog component. It draws a ``ConfirmDialog`` with a title naming the formation, a short body, and a destructive "Delete contact" confirm, with Cancel as the safe default.

**Why it is here.** A thin wrapper over the shared confirm dialog — the smallest form of the irreversible-action template from the ``CptRefreshConfirmDialog`` page, since deleting a contact cannot be undone.

.. CG-EXPLANATION-END id=function:DeleteContactConfirmDialog

