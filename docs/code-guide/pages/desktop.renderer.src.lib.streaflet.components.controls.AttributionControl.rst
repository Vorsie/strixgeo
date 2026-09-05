desktop.renderer.src.lib.streaflet.components.controls.AttributionControl
=========================================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/controls/AttributionControl.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/controls/AttributionControl.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/AttributionControl.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the control factory (``createControlComponent``) with its shared control-inputs type.

**Why it is here.** A control wrapper; needs only Leaflet and the control factory (see the ``createControlComponent`` page).

.. CG-EXPLANATION-END id=module-header

``interface AttributionControlProps``
-------------------------------------

.. CG-BLOCK id=interface:AttributionControlProps lines=5-9

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/AttributionControl.tsx
   :language: tsx
   :lines: 5-9
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AttributionControlProps

**What this does.** Declares its input on top of the shared control inputs: an optional ``prefix`` (the small credit text, or ``false`` to hide it).

**Why it is here.** The attribution box shows data credits; the prefix is the only thing worth varying, and allowing ``false`` lets it be switched off.

.. CG-EXPLANATION-END id=interface:AttributionControlProps

``const AttributionControl``
----------------------------

.. CG-BLOCK id=const:AttributionControl lines=10-22

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/AttributionControl.tsx
   :language: tsx
   :lines: 10-22
   :lineno-match:

.. CG-EXPLANATION-START id=const:AttributionControl

**What this does.** Builds the control with a create step that makes a Leaflet attribution control, passing position and prefix only when they were actually provided.

**Why it is here.** Built by the ``createControlComponent`` factory pattern — see that page. The comment records why options are passed only when present: handing Leaflet an empty ``position`` overwrites its built-in default and crashes when the control is added, so the file uses the same conditional-passing convention as the tile layers.

.. CG-EXPLANATION-END id=const:AttributionControl

