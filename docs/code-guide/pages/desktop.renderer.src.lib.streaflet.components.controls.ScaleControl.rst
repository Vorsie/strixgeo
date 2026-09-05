desktop.renderer.src.lib.streaflet.components.controls.ScaleControl
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/controls/ScaleControl.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/controls/ScaleControl.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/ScaleControl.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the control factory (``createControlComponent``) with its shared control-inputs type.

**Why it is here.** A control wrapper; needs only Leaflet and the control factory (see the ``createControlComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface ScaleControlProps``
-------------------------------

.. CG-BLOCK id=interface:ScaleControlProps lines=5-10

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/ScaleControl.tsx
   :language: tsx
   :lines: 5-10
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScaleControlProps

**What this does.** Declares its inputs on top of the shared control inputs: optional ``metric`` and ``imperial`` flags choosing which scale bars to show.

**Why it is here.** The scale bar shows distance on the map; letting metric and imperial be toggled independently covers the two unit systems.

.. CG-EXPLANATION-END id=interface:ScaleControlProps

``const ScaleControl``
----------------------

.. CG-BLOCK id=const:ScaleControl lines=11-21

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/ScaleControl.tsx
   :language: tsx
   :lines: 11-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:ScaleControl

**What this does.** Builds the control with a create step that makes a Leaflet scale control, passing position, metric and imperial only when actually provided.

**Why it is here.** Built by the ``createControlComponent`` factory pattern — see that page. Options are passed only when present for the same crash-avoidance reason as the other controls.

.. CG-EXPLANATION-END id=const:ScaleControl

