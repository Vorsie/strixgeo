desktop.renderer.src.lib.streaflet.components.TileLayer
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/TileLayer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/TileLayer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/TileLayer.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the tile/raster factory (``createTileComponent``), and the shared event-inputs type.

**Why it is here.** The background map tiles are a raster layer attached straight to the map, so this uses the tile factory (see the ``createTileComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface TileLayerProps``
----------------------------

.. CG-BLOCK id=interface:TileLayerProps lines=5-17

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/TileLayer.tsx
   :language: tsx
   :lines: 5-17
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TileLayerProps

**What this does.** Declares its inputs on top of the shared event inputs: the tile ``url`` template, an ``attribution`` credit line, and optional ``opacity``, ``zIndex``, zoom limits, ``subdomains`` and ``pane``.

**Why it is here.** These mirror Leaflet's tile-layer options; the url template with its ``{z}/{x}/{y}`` placeholders is how a slippy tile service is addressed, and the rest tune how it blends and stacks.

.. CG-EXPLANATION-END id=interface:TileLayerProps

``const TileLayer``
-------------------

.. CG-BLOCK id=const:TileLayer lines=18-39

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/TileLayer.tsx
   :language: tsx
   :lines: 18-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:TileLayer

**What this does.** Builds the component with a create step (make a Leaflet tile layer from the url and options) and an update step (swap the url, re-blend the opacity, or re-order the layer when those change).

**Why it is here.** Built by the ``createTileComponent`` factory pattern — see that page. The two comments record the same defensive detail seen on the marker: ``subdomains`` and ``pane`` are passed only when actually provided, because an empty value there overwrites Leaflet's sensible default and crashes tile loading during testing.

.. CG-EXPLANATION-END id=const:TileLayer

