desktop.renderer.src.components.BboxDrawer
==========================================

.. CG-PAGE source=desktop/src/renderer/src/components/BboxDrawer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/BboxDrawer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/components/BboxDrawer.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports — ``useEffect`` and ``useRef`` from React, the ``useMap`` hook from the app's Leaflet wrapper, and Leaflet itself.

**Why it is here.** This is the rectangle-draw tool used to pick a bounding box for a DOV import; it uses ``useMap`` because it must live inside the map to reach the live Leaflet instance.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=5-16

.. literalinclude:: ../../../desktop/src/renderer/src/components/BboxDrawer.tsx
   :language: tsx
   :lines: 5-16
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs — an ``active`` flag for whether drawing is on, an ``onBboxDrawn`` handler fired with the drawn box as (west, south, east, north), and an ``onCancel`` handler — plus the component docstring.

**Why it is here.** The docstring records the behaviour: an invisible component that must live inside the map, which when active switches the cursor to a crosshair, lets the user drag a rectangle, and fires the box in WGS84 on release, with Escape to cancel. The box is reported in WGS84 (Leaflet's own system) and the caller converts it to the project's CRS for the actual DOV query.

.. CG-EXPLANATION-END id=interface:Props

``function BboxDrawer``
-----------------------

.. CG-BLOCK id=function:BboxDrawer lines=17-91

.. literalinclude:: ../../../desktop/src/renderer/src/components/BboxDrawer.tsx
   :language: tsx
   :lines: 17-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:BboxDrawer

**What this does.** The component. It keeps refs to the drawn rectangle and its start corner. In an effect that runs while ``active`` is true, it turns off Leaflet's pan and sets a crosshair cursor, then: on mouse-down it pins the start corner and creates a dashed blue rectangle; on mouse-move it resizes that rectangle; on mouse-up it fires ``onBboxDrawn`` with the box's south-west and north-east corners, or cancels if the box is invalid; and Escape cancels. A cleanup routine removes the listeners, re-enables pan, restores the cursor and removes the rectangle. It draws nothing itself, so it returns null.

**Why it is here.** The rectangle and its start corner live in refs so a redraw never recreates them mid-drag, and the cleanup runs both when drawing is switched off and when the component unmounts so no event listener or leftover rectangle is ever left behind. The reported box is WGS84; the caller projects it to the project's CRS before querying DOV.

.. CG-EXPLANATION-END id=function:BboxDrawer

