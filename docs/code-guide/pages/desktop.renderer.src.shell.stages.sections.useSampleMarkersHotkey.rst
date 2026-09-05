desktop.renderer.src.shell.stages.sections.useSampleMarkersHotkey
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useSampleMarkersHotkey.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useSampleMarkersHotkey.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSampleMarkersHotkey.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the bare-'P' keyboard accelerator that toggles the lab-sample markers on and off.

**Why it is here.** Owner dogfeed 2026-08-14: the markers are useful while reading a borehole and noise while dragging a boundary, so they earn a one-key toggle. Two guards are load-bearing — a 'p' typed into a text field is text (checked by a shared helper), and Ctrl+P is print, so only the bare key fires.

.. CG-EXPLANATION-END id=module-header

``function useSampleMarkersHotkey``
-----------------------------------

.. CG-BLOCK id=function:useSampleMarkersHotkey lines=33-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSampleMarkersHotkey.ts
   :language: typescript
   :lines: 33-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSampleMarkersHotkey

**What this does.** Binds a keydown listener for as long as the component is mounted; on a bare 'p' (no Ctrl/Cmd/Alt, not while typing) it flips the markers store and calls back with the new state so the caller can announce it. It holds the callback in a ref so a fresh inline callback each render does not tear down and rebind the listener.

**Why it is here.** A ref (a box holding a value across renders without triggering a redraw) keeps the listener stable while still calling the newest callback. The caller is handed the new state because the menu item's own label flip is invisible with the menu closed.

.. CG-EXPLANATION-END id=function:useSampleMarkersHotkey

