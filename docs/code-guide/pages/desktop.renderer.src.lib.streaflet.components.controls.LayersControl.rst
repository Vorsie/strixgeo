desktop.renderer.src.lib.streaflet.components.controls.LayersControl
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/controls/LayersControl.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/controls/LayersControl.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/LayersControl.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the control factory (``createControlComponent``) with its shared control-inputs type.

**Why it is here.** A control wrapper; needs only Leaflet and the control factory (see the ``createControlComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface LayersControlProps``
--------------------------------

.. CG-BLOCK id=interface:LayersControlProps lines=5-11

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/LayersControl.tsx
   :language: tsx
   :lines: 5-11
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LayersControlProps

**What this does.** Declares its inputs on top of the shared control inputs: ``baseLayers`` and ``overlays`` — each a named set of layers — and an optional ``collapsed`` flag.

**Why it is here.** The layer switcher lets the user pick one background (base layer) and toggle extra overlays; giving each as a name-to-layer set is how Leaflet labels the choices in the widget.

.. CG-EXPLANATION-END id=interface:LayersControlProps

``const LayersControl``
-----------------------

.. CG-BLOCK id=const:LayersControl lines=12-21

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/LayersControl.tsx
   :language: tsx
   :lines: 12-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:LayersControl

**What this does.** Builds the control with a create step that makes a Leaflet layers control from the base layers and overlays, passing position and the collapsed flag only when actually provided.

**Why it is here.** Built by the ``createControlComponent`` factory pattern — see that page. Options are passed only when present for the same reason as the other controls: an empty ``position`` would wipe out Leaflet's default and crash when the control is added.

.. CG-EXPLANATION-END id=const:LayersControl

