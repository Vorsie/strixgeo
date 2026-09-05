desktop.renderer.src.lib.streaflet.core.lifecycle
=================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports React's ``useEffect`` (which runs a side task after a redraw and can clean up after itself) and two Leaflet/React types. Line 5 opens the comment for the first helper.

**Why it is here.** This file holds the two small helpers that manage a layer's **lifecycle** — the three moments in a component's life: **mount** (it first appears), **update** (its inputs change while it is on screen), and **unmount** (it is removed). Both helpers below are built on ``useEffect`` because that is React's tool for doing something at exactly those moments and undoing it when the component leaves.

.. CG-EXPLANATION-END id=module-header

``function useLayerLifecycle``
------------------------------

.. CG-BLOCK id=function:useLayerLifecycle lines=6-19

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts
   :language: typescript
   :lines: 6-19
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLayerLifecycle

**What this does.** Adds a Leaflet layer to its container when the component appears, and removes it again when the component is taken away. If either the layer or the container changes, it removes the old pairing and re-adds under the new one.

**Why it is here.** This is the create-once rule's other half: the layer object itself is built once elsewhere, and this helper is solely responsible for putting it on the map and taking it off at the right moments. Because the cleanup step (removing the layer) runs automatically on unmount, a layer can never be orphaned on the map after its component is gone. Listing the layer and container as the effect's triggers means a re-parenting (for example moving a shape into a different group) is handled correctly rather than leaving a stray copy behind.

.. CG-EXPLANATION-END id=function:useLayerLifecycle

``function useImperativeInstance``
----------------------------------

.. CG-BLOCK id=function:useImperativeInstance lines=20-29

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/lifecycle.ts
   :language: typescript
   :lines: 20-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:useImperativeInstance

**What this does.** Points a forwarded ref at the live Leaflet object once the component is mounted, and resets it to empty when the component is removed. It copes with both forms a ref can take — a function to call, or a holder whose ``.current`` slot is filled.

**Why it is here.** A **ref** is a handle a parent component can hold to reach a child's underlying object. This helper is what makes ``forwardRef`` actually useful on a layer: after mounting, the parent's ref holds the real Leaflet marker or map, so it can command it directly (pan, open a popup) when it needs to; clearing the ref on unmount stops the parent from clutching a stale object that has already been removed from the map.

.. CG-EXPLANATION-END id=function:useImperativeInstance

