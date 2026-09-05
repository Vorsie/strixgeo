desktop.renderer.src.utils.sampleMarkersOnStore
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sampleMarkersOnStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sampleMarkersOnStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleMarkersOnStore.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds a tiny shared *store* for the section "Show samples" toggle — the same store pattern introduced on the ``psdPreviewOnStore`` page. The import brings in the ready-made boolean-store builder.

**Why it is here.** The comment records that the lab-sample extent markers draw on both the litho and the geotech axis, so a dense borehole corridor can carry a lot of them and the engineer needs a way to clear the view without leaving the section. It mirrors the borehole-preview store: a single value read by the canvas through *useSyncExternalStore*, module-global because only one section view is open at a time, defaulting on because the markers are data the user imported rather than an opt-in preview, and never saved — it resets on reload.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=18-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleMarkersOnStore.ts
   :language: typescript
   :lines: 18-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the holder, a boolean starting on.

**Why it is here.** It is the single shared value the readers below point at.

.. CG-EXPLANATION-END id=const:store

``function toggleSampleMarkersOn``
----------------------------------

.. CG-BLOCK id=function:toggleSampleMarkersOn lines=21-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleMarkersOnStore.ts
   :language: typescript
   :lines: 21-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleSampleMarkersOn

**What this does.** Flips the switch and tells subscribers it changed.

**Why it is here.** It is what the Display menu and the hotkey call to show or hide the markers.

.. CG-EXPLANATION-END id=function:toggleSampleMarkersOn

``function getSampleMarkersOn``
-------------------------------

.. CG-BLOCK id=function:getSampleMarkersOn lines=26-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleMarkersOnStore.ts
   :language: typescript
   :lines: 26-30
   :lineno-match:

.. CG-EXPLANATION-START id=function:getSampleMarkersOn

**What this does.** Reads the current value once, without subscribing.

**Why it is here.** It is for code that needs the value now and does not want to be redrawn when it later changes.

.. CG-EXPLANATION-END id=function:getSampleMarkersOn

``function setSampleMarkersOn``
-------------------------------

.. CG-BLOCK id=function:setSampleMarkersOn lines=31-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleMarkersOnStore.ts
   :language: typescript
   :lines: 31-35
   :lineno-match:

.. CG-EXPLANATION-START id=function:setSampleMarkersOn

**What this does.** Sets the switch to a given value.

**Why it is here.** The comment records this is the path the hotkey's test-reset uses to force a known state.

.. CG-EXPLANATION-END id=function:setSampleMarkersOn

``function useSampleMarkersOn``
-------------------------------

.. CG-BLOCK id=function:useSampleMarkersOn lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sampleMarkersOnStore.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSampleMarkersOn

**What this does.** The hook form: returns the current value and re-draws its caller when the switch flips.

**Why it is here.** The canvas uses this so it repaints, showing or hiding the markers, the moment the toggle changes.

.. CG-EXPLANATION-END id=function:useSampleMarkersOn

