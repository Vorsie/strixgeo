desktop.renderer.src.lib.streaflet.components.CircleMarker
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/CircleMarker.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/CircleMarker.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/CircleMarker.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the vector-shape factory (``createPathComponent``) with its shared inputs type.

**Why it is here.** A near-identical shape wrapper; needs only Leaflet and the shape factory (see the ``createPathComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface CircleMarkerProps``
-------------------------------

.. CG-BLOCK id=interface:CircleMarkerProps lines=5-10

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/CircleMarker.tsx
   :language: tsx
   :lines: 5-10
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CircleMarkerProps

**What this does.** Declares its own inputs on top of the shared shape inputs: a ``center`` point and an optional ``radius`` given in pixels.

**Why it is here.** A circle marker differs from a plain circle only in that its radius is a fixed size on screen (pixels) rather than a distance on the ground (metres), so it stays the same visual size at any zoom.

.. CG-EXPLANATION-END id=interface:CircleMarkerProps

``const CircleMarker``
----------------------

.. CG-BLOCK id=const:CircleMarker lines=11-18

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/CircleMarker.tsx
   :language: tsx
   :lines: 11-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:CircleMarker

**What this does.** Builds the component by giving the shape factory a create step (make a Leaflet circle marker at the centre with the pixel radius) and an update step (move it if the centre changed, resize it if the radius changed).

**Why it is here.** Built by the ``createPathComponent`` factory pattern — see that page. Only the two marker-specific lines live here.

.. CG-EXPLANATION-END id=const:CircleMarker

