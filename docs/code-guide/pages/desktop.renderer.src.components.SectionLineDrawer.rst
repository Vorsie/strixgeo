desktop.renderer.src.components.SectionLineDrawer
=================================================

.. CG-PAGE source=desktop/src/renderer/src/components/SectionLineDrawer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/SectionLineDrawer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionLineDrawer.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports — ``useEffect`` and ``useRef`` from React, the ``useMap`` hook from the app's Leaflet wrapper, and Leaflet itself.

**Why it is here.** This is the two-click tool for placing a cross-section line; like the box drawer it uses ``useMap`` because it must live inside the map to reach the live Leaflet instance.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=5-38

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionLineDrawer.tsx
   :language: tsx
   :lines: 5-38
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs — an ``active`` flag, an ``onLineDrawn`` handler fired with the two endpoints, and an ``onCancel`` handler — plus the component docstring.

**Why it is here.** The endpoints are reported in WGS84 (Leaflet's native system), and the docstring notes the caller converts them to the project's horizontal EPSG before POSTing the new section to ``/sections`` — the frontend always goes through the API. The docstring also records that map dragging stays enabled (the user may need to pan for the second point) and that stray marker clicks are blocked so a click does not double-fire the drawer.

.. CG-EXPLANATION-END id=interface:Props

``function SectionLineDrawer``
------------------------------

.. CG-BLOCK id=function:SectionLineDrawer lines=39-120

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionLineDrawer.tsx
   :language: tsx
   :lines: 39-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionLineDrawer

**What this does.** The component. It keeps refs to the start point, a start marker and the preview line. In an effect that runs while ``active`` is true, it sets a crosshair cursor; the first click pins the start as a small red circle and opens a rubber-band preview line that follows the mouse; the second click finalises and fires ``onLineDrawn``; and Escape cancels. A cleanup removes the layers and listeners and restores the cursor. It draws nothing itself, so it returns null.

**Why it is here.** The Leaflet layers live in refs so React's development double-mount cannot leak duplicate preview lines (docstring). The start marker and preview line are pinned to the investigation-markers pane because the default vector pane is hidden under the Geopunt reference overlay in this app — the same pane reasoning as the markers (comment). The coordinates stay WGS84; the caller converts and POSTs the section.

.. CG-EXPLANATION-END id=function:SectionLineDrawer

