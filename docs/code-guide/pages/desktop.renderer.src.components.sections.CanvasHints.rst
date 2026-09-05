desktop.renderer.src.components.sections.CanvasHints
====================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/CanvasHints.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/CanvasHints.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CanvasHints.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The whole file for the small cheat pill in the bottom-left of the section canvas. Its documentation lists the inputs; the only import is the translation helper. It always shows the pan and zoom gestures, and adds extra lines depending on the axis (the model level) being edited and whether certain actions are currently blocked.

**Why it is here.** These gestures — especially the Alt+drag copy on the litho ghost layer — are otherwise undiscoverable (debt #95); a passive hint pill closes that discoverability gap. The two conditional hints surface a silent no-op: entering correlate mode with no contacts to click (debt #139), or the geotech model not built yet, so the failure is explained rather than left mysterious.

.. CG-EXPLANATION-END id=module-header

``function CanvasHints``
------------------------

.. CG-BLOCK id=function:CanvasHints lines=26-76

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/CanvasHints.tsx
   :language: tsx
   :lines: 26-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:CanvasHints

**What this does.** The component. It reads the translated hint text and returns a small pill fixed to the bottom-left corner. It always shows the pan/zoom line and a line pointing to the F1 gesture cheatsheet, then conditionally adds a litho-gesture line on the litho axis, a 'accept a litho unit first' hint when correlate mode is blocked, and a 'build the geotech model first' hint on the geotech axis when it is unbuilt.

**Why it is here.** The pill's colours come from CSS variables rather than the usual utility classes because it renders over the dark plot chrome, where the standard light-mode styling would be invisible. The two amber emphasis hints draw the eye without implying an error. The pill ignores pointer events so it never intercepts a gesture aimed at the canvas beneath it.

.. CG-EXPLANATION-END id=function:CanvasHints

