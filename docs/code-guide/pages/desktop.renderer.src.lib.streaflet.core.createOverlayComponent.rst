desktop.renderer.src.lib.streaflet.core.createOverlayComponent
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/createOverlayComponent.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/createOverlayComponent.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createOverlayComponent.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet's types under ``L``, the base layer factory and its recipe type, and the shared event-inputs type. Line 5 records that overlays reuse the base layer lifecycle, and that popups and tooltips add their own open/close behaviour in their own files.

**Why it is here.** An **overlay** here means a layer that behaves like a normal layer with no extra machinery. Rather than inventing a second factory, this file simply reuses the base one (see the ``createLayerComponent`` page), so the shared name ``createOverlayComponent`` documents the intent without duplicating any logic.

.. CG-EXPLANATION-END id=module-header

``function createOverlayComponent``
-----------------------------------

.. CG-BLOCK id=function:createOverlayComponent lines=6-10

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createOverlayComponent.tsx
   :language: tsx
   :lines: 6-10
   :lineno-match:

.. CG-EXPLANATION-START id=function:createOverlayComponent

**What this does.** Builds an overlay component by handing the create/update recipe straight to the base layer factory, unchanged.

**Why it is here.** This is a one-line pass-through kept as its own name for readability: a component built with it reads as "an overlay" at the call site, while the actual create-once, add, mutate-in-place, event-bind and remove work all live in the base factory on the ``createLayerComponent`` page. The specialised open/close behaviour that popups and tooltips need is added in their own files, not here.

.. CG-EXPLANATION-END id=function:createOverlayComponent

