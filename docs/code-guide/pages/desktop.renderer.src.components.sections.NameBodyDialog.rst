desktop.renderer.src.components.sections.NameBodyDialog
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/NameBodyDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/NameBodyDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/NameBodyDialog.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the pop-up dialog for naming or renaming a body (a body is one connected mass of the same soil in the model). It imports React's hooks and the shared Button and Modal building blocks.

**Why it is here.** The comment records that this replaced a browser prompt that silently did nothing: Electron's renderer (the web page the user sees) disables the native prompt for security, so picking 'Name body' from the context menu had no effect (dogfeed 1 June 2026). It also notes that naming a body marks it user-curated, so a named body survives the automatic clean-up sweep — naming is how you keep a detected lens.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=19-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/NameBodyDialog.tsx
   :language: tsx
   :lines: 19-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs the dialog takes: whether it is open, the current name to pre-fill, a submit callback fired with the trimmed non-empty name, and a cancel callback for Escape, backdrop click, or Cancel.

**Why it is here.** It is the contract between the dialog and its owner; the caller owns whether the dialog is open and what happens on submit, keeping the dialog itself a reusable shell.

.. CG-EXPLANATION-END id=interface:Props

``function NameBodyDialog``
---------------------------

.. CG-BLOCK id=function:NameBodyDialog lines=37-130

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/NameBodyDialog.tsx
   :language: tsx
   :lines: 37-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:NameBodyDialog

**What this does.** The component. It keeps a draft name and a busy flag in state (state is a value a component remembers between renders), holds a reference to the text box (a ref is a handle to a real screen element), and on each open re-seeds the draft from the current name and focuses and selects the text so a rename overwrites in one keystroke. Submit trims the name, refuses an empty or in-flight submit, and awaits the caller's handler; Enter submits. It renders inside the shared Modal, which handles Escape and backdrop dismissal.

**Why it is here.** The focus-and-select-on-open behaviour makes renaming fast, and the busy flag blocks a double submit while the save is in flight. The hint line under the title tells the engineer that naming keeps the body, matching the preserve-named rule.

.. CG-EXPLANATION-END id=function:NameBodyDialog

