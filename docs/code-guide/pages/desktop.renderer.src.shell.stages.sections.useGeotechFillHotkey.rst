desktop.renderer.src.shell.stages.sections.useGeotechFillHotkey
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechFillHotkey.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechFillHotkey.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechFillHotkey.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the bare-'F' accelerator that toggles the geotech NAD packing fill. Geotech axis only; on the litho and geological axes the press is a silent no-op.

**Why it is here.** Owner ask 2026-08-15: 'L' flips the litho fill and would not touch the packing fill, which he flips just as often to read the correlation ribbons under the paint, so the packing fill earns its own key. Same two guards — not while typing, and Ctrl+F is find. A toast about a toggle the engineer cannot see on the axis he is on is worse than silence.

.. CG-EXPLANATION-END id=module-header

``function useGeotechFillHotkey``
---------------------------------

.. CG-BLOCK id=function:useGeotechFillHotkey lines=42-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechFillHotkey.ts
   :language: typescript
   :lines: 42-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechFillHotkey

**What this does.** Binds a keydown listener; on a bare 'f', only while the geotech axis is active (read through a ref), it flips the packing-fill store and calls back with the new state.

**Why it is here.** The axis and callback are held in refs so a fresh inline callback or an axis switch does not rebind the listener every render.

.. CG-EXPLANATION-END id=function:useGeotechFillHotkey

