desktop.renderer.src.components.sections.SampleGeotechOverlay
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the overlay that draws one lab-sample marker per sample on a borehole column. Each marker is a vertical capsule spanning the sample's top-to-base depth. It imports the borehole and sample data types, the geotech body-selection store, the grain-size preview switch, the extent-span helper, and the translation helper.

**Why it is here.** The docstring records the decisions: a capsule at the exact depths because a lab result speaks for an interval, not a point (the mid-depth dot it replaced hid that); every sample draws whether or not a packing body was assigned it, so lab evidence stays visible on an un-subdivided section; the overlay mounts on both the litho and geotech axes but the body-selection click is geotech-only; and the horizontal position uses the warp-aware transform, never the raw one, so markers stay aligned at any spacing.

.. CG-EXPLANATION-END id=module-header

``const MARKER_WIDTH``
----------------------

.. CG-BLOCK id=const:MARKER_WIDTH lines=37-38

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 37-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_WIDTH

**What this does.** The drawn width of an unselected marker bar, 8 px.

**Why it is here.** The resting width of the capsule; the wider selected width below is the size cue for selection.

.. CG-EXPLANATION-END id=const:MARKER_WIDTH

``const MARKER_WIDTH_SELECTED``
-------------------------------

.. CG-BLOCK id=const:MARKER_WIDTH_SELECTED lines=39-48

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 39-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_WIDTH_SELECTED

**What this does.** The drawn width when the marker's packing body is selected, 12 px.

**Why it is here.** The comment notes width is the second, non-hue selection cue (WCAG 1.4.1) — selection is shown by both colour and size so it is not signalled by colour alone.

.. CG-EXPLANATION-END id=const:MARKER_WIDTH_SELECTED

``const MARKER_CORNER_RADIUS``
------------------------------

.. CG-BLOCK id=const:MARKER_CORNER_RADIUS lines=49-57

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 49-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_CORNER_RADIUS

**What this does.** The corner radius of the marker bar, a small fixed 1.5 px.

**Why it is here.** The docstring: deliberately a constant, never half the width, because nearly every real sample is 0.35-0.5 m and sits at the minimum-height floor, where a fully-rounded bar would be a circle — the owner's 'those dots are still there, not nice rectangular marks' (dogfeed 14 August 2026). The marker must read as a rectangle spanning the interval at every zoom.

.. CG-EXPLANATION-END id=const:MARKER_CORNER_RADIUS

``const MARKER_COLOR``
----------------------

.. CG-BLOCK id=const:MARKER_COLOR lines=58-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 58-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_COLOR

**What this does.** The fill for every sample marker, teal.

**Why it is here.** The docstring cites the owner (14 August 2026 night): one style regardless of packing body, because samples only exist on boreholes and only gain a body through the CPT pipeline, so body-less is the normal resting state, not a variant.

.. CG-EXPLANATION-END id=const:MARKER_COLOR

``const MARKER_COLOR_SELECTED``
-------------------------------

.. CG-BLOCK id=const:MARKER_COLOR_SELECTED lines=60-61

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 60-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_COLOR_SELECTED

**What this does.** The fill for a marker whose body is currently selected, amber.

**Why it is here.** Amber is the selection highlight, paired with the wider width so selection reads without relying on colour.

.. CG-EXPLANATION-END id=const:MARKER_COLOR_SELECTED

``const MARKER_STROKE``
-----------------------

.. CG-BLOCK id=const:MARKER_STROKE lines=62-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 62-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:MARKER_STROKE

**What this does.** The outline colour of every marker, white.

**Why it is here.** A white outline separates the capsule from the coloured band behind it so it stays visible on any fill.

.. CG-EXPLANATION-END id=const:MARKER_STROKE

``const MIN_MARKER_HEIGHT``
---------------------------

.. CG-BLOCK id=const:MIN_MARKER_HEIGHT lines=69-73

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 69-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_MARKER_HEIGHT

**What this does.** The minimum drawn height of a marker, 6 px.

**Why it is here.** The docstring: a spot sample has zero extent and a thin sample collapses below a pixel when zoomed out, so without this floor both would vanish.

.. CG-EXPLANATION-END id=const:MIN_MARKER_HEIGHT

``const HIT_SIZE``
------------------

.. CG-BLOCK id=const:HIT_SIZE lines=74-80

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 74-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:HIT_SIZE

**What this does.** The size of the invisible click-target rectangle around each marker, 24 px.

**Why it is here.** The comment cites WCAG 2.5.8, which requires a hit target of at least 24 px in both directions.

.. CG-EXPLANATION-END id=const:HIT_SIZE

``interface HoveredSample``
---------------------------

.. CG-BLOCK id=interface:HoveredSample lines=81-100

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 81-100
   :lineno-match:

.. CG-EXPLANATION-START id=interface:HoveredSample

**What this does.** The named shape the overlay reports to its parent when the cursor enters a marker: the sample, the borehole name, the marker's screen centre, and whether clicking it would actually highlight a packing body.

**Why it is here.** The comment explains the last field: only the overlay knows both halves — the sample carries a body AND this axis allows the gesture — so it reports its own verdict, and the hover card prints its 'click to highlight' line from this and must never promise a click that does nothing.

.. CG-EXPLANATION-END id=interface:HoveredSample

``interface SampleGeotechOverlayProps``
---------------------------------------

.. CG-BLOCK id=interface:SampleGeotechOverlayProps lines=101-152

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 101-152
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleGeotechOverlayProps

**What this does.** The inputs: the placed borehole columns, the borehole detail map (or null while loading), the warp-aware x transform, the elevation-to-screen transform, the plot top and bottom, whether a marker click toggles body selection, and an optional hover callback.

**Why it is here.** The comments make two rules explicit: the x transform must be the warp-aware one, the same every other overlay uses; and the body-click switch is required rather than defaulted so a new mount cannot silently inherit the geotech gesture on an axis that has no packing bodies to select.

.. CG-EXPLANATION-END id=interface:SampleGeotechOverlayProps

``function SampleGeotechOverlay``
---------------------------------

.. CG-BLOCK id=function:SampleGeotechOverlay lines=153-309

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/SampleGeotechOverlay.tsx
   :language: tsx
   :lines: 153-309
   :lineno-match:

.. CG-EXPLANATION-START id=function:SampleGeotechOverlay

**What this does.** The component. It reads the current body selection and works out whether the richer hover card can take over from the native tooltip. It returns a loading group while the borehole details are absent. Otherwise, for each borehole column it looks up its detail and draws each sample as a capsule: it computes the screen span, drops a marker wholly outside the plot and trims one that straddles an edge, marks it selected and clickable only when it carries a body and the axis allows it, and draws an invisible hit rectangle (never smaller than the WCAG floor) below a visible capsule that ignores the mouse. Clicking or pressing Enter toggles the body selection; entering or leaving fires the hover callback.

**Why it is here.** The comments explain the tooltip handling: the OS draws the native tooltip on top of the grain-size card, so the tooltip yields whenever the card can take over (the card is richer and already carries the sample number and depth), and returns only when the card is switched off. The invisible hit rectangle sits below the visible capsule in z-order and the capsule ignores the mouse so every click reaches the hit rectangle, meeting the 24-px target without fattening the visible mark.

.. CG-EXPLANATION-END id=function:SampleGeotechOverlay

