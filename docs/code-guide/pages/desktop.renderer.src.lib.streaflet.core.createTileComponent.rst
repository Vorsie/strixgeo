desktop.renderer.src.lib.streaflet.core.createTileComponent
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/createTileComponent.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/createTileComponent.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createTileComponent.tsx
   :language: tsx
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet's types under ``L``, four React building blocks (``forwardRef``, ``useRef``, ``useState``, ``useEffect``), the context reader, the event-binding helper, and the ref helper.

**Why it is here.** This is a sibling of the base layer factory (see the ``createLayerComponent`` page) for **tile and raster layers** — the background map tiles and pinned images. It attaches its layer straight to the map (rather than to the nearest group) and draws nothing itself, so it needs its own small factory instead of reusing the group-aware base one.

.. CG-EXPLANATION-END id=module-header

``interface TileFactory``
-------------------------

.. CG-BLOCK id=interface:TileFactory lines=7-12

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createTileComponent.tsx
   :language: tsx
   :lines: 7-12
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TileFactory

**What this does.** Declares the create/update recipe for a tile layer: ``createInstance`` builds the Leaflet tile object from the inputs and context, and an optional ``updateInstance`` applies changed inputs in place. Line 12 labels the factory below.

**Why it is here.** Same two-function recipe idea as the base layer factory on the ``createLayerComponent`` page — build once, then change in place — kept as its own type here because a tile layer attaches to the map itself and never carries child components.

.. CG-EXPLANATION-END id=interface:TileFactory

``function createTileComponent``
--------------------------------

.. CG-BLOCK id=function:createTileComponent lines=13-41

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createTileComponent.tsx
   :language: tsx
   :lines: 13-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:createTileComponent

**What this does.** Builds a tile-layer component. It reads the context, remembers the previous inputs in a ``ref``, builds the tile object exactly once, and on later redraws applies any changed inputs in place. A single ``useEffect`` adds the tile layer to the map when the component appears and removes it when it goes away. It then keeps the events in sync and points the forwarded ref at the tile object, and draws nothing on the page (``return null``).

**Why it is here.** A tile layer has no children and belongs directly on the map, so — unlike the base layer factory — it uses the plain ``addTo``/``remove`` pair and returns nothing to render. Everything else follows the same create-once, mutate-in-place discipline described on the ``createLayerComponent`` page. The cast on lines 17-19 is the same generic-variance technicality noted there: safe because the outer signature already fixes the inputs' type.

.. CG-EXPLANATION-END id=function:createTileComponent

