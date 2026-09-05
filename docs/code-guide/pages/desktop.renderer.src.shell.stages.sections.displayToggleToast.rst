desktop.renderer.src.shell.stages.sections.displayToggleToast
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the little helper that composes the toast messages the display-toggle hotkeys announce, and holds the keys that keep each toggle to a single toast.

**Why it is here.** Owner dogfeed 2026-08-15: hammering the same hotkey stacked identical toasts down the right of the screen; a recurring toast should replace the previous one, not pile up. So each hotkey hands the toast system a stable 'replace key' and the stack never grows past one entry per toggle. The keys are named constants here, not literals at the call sites, so two different toggles can never accidentally share one.

.. CG-EXPLANATION-END id=module-header

``const SAMPLE_MARKERS_TOAST_KEY``
----------------------------------

.. CG-BLOCK id=const:SAMPLE_MARKERS_TOAST_KEY lines=23-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 23-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_MARKERS_TOAST_KEY

**What this does.** The replace key for the bare-P sample-markers announcement.

**Why it is here.** A stable string so repeated P presses update one toast in place.

.. CG-EXPLANATION-END id=const:SAMPLE_MARKERS_TOAST_KEY

``const LITHO_FILL_TOAST_KEY``
------------------------------

.. CG-BLOCK id=const:LITHO_FILL_TOAST_KEY lines=32-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 32-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHO_FILL_TOAST_KEY

**What this does.** The replace key for the bare-L litho-fill announcement — deliberately ONE key across both axes.

**Why it is here.** The engineer sees a single litho-fill toggle, so switching axis mid-hammering should still update the toast he is reading rather than open a second one beside it.

.. CG-EXPLANATION-END id=const:LITHO_FILL_TOAST_KEY

``const GEOTECH_FILL_TOAST_KEY``
--------------------------------

.. CG-BLOCK id=const:GEOTECH_FILL_TOAST_KEY lines=41-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 41-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOTECH_FILL_TOAST_KEY

**What this does.** The replace key for the bare-F packing-fill announcement.

**Why it is here.** Distinct from the litho-fill key on purpose: on the geotech axis both fills exist at once, and sharing a key would make F wipe the line L just wrote — two toggles reporting as one.

.. CG-EXPLANATION-END id=const:GEOTECH_FILL_TOAST_KEY

``function sampleMarkersToastMessage``
--------------------------------------

.. CG-BLOCK id=function:sampleMarkersToastMessage lines=49-64

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 49-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:sampleMarkersToastMessage

**What this does.** Returns 'Sample markers on' or 'Sample markers off' from the new toggle state.

**Why it is here.** The state a click moved TO is what the engineer needs to read, since the menu item's own label flip is invisible with the menu closed.

.. CG-EXPLANATION-END id=function:sampleMarkersToastMessage

``function lithoFillToastMessage``
----------------------------------

.. CG-BLOCK id=function:lithoFillToastMessage lines=65-79

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 65-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoFillToastMessage

**What this does.** Composes the bare-L announcement for whichever axis the view is on — 'Litho fill …' on the geotech axis, 'Band fill …' on the litho axis.

**Why it is here.** The two axes gate the same fill through differently-named menu items ('Show litho fill' vs 'Fill bands'), so the announcement names the fill the way that axis's own menu does, or the toast and the menu item read as two different toggles.

.. CG-EXPLANATION-END id=function:lithoFillToastMessage

``function geotechFillToastMessage``
------------------------------------

.. CG-BLOCK id=function:geotechFillToastMessage lines=80-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/displayToggleToast.ts
   :language: typescript
   :lines: 80-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechFillToastMessage

**What this does.** Returns 'Packing fill on' / 'Packing fill off' for the geotech axis's NAD fill.

**Why it is here.** Named 'Packing fill' rather than a bare 'Fill' because the geotech Display menu offers both a packing fill and a litho fill, so 'Fill on' would not say which of the two moved.

.. CG-EXPLANATION-END id=function:geotechFillToastMessage

