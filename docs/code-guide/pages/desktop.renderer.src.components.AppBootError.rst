desktop.renderer.src.components.AppBootError
============================================

.. CG-PAGE source=desktop/src/renderer/src/components/AppBootError.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/AppBootError.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppBootError.tsx
   :language: tsx
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment, docstring and single import for the boot-error screen. The comment explains it is the full-window message shown when the Python engine never started, split out of the top component's early return, with only the drawing living here. It imports just the translator.

**Why it is here.** The comment records the split (debt #12): the early-return guard that chooses this screen must stay in the top component because it sits below all the hooks and moving it would break the rules of hooks (hooks must run in the same order every redraw), so only the presentational drawing was extracted here to keep the top component reading as coordinator plus a scannable list of screens (see the ``App`` page).

.. CG-EXPLANATION-END id=module-header

``function AppBootError``
-------------------------

.. CG-BLOCK id=function:AppBootError lines=22-34

.. literalinclude:: ../../../desktop/src/renderer/src/components/AppBootError.tsx
   :language: tsx
   :lines: 22-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:AppBootError

**What this does.** Draws a centred full-window message with a red title and a muted body explaining that the engine failed to start.

**Why it is here.** A plain, stateless screen — it takes no inputs and remembers nothing — shown when the boot hook reports the engine never came up, so the window says what went wrong instead of sitting blank.

.. CG-EXPLANATION-END id=function:AppBootError

