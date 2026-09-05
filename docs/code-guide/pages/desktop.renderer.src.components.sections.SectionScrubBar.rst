desktop.renderer.src.components.sections.SectionScrubBar
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/SectionScrubBar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/SectionScrubBar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScrubBar.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the scrub bar — a thin horizontal navigation strip under the section for fast panning across a long profile. It imports React's ref hook and the translation helper.

**Why it is here.** The docstring records the decisions: the track runs from the leftmost test's along-position to the rightmost test's, not from zero to the full section length, because engineers rarely need to scroll into the empty tails; a coloured handle shows the current viewport window; dragging pans and clicking the track recentres; and vertical zoom is left untouched.

.. CG-EXPLANATION-END id=module-header

``function SectionScrubBar``
----------------------------

.. CG-BLOCK id=function:SectionScrubBar lines=26-140

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SectionScrubBar.tsx
   :language: tsx
   :lines: 26-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionScrubBar

**What this does.** The component. It computes the data span and returns nothing when it is empty. It expresses the current viewport as start and end percentages of the data range (clamped to 0-100), floors the handle width at 2 percent so it stays grabbable when fully zoomed in, and wires the drag: mousedown records the offset between cursor and handle centre so the handle does not jump, mousemove reports the new centre, mouseup cleans up; a click on the track outside the handle recentres there. It renders the leftmost and rightmost data labels and the draggable handle.

**Why it is here.** The comments explain the choices: end labels show the outer data bounds (not the viewport edges) so the engineer can see at a glance whether they are looking at the head, middle, or tail of the section (dogfeed 31 May 2026); the grab-offset lets the user grab anywhere on the handle without it snapping to the cursor; and the handle's own mousedown stops the event so a handle grab does not also fire the track's recentre.

.. CG-EXPLANATION-END id=function:SectionScrubBar

