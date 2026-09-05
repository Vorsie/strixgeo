desktop.renderer.src.lib.streaflet.core.createPathComponent
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/createPathComponent.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/createPathComponent.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createPathComponent.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet's types under ``L``, the base layer factory (``createLayerComponent``) and its recipe type, and the shared event-inputs type. Line 5 opens the comment for the inputs shared by all vector shapes.

**Why it is here.** A **path** is Leaflet's word for a vector shape drawn with lines — a circle, polygon, rectangle or polyline, as opposed to a marker icon or a picture tile. This file is a thin specialisation of the base layer factory (see the ``createLayerComponent`` page) that adds one thing every vector shape shares: styling.

.. CG-EXPLANATION-END id=module-header

``interface PathProps``
-----------------------

.. CG-BLOCK id=interface:PathProps lines=6-15

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createPathComponent.tsx
   :language: tsx
   :lines: 6-15
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PathProps

**What this does.** Declares the inputs common to every vector shape on top of the shared event inputs: an optional ``style`` (colour, line width, fill, and so on) and an optional ``pane`` naming which drawing layer to render into. Lines 12-15 document the factory below: it wraps the base layer factory and applies ``style`` automatically on both create and update.

**Why it is here.** Gathering styling and pane choice in one shared inputs shape means every shape component — Circle, Polygon, Rectangle, Polyline — accepts them the same way, and the factory below applies them once for all of them, so no individual shape file repeats the styling code. A **pane** is a named stacking layer in Leaflet that controls what draws on top of what.

.. CG-EXPLANATION-END id=interface:PathProps

``function createPathComponent``
--------------------------------

.. CG-BLOCK id=function:createPathComponent lines=16-36

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createPathComponent.tsx
   :language: tsx
   :lines: 16-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:createPathComponent

**What this does.** Builds a vector-shape component. It calls the base layer factory (from the ``createLayerComponent`` page) but wraps the recipe so that: at construction, if a ``pane`` was named it is folded into the shape's build options, and any ``style`` is applied straight after building; and on update, after the shape's own update runs, a changed ``style`` is re-applied with Leaflet's ``setStyle``.

**Why it is here.** As the comment records, ``pane`` can only be set when a path is first constructed, so it is merged into the build options rather than applied later — and only when it was actually provided, because passing an empty ``pane`` would wipe out Leaflet's sensible default drawing layer. Threading style through this one wrapper means every vector shape gets consistent, in-place styling for free, honouring the same create-once, mutate-in-place rule the base factory enforces.

.. CG-EXPLANATION-END id=function:createPathComponent

