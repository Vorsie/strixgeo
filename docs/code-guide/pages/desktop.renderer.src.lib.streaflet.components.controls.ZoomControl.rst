desktop.renderer.src.lib.streaflet.components.controls.ZoomControl
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/controls/ZoomControl.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/controls/ZoomControl.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/ZoomControl.tsx
   :language: tsx
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L`` and the control factory (``createControlComponent``) with its shared control-inputs type.

**Why it is here.** A control wrapper; needs only Leaflet and the control factory (see the ``createControlComponent`` page).

.. CG-EXPLANATION-END id=module-header

``type ZoomControlProps``
-------------------------

.. CG-BLOCK id=type:ZoomControlProps lines=5-7

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/ZoomControl.tsx
   :language: tsx
   :lines: 5-7
   :lineno-match:

.. CG-EXPLANATION-START id=type:ZoomControlProps

**What this does.** Says this control's inputs are exactly the shared control inputs (just the corner position), under its own name.

**Why it is here.** The zoom buttons need no settings beyond which corner they sit in, so no extra inputs are added.

.. CG-EXPLANATION-END id=type:ZoomControlProps

``const ZoomControl``
---------------------

.. CG-BLOCK id=const:ZoomControl lines=8-15

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/controls/ZoomControl.tsx
   :language: tsx
   :lines: 8-15
   :lineno-match:

.. CG-EXPLANATION-START id=const:ZoomControl

**What this does.** Builds the control with a create step that makes a Leaflet zoom control, passing the corner position only when actually provided.

**Why it is here.** Built by the ``createControlComponent`` factory pattern — see that page. The comment spells out the crash this avoids: Leaflet copies options with a plain loop, so an empty ``position`` overwrites its default ``'topleft'`` and then crashes when the control is added — the same conditional-passing convention used across the tile layers and controls.

.. CG-EXPLANATION-END id=const:ZoomControl

