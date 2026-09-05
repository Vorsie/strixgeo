desktop.renderer.src.lib.streaflet.core.createControlComponent
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx
   :language: tsx
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports four React building blocks (``forwardRef``, ``useRef``, ``useState``, ``useEffect``), Leaflet's types under ``L``, the context reader, and the ref helper.

**Why it is here.** This is the sibling factory (see the ``createLayerComponent`` page) for **map controls** — the small on-screen widgets pinned to a corner of the map, such as the zoom buttons, scale bar and layer switcher. A control is not a layer, so it has its own factory.

.. CG-EXPLANATION-END id=module-header

``interface ControlProps``
--------------------------

.. CG-BLOCK id=interface:ControlProps lines=6-9

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx
   :language: tsx
   :lines: 6-9
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ControlProps

**What this does.** Declares the one input every control shares: an optional ``position`` naming which corner of the map it sits in.

**Why it is here.** Every control can be placed in a corner, so the choice belongs in a shared inputs shape that each specific control's inputs extend.

.. CG-EXPLANATION-END id=interface:ControlProps

``interface ControlFactory``
----------------------------

.. CG-BLOCK id=interface:ControlFactory lines=10-15

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx
   :language: tsx
   :lines: 10-15
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ControlFactory

**What this does.** Declares the create/update recipe for a control — ``createInstance`` to build the Leaflet control from its inputs, an optional ``updateInstance`` for later changes — and line 15 labels the factory below.

**Why it is here.** Same two-function recipe pattern as the other core factories (see the ``createLayerComponent`` page), specialised for controls because a control is added to the map with ``addControl`` rather than as a layer.

.. CG-EXPLANATION-END id=interface:ControlFactory

``function createControlComponent``
-----------------------------------

.. CG-BLOCK id=function:createControlComponent lines=16-44

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createControlComponent.tsx
   :language: tsx
   :lines: 16-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:createControlComponent

**What this does.** Builds a control component. It reads the context, remembers previous inputs in a ``ref``, and builds the control object exactly once. On redraw, if the corner ``position`` changed it moves the control, then runs any custom update. A single ``useEffect`` adds the control to the map on mount and removes it on unmount. It points the forwarded ref at the control and draws nothing itself.

**Why it is here.** Position is handled specially because moving a control is a distinct Leaflet call, and the rest follows the shared create-once, mutate-in-place discipline from the ``createLayerComponent`` page. The cast on lines 20-22 is the same safe generic-variance workaround noted on the other factory pages.

.. CG-EXPLANATION-END id=function:createControlComponent

