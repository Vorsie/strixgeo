desktop.renderer.src.utils.bandFillStore
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/bandFillStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/bandFillStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/bandFillStore.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment introduces a *store* — a small module-level holder of shared state that components subscribe to — for the "Fill bands" toggle, then imports the shared boolean-store factory and the model-fill setter. The toggle is set from the Sections toolbar and read by the section panel, which passes it on to the partition-fill overlay.

**Why it is here.** The comment records why a store is the right tool: the toolbar and the panel are sibling components with no shared inputs path except the coordinator, and this is a single boolean view toggle, so a module-level store read through React's ``useSyncExternalStore`` (its built-in way to redraw a component when such a store changes) is the lightest correct way to share it. It also records that the toggle is deliberately not remembered across reloads — band fill is an explicit finish-then-click action, never on by default — and that the circular import of the model-fill setter is safe because only the function is used, and only at click time.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=24-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/bandFillStore.ts
   :language: typescript
   :lines: 24-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the actual store, a boolean starting at ``false`` (fill hidden), from the shared factory.

**Why it is here.** Building it from the shared ``createBooleanStore`` factory means every boolean view toggle in the app gets the identical subscribe/read/notify behaviour without each one re-implementing it.

.. CG-EXPLANATION-END id=const:store

``function toggleBandFill``
---------------------------

.. CG-BLOCK id=function:toggleBandFill lines=29-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/bandFillStore.ts
   :language: typescript
   :lines: 29-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleBandFill

**What this does.** Flips the band-fill visibility and tells subscribers; then, if it just turned on, it switches the model fill off.

**Why it is here.** The comment records the owner's dogfeed ask (2026-07-13): band fill and model fill paint the same section area, so showing one hides the other — but turning band fill off never brings the model fill back.

.. CG-EXPLANATION-END id=function:toggleBandFill

``function setBandFill``
------------------------

.. CG-BLOCK id=function:setBandFill lines=35-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/bandFillStore.ts
   :language: typescript
   :lines: 35-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:setBandFill

**What this does.** Sets the band-fill visibility to a given value, with no side effect on the model fill.

**Why it is here.** A plain setter is needed for the cases that must set the value without triggering the mutual-exclusion behaviour that ``toggleBandFill`` carries.

.. CG-EXPLANATION-END id=function:setBandFill

``function getBandFillVisible``
-------------------------------

.. CG-BLOCK id=function:getBandFillVisible lines=40-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/bandFillStore.ts
   :language: typescript
   :lines: 40-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:getBandFillVisible

**What this does.** Reads the current band-fill visibility without subscribing to changes.

**Why it is here.** Non-reactive callers (code that just needs the value once, not a redraw when it changes) use this plain read.

.. CG-EXPLANATION-END id=function:getBandFillVisible

``function useBandFillVisible``
-------------------------------

.. CG-BLOCK id=function:useBandFillVisible lines=45-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/bandFillStore.ts
   :language: typescript
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBandFillVisible

**What this does.** A *hook* — a ``use…`` function a component calls — that returns the current value and redraws the calling component whenever the toggle flips.

**Why it is here.** This is the reactive counterpart to the plain read: components that must reflect the toggle on screen subscribe through this hook.

.. CG-EXPLANATION-END id=function:useBandFillVisible

