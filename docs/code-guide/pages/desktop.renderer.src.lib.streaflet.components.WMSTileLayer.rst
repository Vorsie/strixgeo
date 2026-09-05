desktop.renderer.src.lib.streaflet.components.WMSTileLayer
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/WMSTileLayer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/WMSTileLayer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/WMSTileLayer.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the tile/raster factory (``createTileComponent``), and the shared event-inputs type.

**Why it is here.** A WMS layer is a raster layer attached straight to the map, so this uses the tile factory (see the ``createTileComponent`` page). WMS is a standard web protocol map servers use to return map images for a requested area.

.. CG-EXPLANATION-END id=module-header

``interface WMSTileLayerProps``
-------------------------------

.. CG-BLOCK id=interface:WMSTileLayerProps lines=5-18

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/WMSTileLayer.tsx
   :language: tsx
   :lines: 5-18
   :lineno-match:

.. CG-EXPLANATION-START id=interface:WMSTileLayerProps

**What this does.** Declares its inputs on top of the shared event inputs: the service ``url``, the ``layers`` to request, and optional ``format``, ``transparent``, ``version``, ``attribution``, ``opacity``, ``zIndex`` and ``pane``.

**Why it is here.** These are the parameters a WMS server expects; ``layers`` names which published map layers to fetch, and ``transparent`` plus ``format`` control blending over the base map.

.. CG-EXPLANATION-END id=interface:WMSTileLayerProps

``const WMSTileLayer``
----------------------

.. CG-BLOCK id=const:WMSTileLayer lines=19-37

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/WMSTileLayer.tsx
   :language: tsx
   :lines: 19-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:WMSTileLayer

**What this does.** Builds the component with a create step (make a Leaflet WMS layer from the url and parameters, defaulting the image format to PNG) and an update step (re-blend the opacity, or re-request when the chosen layers change).

**Why it is here.** Built by the ``createTileComponent`` factory pattern — see that page. As on the other tile layers, ``pane`` is passed only when provided so an empty value cannot wipe out Leaflet's default drawing layer.

.. CG-EXPLANATION-END id=const:WMSTileLayer

