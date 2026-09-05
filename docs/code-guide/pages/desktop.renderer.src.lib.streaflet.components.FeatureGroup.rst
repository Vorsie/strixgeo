desktop.renderer.src.lib.streaflet.components.FeatureGroup
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/FeatureGroup.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/FeatureGroup.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/FeatureGroup.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, the base layer factory (``createLayerComponent``), and the shared event-inputs type.

**Why it is here.** A feature group is itself a layer, so it is built with the base layer factory (see the ``createLayerComponent`` page).

.. CG-EXPLANATION-END id=module-header

``type FeatureGroupProps``
--------------------------

.. CG-BLOCK id=type:FeatureGroupProps lines=6-8

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/FeatureGroup.tsx
   :language: tsx
   :lines: 6-8
   :lineno-match:

.. CG-EXPLANATION-START id=type:FeatureGroupProps

**What this does.** Says this component's inputs are exactly the shared event inputs, under its own name.

**Why it is here.** A feature group adds no settings of its own; naming the type keeps the file consistent with its siblings and documents that it accepts the standard events.

.. CG-EXPLANATION-END id=type:FeatureGroupProps

``const FeatureGroup``
----------------------

.. CG-BLOCK id=const:FeatureGroup lines=9-11

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/FeatureGroup.tsx
   :language: tsx
   :lines: 9-11
   :lineno-match:

.. CG-EXPLANATION-START id=const:FeatureGroup

**What this does.** Builds the component with a single create step: make an empty Leaflet feature group. Child components placed inside attach to it.

**Why it is here.** Built by the ``createLayerComponent`` factory pattern — see that page, which handles the child-context wiring so anything drawn inside joins this group. A feature group differs from a plain layer group in that it re-fires its children's events as its own, which is why it is evented.

.. CG-EXPLANATION-END id=const:FeatureGroup

