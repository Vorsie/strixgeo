desktop.renderer.src.lib.streaflet.components.ImageOverlay
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/ImageOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/ImageOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/ImageOverlay.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the tile/raster factory (``createTileComponent``), and the shared event-inputs type.

**Why it is here.** A pinned image behaves like a raster layer attached straight to the map, so it uses the tile factory (see the ``createTileComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface ImageOverlayProps``
-------------------------------

.. CG-BLOCK id=interface:ImageOverlayProps lines=6-13

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/ImageOverlay.tsx
   :language: tsx
   :lines: 6-13
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ImageOverlayProps

**What this does.** Declares its inputs on top of the shared event inputs: an image ``url``, the ``bounds`` box the image is pinned to, and optional ``opacity`` and ``zIndex`` (stacking order).

**Why it is here.** A georeferenced image needs a source and the ground rectangle it maps onto; opacity and stacking order let it be blended over the base map.

.. CG-EXPLANATION-END id=interface:ImageOverlayProps

``const ImageOverlay``
----------------------

.. CG-BLOCK id=const:ImageOverlay lines=14-25

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/ImageOverlay.tsx
   :language: tsx
   :lines: 14-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:ImageOverlay

**What this does.** Builds the component with a create step (make a Leaflet image overlay from the url and bounds) and an update step (swap the image if the url changed, move it if the bounds changed, re-blend it if the opacity changed).

**Why it is here.** Built by the ``createTileComponent`` factory pattern — see that page. The comment records that changing the bounds normalises the box to a concrete bounds value first, because Leaflet's bounds-setter needs the built form rather than the loose input form.

.. CG-EXPLANATION-END id=const:ImageOverlay

