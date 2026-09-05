desktop.renderer.src.components.sections.CompanionOfferDialog
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CompanionOfferDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CompanionOfferDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CompanionOfferDialog.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the dialog offered right after a litho lens is created: it asks whether to auto-create a cross-section drawn at right angles through the lens's centre. The imports pull in React's state hook, the backend client, the logger, and the shared button, modal, and translation pieces.

**Why it is here.** This was an owner directive (2026-05-22). A lens seen on one section is better understood on a second section cut across it; offering to make that companion at the moment of creation saves the engineer drawing it by hand. The backend is written to be idempotent — asking twice returns the existing companion — so the dialog treats 'created' and 'already existed' the same way.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=26-63

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CompanionOfferDialog.tsx
   :language: tsx
   :lines: 26-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: whether the dialog is open, the project, model, and lens identifiers, an optional human name for the lens, a callback fired once a companion section is ready, and a close callback.

**Why it is here.** The identifiers are what the create request needs; the name is shown in the dialog copy so the engineer knows which lens is being companioned; the two callbacks let the parent refresh its section list and navigate to the new section.

.. CG-EXPLANATION-END id=interface:Props

``function CompanionOfferDialog``
---------------------------------

.. CG-BLOCK id=function:CompanionOfferDialog lines=64-150

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CompanionOfferDialog.tsx
   :language: tsx
   :lines: 64-150
   :lineno-match:

.. CG-EXPLANATION-START id=function:CompanionOfferDialog

**What this does.** The component. It tracks a busy flag and an error message. On 'Yes' it calls the backend to create the perpendicular companion, logs the outcome, then tells the parent which section to open and closes; a failure is caught and shown inline. It renders a modal with the offer text, an error line if any, and Skip / Create buttons.

**Why it is here.** The busy flag disables both buttons and shows 'Creating…' while the request is in flight, per the loading-feedback rule. Errors are shown inline in the dialog rather than as a toast so the engineer sees them in context. The idempotent backend means the same handler serves both a fresh create and an already-existing companion.

.. CG-EXPLANATION-END id=function:CompanionOfferDialog

