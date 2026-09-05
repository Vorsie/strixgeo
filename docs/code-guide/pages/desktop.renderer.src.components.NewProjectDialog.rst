desktop.renderer.src.components.NewProjectDialog
================================================

.. CG-PAGE source=desktop/src/renderer/src/components/NewProjectDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/NewProjectDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/NewProjectDialog.tsx
   :language: tsx
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the new-project dialog. The comment says it is intentionally minimal — just a name field — and will later become the "create" mode of a unified create-or-edit dialog once the full metadata editor lands. The imports bring in ``useEffect``, ``useRef`` and ``useState``, the shared ``Button`` and ``Modal``, and the translator.

**Why it is here.** The comment records why this dialog exists at all: it replaced a browser ``prompt()`` call, which Electron's window process disables for security, so the old path threw the moment the user picked File → New Project. A small dialog is the supported way to ask for a name. The richer project details are collected later in the metadata editor on the ``ProjectMetadataDialog`` page.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=18-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/NewProjectDialog.tsx
   :language: tsx
   :lines: 18-23
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, a submit callback given the entered name, and a cancel callback.

**Why it is here.** Keeping the inputs to just open/submit/cancel matches the minimal scope — the dialog gathers one name and reports it, and the caller decides what happens next.

.. CG-EXPLANATION-END id=interface:Props

``function NewProjectDialog``
-----------------------------

.. CG-BLOCK id=function:NewProjectDialog lines=24-121

.. literalinclude:: ../../../desktop/src/renderer/src/components/NewProjectDialog.tsx
   :language: tsx
   :lines: 24-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:NewProjectDialog

**What this does.** The dialog component. It remembers the typed name and a busy flag and holds a ref to the input. A ``useEffect`` clears the name and focuses the box each time the dialog opens. Submit trims the name, guards against an empty name or a double-submit, and calls the submit callback. Enter in the box submits. It draws a ``Modal`` with a heading, a blurb, the name field, and Cancel/Create buttons, with Create disabled until a name is typed.

**Why it is here.** Resetting on open (per the comment) stops the dialog remembering the last typed name across cancels, which would be surprising; the focus is deferred one tick so the input is mounted before it is focused. The shared Modal already handles Escape and backdrop-close, so this component only owns the form state and the focus call. The busy guard prevents a slow create from being fired twice.

.. CG-EXPLANATION-END id=function:NewProjectDialog

