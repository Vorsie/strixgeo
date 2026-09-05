desktop.renderer.src.components.sections.useColumnFindHotkey
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useColumnFindHotkey.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useColumnFindHotkey.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useColumnFindHotkey.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook that binds Ctrl or Cmd plus F to open the section's column-find bar.

**Why it is here.** Owner ask 2026-08-17: on crosssections i want a ctrl+f feature so i can go easily to a column header like s8 or so for example. Ctrl+F was checked to be free first (the bare-F geotech-fill toggle leaves every modified F alone, and nothing else claims it). The default is prevented because Chromium would otherwise offer its own dead find-in-page box, and the press is skipped when the user is typing in a field, or when Alt is held (which would be an operating-system accelerator, not this one).

.. CG-EXPLANATION-END id=module-header

``function useColumnFindHotkey``
--------------------------------

.. CG-BLOCK id=function:useColumnFindHotkey lines=29-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useColumnFindHotkey.ts
   :language: typescript
   :lines: 29-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:useColumnFindHotkey

**What this does.** Keeps the latest open callback in a ref, and while the caller is mounted it listens for Ctrl or Cmd plus F (not with Alt, and not while typing), prevents the default, and calls the callback.

**Why it is here.** Storing the callback in a ref and reading it on each press lets the caller pass a fresh inline closure on every render without the listener being torn down and re-bound each time. An effect is the React tool that runs setup on mount and cleanup on unmount, which is how the listener is attached and removed.

.. CG-EXPLANATION-END id=function:useColumnFindHotkey

