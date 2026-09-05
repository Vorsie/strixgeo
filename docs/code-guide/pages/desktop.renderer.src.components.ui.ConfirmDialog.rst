desktop.renderer.src.components.ui.ConfirmDialog
================================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/ConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/ConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ConfirmDialog.tsx
   :language: tsx
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's documentation comment and its imports. The comment says this one dialog replaces four earlier hand-written confirm boxes that each rebuilt the same shape, and it fixes the button order: Cancel on the left and default-focused, the destructive or primary action on the right, an optional middle action between them. It then imports two React hooks (``useEffect``, ``useRef``), the shared ``Button`` and ``Modal`` components, and the translation helper ``useT``.

**Why it is here.** The button layout follows the project's reversible-vs-irreversible rule in ``docs/ux.md``: an irreversible action (a delete, an overwrite) must sit behind a confirmation box whose default focus is on Cancel and whose confirm button names the action, never a bare "OK". Collapsing the four earlier copies into one component is the project's rule to extract shared shape once the same code exists in several places, so the safety behaviour is guaranteed identical everywhere a confirm appears.

.. CG-EXPLANATION-END id=module-header

``interface ConfirmDialogAction``
---------------------------------

.. CG-BLOCK id=interface:ConfirmDialogAction lines=25-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ConfirmDialog.tsx
   :language: tsx
   :lines: 25-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ConfirmDialogAction

**What this does.** Describes one action button other than Cancel: its ``label``, the function fired when it is clicked, an optional ``variant`` choosing its look, and an optional test id.

**Why it is here.** Bundling a button's label, click handler and look into one named shape lets a caller describe the confirm button (and an optional middle button) as plain data, which the dialog then draws consistently. The variant defaults are chosen for safety — the main confirm defaults to the primary look, and a caller passes ``danger`` for a destructive confirm so it reads red.

.. CG-EXPLANATION-END id=interface:ConfirmDialogAction

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=37-71

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ConfirmDialog.tsx
   :language: tsx
   :lines: 37-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists every input the dialog accepts: whether it is ``open``, the ``title`` and optional ``body`` text, the required ``confirm`` action and optional ``secondary`` action, the Cancel label and its test id, the ``onCancel`` handler, a ``busy`` flag, an accessibility id linking the heading to the dialog, and a few optional styling and test-id hooks.

**Why it is here.** Naming every input as a prop keeps the caller in charge of when the dialog opens and closes and exactly what each button does, while this file owns the fixed safe layout. The ``busy`` flag exists so that while the confirmed action is running every button is disabled and Escape or a backdrop click do nothing — a half-finished irreversible action must not be triggered twice or cancelled mid-flight. ``labelledBy`` wires the heading to the dialog for screen-reader users, meeting the accessibility floor.

.. CG-EXPLANATION-END id=interface:Props

``function ConfirmDialog``
--------------------------

.. CG-BLOCK id=function:ConfirmDialog lines=72-148

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/ConfirmDialog.tsx
   :language: tsx
   :lines: 72-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:ConfirmDialog

**What this does.** The dialog component. It reads the translation helper, keeps a *ref* pointing at the Cancel button, and in an *effect* focuses that Cancel button whenever the dialog opens. It then draws a ``Modal`` containing the title, the optional body, and a right-aligned row of buttons: Cancel first (using the shared ``Button``, defaulting its label to the translated word for "Cancel"), then the optional middle action, then the confirm action. Every button is disabled while ``busy`` is true.

**Why it is here.** Focusing Cancel on open is the heart of the reversible-vs-irreversible rule (``docs/ux.md``): a stray press of Enter must land on Cancel, never on the destructive action. A *ref* is React's handle to an actual on-screen element, and the shared ``Button`` forwards its ref precisely so this dialog can move focus onto it — the reason ``Button`` uses ``forwardRef``, noted on the ``desktop.renderer.src.components.ui.Button`` page. Building on the shared ``Modal`` and ``Button`` means the escape-to-cancel, focus-trapping and styling are all inherited rather than re-solved here.

.. CG-EXPLANATION-END id=function:ConfirmDialog

