desktop.renderer.src.utils.lithoFillOnGeotechStore
==================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file is a tiny store — a small module-level holder of shared state that on-screen pieces can subscribe to — for the geotech axis's "Show litho fill" toggle. It imports the store factory and the setters of the two sibling fill toggles.

**Why it is here.** The comment records the owner directive (dogfeed 2026-08-06) that the geotech axis paints ONE fill at a time — the NAD packing fill by default, or nothing on a clean slate — and this toggle swaps in the litho fill instead, never both at once. One file decides what actually paints; the interlock here stops the two toggles both reading "on" in the first place (owner, 2026-08-15: "the render was right, the state lied"). It is a single module-global value because only one section view is open at a time, it starts off because the litho fill is foreign on this axis, and it is screen chrome that is never saved and resets on reload. The circular import of the sibling setter is intentional and safe because only a function reference is used, at click time.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=27-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts
   :language: typescript
   :lines: 27-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the actual on/off store, starting in the off state. The store is what components subscribe to: React's built-in ``useSyncExternalStore`` redraws a component whenever the store changes, and the store's subscribe/notify plumbing is how it tells its listeners a value changed.

**Why it is here.** One module-global on/off value is enough because there is only ever one section view on screen, and it starts off so the geotech axis shows no litho fill until the engineer asks for it.

.. CG-EXPLANATION-END id=const:store

``function toggleLithoFillOnGeotech``
-------------------------------------

.. CG-BLOCK id=function:toggleLithoFillOnGeotech lines=33-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts
   :language: typescript
   :lines: 33-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleLithoFillOnGeotech

**What this does.** Flips the toggle and tells subscribers; when the flip turns it ON, it also switches the packing fill and the built-3D-model fill off.

**Why it is here.** The comment records the mutual-exclusion rule: turning this fill on auto-hides the other two so only one fill ever paints, but turning it off never brings them back, because showing no fill at all is a legitimate state.

.. CG-EXPLANATION-END id=function:toggleLithoFillOnGeotech

``function setLithoFillOnGeotech``
----------------------------------

.. CG-BLOCK id=function:setLithoFillOnGeotech lines=42-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts
   :language: typescript
   :lines: 42-46
   :lineno-match:

.. CG-EXPLANATION-START id=function:setLithoFillOnGeotech

**What this does.** Sets the toggle straight to a given value, with none of the auto-hide side effect.

**Why it is here.** The comment records that this is the plain setter, for the cases that must not trigger the mutual exclusion.

.. CG-EXPLANATION-END id=function:setLithoFillOnGeotech

``function getLithoFillOnGeotech``
----------------------------------

.. CG-BLOCK id=function:getLithoFillOnGeotech lines=47-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts
   :language: typescript
   :lines: 47-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:getLithoFillOnGeotech

**What this does.** Reads the current value once, without subscribing to future changes.

**Why it is here.** For code that needs the value a single time, outside a redraw, rather than the reactive hook below.

.. CG-EXPLANATION-END id=function:getLithoFillOnGeotech

``function useLithoFillOnGeotech``
----------------------------------

.. CG-BLOCK id=function:useLithoFillOnGeotech lines=52-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoFillOnGeotechStore.ts
   :language: typescript
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoFillOnGeotech

**What this does.** The reactive hook: a component that calls it is redrawn whenever the toggle flips.

**Why it is here.** The comment records that this is the ``useSyncExternalStore`` read the section panel uses so its fill follows the toggle.

.. CG-EXPLANATION-END id=function:useLithoFillOnGeotech

