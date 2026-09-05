desktop.renderer.src.utils.psdPreviewOnStore
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/psdPreviewOnStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/psdPreviewOnStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdPreviewOnStore.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds a tiny *store* — a small module-level holder of shared state that components subscribe to — for one on/off switch: whether hovering a lab-sample marker on the section pops up a grain-size preview card. The import brings in a ready-made boolean-store builder.

**Why it is here.** The comment records that the preview is useful while reading a borehole but noise while dragging boundaries, so it gets both a Display-menu item and a bare ``P`` key, and both drive this one switch. It mirrors the borehole-preview store: a single true/false value read by the canvas through React's *useSyncExternalStore* (the built-in way to redraw a component when a store changes). It is module-global because only one section view is open at a time, defaults on, and is pure screen chrome that is never saved — it resets on reload.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=17-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdPreviewOnStore.ts
   :language: typescript
   :lines: 17-19
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the actual holder, a boolean starting at ``true`` (preview on).

**Why it is here.** It is the single shared value every reader below points at, so the toggle has one source of truth.

.. CG-EXPLANATION-END id=const:store

``function togglePsdPreviewOn``
-------------------------------

.. CG-BLOCK id=function:togglePsdPreviewOn lines=20-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdPreviewOnStore.ts
   :language: typescript
   :lines: 20-24
   :lineno-match:

.. CG-EXPLANATION-START id=function:togglePsdPreviewOn

**What this does.** Flips the switch and tells every subscriber it changed.

**Why it is here.** It is what the Display-menu item and the ``P`` key call to turn the preview on or off.

.. CG-EXPLANATION-END id=function:togglePsdPreviewOn

``function setPsdPreviewOn``
----------------------------

.. CG-BLOCK id=function:setPsdPreviewOn lines=25-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdPreviewOnStore.ts
   :language: typescript
   :lines: 25-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:setPsdPreviewOn

**What this does.** Sets the switch to a given value, doing nothing (and notifying nobody) when it is already at that value.

**Why it is here.** Skipping the notify when nothing changed avoids a needless redraw of everyone watching the store.

.. CG-EXPLANATION-END id=function:setPsdPreviewOn

``function getPsdPreviewOn``
----------------------------

.. CG-BLOCK id=function:getPsdPreviewOn lines=30-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdPreviewOnStore.ts
   :language: typescript
   :lines: 30-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:getPsdPreviewOn

**What this does.** Reads the current value once, without subscribing to future changes.

**Why it is here.** It is for code that just needs the value right now and does not want to be redrawn when it later flips.

.. CG-EXPLANATION-END id=function:getPsdPreviewOn

``function usePsdPreviewOn``
----------------------------

.. CG-BLOCK id=function:usePsdPreviewOn lines=35-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/psdPreviewOnStore.ts
   :language: typescript
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePsdPreviewOn

**What this does.** The *hook* form: it returns the current value and re-draws its caller whenever the switch flips.

**Why it is here.** The canvas uses this so it repaints — showing or hiding the preview behaviour — the moment the toggle changes, the same store pattern used throughout the app.

.. CG-EXPLANATION-END id=function:usePsdPreviewOn

