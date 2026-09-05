desktop.renderer.src.shell.stages.sections.useLithoFillHotkey
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useLithoFillHotkey.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useLithoFillHotkey.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoFillHotkey.ts
   :language: typescript
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the bare-'L' accelerator that toggles the litho fill. The key is axis-aware because 'the litho fill' is a different store per axis: on the geotech axis it swaps the litho fill in for the packing fill, on the litho axis it flips the Fill-bands toggle, and on the geological axis it does nothing.

**Why it is here.** Owner dogfeed 2026-08-15: reading a packing subdivision against its lithology means flipping this fill every few seconds, and walking the Display menu each time is friction. Same two guards as the P hotkey — not while typing, and Ctrl+L is the browser address bar. On the geological axis the key is silent rather than moving a toggle the engineer cannot see.

.. CG-EXPLANATION-END id=module-header

``function useLithoFillHotkey``
-------------------------------

.. CG-BLOCK id=function:useLithoFillHotkey lines=50-85

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useLithoFillHotkey.ts
   :language: typescript
   :lines: 50-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoFillHotkey

**What this does.** Binds a keydown listener; on a bare 'l' it flips the correct store for the current axis (read through a ref so an axis switch re-targets the key without a remount) and calls back with the new state. On the geological axis it returns without acting.

**Why it is here.** Reading the axis through a ref keeps the listener bound once while still targeting whatever axis is live. Silence on the geological axis avoids toasting about an invisible toggle.

.. CG-EXPLANATION-END id=function:useLithoFillHotkey

