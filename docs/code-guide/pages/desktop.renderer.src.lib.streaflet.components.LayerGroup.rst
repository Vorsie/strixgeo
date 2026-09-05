desktop.renderer.src.lib.streaflet.components.LayerGroup
========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/LayerGroup.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/LayerGroup.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/LayerGroup.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the base layer factory (``createLayerComponent``), and the shared event-inputs type.

**Why it is here.** A layer group is itself a layer, so it is built with the base layer factory (see the ``createLayerComponent`` page).

.. CG-EXPLANATION-END id=module-header

``type LayerGroupProps``
------------------------

.. CG-BLOCK id=type:LayerGroupProps lines=6-8

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/LayerGroup.tsx
   :language: tsx
   :lines: 6-8
   :lineno-match:

.. CG-EXPLANATION-START id=type:LayerGroupProps

**What this does.** Says this component's inputs are exactly the shared event inputs, under its own name.

**Why it is here.** A layer group adds no settings of its own; the named type documents that it accepts the standard events and matches its siblings.

.. CG-EXPLANATION-END id=type:LayerGroupProps

``const LayerGroup``
--------------------

.. CG-BLOCK id=const:LayerGroup lines=9-11

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/LayerGroup.tsx
   :language: tsx
   :lines: 9-11
   :lineno-match:

.. CG-EXPLANATION-START id=const:LayerGroup

**What this does.** Builds the component with a single create step: make an empty Leaflet layer group. Child components placed inside attach to it, so they can be shown, hidden or removed together.

**Why it is here.** Built by the ``createLayerComponent`` factory pattern — see that page, which wires the child context so anything drawn inside joins this group.

.. CG-EXPLANATION-END id=const:LayerGroup

