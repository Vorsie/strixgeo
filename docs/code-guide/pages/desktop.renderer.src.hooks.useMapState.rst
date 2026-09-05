desktop.renderer.src.hooks.useMapState
======================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useMapState.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useMapState.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapState.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports (three React hooks, the map library's bounds type, and the borehole-axis type). This file owns the map's view state: which marker layers are hidden, which axis the borehole legend is grouped by, the current viewport bounds, and the map camera.

**Why it is here.** These are all visual-filter controls shared by both the map view and the sidebar — a change made in one must show up in the other — so neither component can own them alone; grouping them in one hook is what keeps the two in step (comment).

.. CG-EXPLANATION-END id=module-header

``interface UseMapStateResult``
-------------------------------

.. CG-BLOCK id=interface:UseMapStateResult lines=12-52

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapState.ts
   :language: typescript
   :lines: 12-52
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseMapStateResult

**What this does.** The shape the hook hands back: the set of currently hidden CPT-type labels, the borehole grouping axis, the per-axis sets of hidden borehole values, the current viewport bounds (or null before the map has reported), a *ref* holding the last map camera, and callbacks to toggle a CPT type, toggle a borehole value, switch the axis, and record viewport and camera changes. These lines also carry the hook's documentation.

**Why it is here.** Naming the whole surface documents what the map and sidebar share. The doc records two deliberate choices: layer visibility is tracked as a HIDDEN set so an empty set means ``show everything`` — which avoids a first-render flash whenever a new marker type appears — and the camera is kept in a ref so updating it does not force a redraw.

.. CG-EXPLANATION-END id=interface:UseMapStateResult

``function useMapState``
------------------------

.. CG-BLOCK id=function:useMapState lines=53-126

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapState.ts
   :language: typescript
   :lines: 53-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:useMapState

**What this does.** The hook. It keeps the hidden-CPT set, the borehole axis, and the per-axis hidden-value sets in *state*; the two toggle callbacks add or remove a value from the relevant hidden set; the viewport bounds live in state updated by their handler; and the map camera (centre plus zoom) lives in a *ref* updated by its handler. It returns all of these (the hook building-blocks introduced on the ``desktop.renderer.src.hooks.usePersistedJSON`` page).

**Why it is here.** Tracking HIDDEN values rather than visible ones means an empty set shows everything, so a newly-seen marker type never flashes hidden on the first render. A null viewport treats everything as in-view so the first render is not an empty section. The camera is a ref, not state, so that persisting it across map remounts — which happen every time the user goes map to section panel and back — restores the zoomed-in site instead of snapping back to the Belgium-default frame, and does so without triggering a redraw.

.. CG-EXPLANATION-END id=function:useMapState

