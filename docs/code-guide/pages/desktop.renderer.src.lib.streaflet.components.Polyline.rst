desktop.renderer.src.lib.streaflet.components.Polyline
======================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Polyline.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Polyline.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Polyline.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the vector-shape factory (``createPathComponent``) with its shared inputs type.

**Why it is here.** A near-identical shape wrapper; needs only Leaflet and the shape factory (see the ``createPathComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface PolylineProps``
---------------------------

.. CG-BLOCK id=interface:PolylineProps lines=5-9

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Polyline.tsx
   :language: tsx
   :lines: 5-9
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PolylineProps

**What this does.** Declares its own inputs on top of the shared shape inputs: ``positions`` — the ordered list of points the line runs through.

**Why it is here.** A polyline is just an open sequence of connected points (for example a cross-section trace on the map), so the vertex list is all it adds.

.. CG-EXPLANATION-END id=interface:PolylineProps

``const Polyline``
------------------

.. CG-BLOCK id=const:Polyline lines=10-15

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Polyline.tsx
   :language: tsx
   :lines: 10-15
   :lineno-match:

.. CG-EXPLANATION-START id=const:Polyline

**What this does.** Builds the component by giving the shape factory a create step (make a Leaflet polyline from the points and style) and an update step (re-set the points if they changed).

**Why it is here.** Built by the ``createPathComponent`` factory pattern — see that page. Only the two polyline-specific lines live here.

.. CG-EXPLANATION-END id=const:Polyline

