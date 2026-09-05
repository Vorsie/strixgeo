desktop.renderer.src.lib.streaflet.components.Marker
====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Marker.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Marker.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Marker.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the overlay factory (``createOverlayComponent``), and the shared event-inputs type.

**Why it is here.** A marker is a plain layer with no extra open/close behaviour, so it is built with the overlay factory (which is the base layer factory under another name — see the ``createLayerComponent`` and ``createOverlayComponent`` pages).

.. CG-EXPLANATION-END id=module-header

``interface MarkerProps``
-------------------------

.. CG-BLOCK id=interface:MarkerProps lines=6-16

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Marker.tsx
   :language: tsx
   :lines: 6-16
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MarkerProps

**What this does.** Declares the marker's inputs on top of the shared event inputs: a ``position`` point, an optional ``icon``, and optional ``draggable``, ``zIndexOffset``, ``opacity`` and ``pane`` settings.

**Why it is here.** These are the marker properties the app actually uses; a point marker's whole job is to sit at a position with an optional custom icon, which is why ``position`` is the only required one.

.. CG-EXPLANATION-END id=interface:MarkerProps

``const Marker``
----------------

.. CG-BLOCK id=const:Marker lines=17-38

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Marker.tsx
   :language: tsx
   :lines: 17-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:Marker

**What this does.** Builds the marker with a create step (make a Leaflet marker at the position, passing icon, draggable, z-order, opacity and pane) and an update step (move it, re-icon it, re-opacity it or re-order it when those inputs change).

**Why it is here.** Built by the ``createLayerComponent`` factory pattern via the overlay factory — see those pages. The two comments record a real defensive detail: ``icon`` and ``pane`` are passed only when actually provided, because handing Leaflet an empty value there wipes out its built-in default and crashes the marker's icon setup during testing.

.. CG-EXPLANATION-END id=const:Marker

