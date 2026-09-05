desktop.renderer.src.utils.formationFillStore
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/formationFillStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/formationFillStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationFillStore.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a tiny shared holder — a *store* — for one on/off value: whether the litho "model fill" is shown on the section view. A store is a small module-level box of shared state that components subscribe to, so that when the value flips every subscriber redraws. The long comment records a piece of history: the store keeps its old ``formationFill`` name, but since 2026-06-12 it actually controls the ``ModelFillOverlay`` (the cross-section fill sampled from the built 3-D body solids), not the fill it originally controlled. It imports a factory that builds a boolean store and imports one function from the sibling band-fill store.

**Why it is here.** The comment explains the design: this is the lightest correct way to share a single on/off view toggle between sibling components that have no shared path to pass the value down — the toggle is set from the Sections toolbar and read by the section panel through React's ``useSyncExternalStore``, the built-in mechanism that redraws a component when such a store changes. It is module-global on purpose because only one section view exists at a time, and it defaults to shown and is never persisted because it is screen chrome, not a project decision — the platform's rule is that only interface preferences live in this kind of transient store, while engineering decisions are saved into the project file. The store was repurposed rather than renamed to avoid churning every import that points at it.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=32-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationFillStore.ts
   :language: typescript
   :lines: 32-36
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the actual boolean store, started in the "on" (fill shown) state, using the shared ``createBooleanStore`` factory.

**Why it is here.** Defaulting to shown means the section looks the same as before on every load; because it is a chrome toggle it deliberately resets to shown on reload rather than remembering the last state.

.. CG-EXPLANATION-END id=const:store

``function toggleFormationFill``
--------------------------------

.. CG-BLOCK id=function:toggleFormationFill lines=37-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationFillStore.ts
   :language: typescript
   :lines: 37-42
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleFormationFill

**What this does.** Flips the model-fill visibility and, if the flip just turned it on, also turns the band fill off.

**Why it is here.** The two fills are mutually exclusive by owner request (dogfeed 2026-07-13): showing the model fill should hide the band fill so the section is never painted with both at once. Only the on-transition hides the band fill; turning the model fill off never brings the band fill back.

.. CG-EXPLANATION-END id=function:toggleFormationFill

``function setFormationFill``
-----------------------------

.. CG-BLOCK id=function:setFormationFill lines=43-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationFillStore.ts
   :language: typescript
   :lines: 43-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:setFormationFill

**What this does.** Sets the model-fill visibility to a given value directly, with no side effect on the band fill.

**Why it is here.** A plain setter for callers that need to set the value without triggering the mutual-exclusion behaviour that the toggle applies.

.. CG-EXPLANATION-END id=function:setFormationFill

``function getFormationFillVisible``
------------------------------------

.. CG-BLOCK id=function:getFormationFillVisible lines=48-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationFillStore.ts
   :language: typescript
   :lines: 48-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:getFormationFillVisible

**What this does.** Reads the current model-fill visibility once, without subscribing to future changes.

**Why it is here.** A non-reactive read for code that needs the value at a moment in time (for example inside an event handler) rather than a component that should redraw when it changes.

.. CG-EXPLANATION-END id=function:getFormationFillVisible

``function useFormationFillVisible``
------------------------------------

.. CG-BLOCK id=function:useFormationFillVisible lines=53-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationFillStore.ts
   :language: typescript
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:useFormationFillVisible

**What this does.** A hook that returns the current visibility and re-draws the calling component whenever the toggle flips.

**Why it is here.** This is the reactive read built on ``useSyncExternalStore``; a *hook* is a ``use…`` function that lets a component subscribe to changing values, so any component that calls this one stays in step with the toggle.

.. CG-EXPLANATION-END id=function:useFormationFillVisible

