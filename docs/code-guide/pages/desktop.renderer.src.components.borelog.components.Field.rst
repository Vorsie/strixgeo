desktop.renderer.src.components.borelog.components.Field
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/Field.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/Field.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/Field.tsx
   :language: tsx
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one import and its documentation comment. The comment says this is the small label-over-value pair used by the header strip for the boring name, coordinates, elevation, depth, executor and so on, and it names two visual modifiers: ``bold`` to emphasise the borehole name, and ``warn`` to render a value in amber italic for a missing elevation. It notes the component has no state and no events — pure presentational chrome.

**Why it is here.** A single tiny reusable piece keeps every field in the header looking the same, following the shared-primitive idea introduced on the ``desktop.renderer.src.components.ui.Button`` page. The amber warning colour is the app's attention colour, chosen so the user sees at once that a real elevation fix is needed before the log can draw an absolute-level axis — amber, never red.

.. CG-EXPLANATION-END id=module-header

``function Field``
------------------

.. CG-BLOCK id=function:Field lines=19-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/Field.tsx
   :language: tsx
   :lines: 19-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:Field

**What this does.** The component. It draws a small uppercase label above its value; the value is bold when ``bold`` is set and amber italic when ``warn`` is set.

**Why it is here.** It holds no data of its own and reacts to nothing — it only arranges a label and a value — so it is a pure presentational helper the header composes many times. The amber-italic warn styling is the missing-value signal described in the header, kept distinct from the red the app reserves for errors.

.. CG-EXPLANATION-END id=function:Field

