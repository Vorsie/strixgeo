desktop.renderer.src.components.ui.Modal
========================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/Modal.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/Modal.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Modal.tsx
   :language: tsx
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its two imports. The comment lists what this shared modal shell handles for every dialog — a dimmed backdrop, Escape-to-cancel, a click on the backdrop to cancel, the centred card, the accessibility wiring, and stopping a click inside the card from closing it — and what the caller still supplies: the title, body and buttons, the initial focus, and the submit logic. It imports two React hooks (``useEffect``, ``useRef``) and ``createPortal``.

**Why it is here.** A *modal* is a dialog that blocks the rest of the screen until it is dismissed. Three dialogs needed the exact same shell, so it was factored here under the project's rule to extract shared shape rather than copy it a third time. Everything the shell owns is safety-and-accessibility behaviour that must be identical everywhere; leaving the title and buttons to the caller keeps each dialog free to say what it needs. This is the shared-primitive pattern introduced on the ``desktop.renderer.src.components.ui.Button`` page, applied to whole dialogs.

.. CG-EXPLANATION-END id=module-header

``const FOCUSABLE_SELECTOR``
----------------------------

.. CG-BLOCK id=const:FOCUSABLE_SELECTOR lines=24-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Modal.tsx
   :language: tsx
   :lines: 24-26
   :lineno-match:

.. CG-EXPLANATION-START id=const:FOCUSABLE_SELECTOR

**What this does.** A text pattern listing the kinds of on-screen elements that can hold keyboard focus — links, enabled buttons, text boxes, inputs, dropdowns and anything explicitly made focusable — while excluding disabled controls and elements marked focus-by-code-only.

**Why it is here.** The dialog uses this pattern to find every element the Tab key can reach inside the card, so it can keep the Tab key cycling within the open dialog instead of letting focus wander to the hidden app behind it. Trapping focus inside an open dialog is the WCAG 2.4.3 requirement noted in the comment.

.. CG-EXPLANATION-END id=const:FOCUSABLE_SELECTOR

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=27-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Modal.tsx
   :language: tsx
   :lines: 27-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Lists the shell's inputs: whether it is ``open``, the ``onCancel`` handler, the ``labelledBy`` id that names the dialog for screen readers, an optional ``busy`` flag, an optional ``cardClassName`` to widen the card, an optional test id, and the ``children`` (the dialog's own content).

**Why it is here.** ``labelledBy`` is required so the caller can point the dialog at its own heading element, which screen readers announce when the dialog opens. ``busy`` exists so that while an action is saving, Escape and a backdrop click do nothing and the user cannot dismiss a dialog mid-save. ``cardClassName`` defaults to a standard width but lets a wider form (the project-metadata editor's grid) override it without forking the component.

.. CG-EXPLANATION-END id=interface:Props

``function Modal``
------------------

.. CG-BLOCK id=function:Modal lines=47-175

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/Modal.tsx
   :language: tsx
   :lines: 47-175
   :lineno-match:

.. CG-EXPLANATION-START id=function:Modal

**What this does.** The shell component. It keeps a *ref* to the card element, then runs two *effects* while open: the first listens for keystrokes — Escape calls cancel (unless busy), and Tab or Shift+Tab is bent so focus wraps around within the card; the second remembers what was focused before opening, pulls focus into the card, and restores focus to the original trigger when the dialog closes. If it is not open it draws nothing. When open it uses a *portal* to draw a full-window dimmed, blurred backdrop and the centred card directly onto the page body, marks the card as a dialog for assistive tech, and stops a click inside the card from reaching the backdrop.

**Why it is here.** The comments record several hard-won reasons. Drawing nothing before the *portal* keeps a closed dialog from leaving any element on the page. A *portal* (React drawing into a different part of the page) attaches the backdrop straight to the page body because, left inside the map or section canvas, the dim covered only that canvas and the rest of the window stayed lit — so the "modal" did not actually block the interface. The very high stacking number sits above every layer the app can set, because the whole app shares one flat stacking order and lower numbers let side panels paint over the dim. The strong dark, blurred backdrop is the unambiguous "the interface is blocked" signal on both the light and the dark theme. The card uses theme-aware surface colours rather than fixed white, because the app switches theme by a class rather than the operating-system setting, and fixed-white dialogs rendered wrong in dark mode. The focus effect depends only on ``open`` so toggling ``busy`` mid-dialog does not yank focus around.

.. CG-EXPLANATION-END id=function:Modal

