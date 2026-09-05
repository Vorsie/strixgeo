desktop.renderer.src.lib.streaflet.components.GeoJSON
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/GeoJSON.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/GeoJSON.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/GeoJSON.tsx
   :language: tsx
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the GeoJSON object type, the base layer factory (``createLayerComponent``), and the shared event-inputs type.

**Why it is here.** GeoJSON is a standard text format for describing geographic shapes; this wrapper turns such data into map layers, built on the base layer factory (see the ``createLayerComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface GeoJSONProps``
--------------------------

.. CG-BLOCK id=interface:GeoJSONProps lines=7-14

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/GeoJSON.tsx
   :language: tsx
   :lines: 7-14
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeoJSONProps

**What this does.** Declares its inputs on top of the shared event inputs: the ``data`` (a GeoJSON object), an optional ``style``, and two optional hooks — ``onEachFeature`` (run for each shape as it is added) and ``pointToLayer`` (decide how a point becomes a marker).

**Why it is here.** These mirror Leaflet's own GeoJSON options, so a caller who knows Leaflet passes the same things; ``style`` and the two hooks are what let the app control how imported geographic data is drawn and made interactive.

.. CG-EXPLANATION-END id=interface:GeoJSONProps

``const GeoJSON``
-----------------

.. CG-BLOCK id=const:GeoJSON lines=15-31

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/GeoJSON.tsx
   :language: tsx
   :lines: 15-31
   :lineno-match:

.. CG-EXPLANATION-START id=const:GeoJSON

**What this does.** Builds the component with a create step (make a Leaflet GeoJSON layer from the data, wiring style and the two hooks) and an update step (if the data changed, clear and re-add it; if the style changed, re-apply it).

**Why it is here.** Built by the ``createLayerComponent`` factory pattern — see that page. Replacing the data by clearing and re-adding, rather than trying to patch it in place, keeps the drawn shapes exactly matching the new data.

.. CG-EXPLANATION-END id=const:GeoJSON

