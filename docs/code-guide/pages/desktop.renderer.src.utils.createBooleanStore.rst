desktop.renderer.src.utils.createBooleanStore
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/createBooleanStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/createBooleanStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/createBooleanStore.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the React import for the *factory* — a function that builds and returns another thing — behind all the tiny boolean stores the section-view chrome toggles use (band fill, model fill, geotech fill, correlation overlay, boreholes-stale). Each of those store modules is just a thin wrapper around one instance of this factory.

**Why it is here.** The comment records the reason it exists (audit FE-UTILS-04): the plumbing that lets a component redraw when a shared value changes — the listeners set, the subscribe function, and the notify step — should be written exactly once rather than copied into every toggle store; and it records that these stores are module-global and never persisted, so resetting to the initial value on reload is the intended behaviour for every one of them.

.. CG-EXPLANATION-END id=module-header

``interface BooleanStore``
--------------------------

.. CG-BLOCK id=interface:BooleanStore lines=18-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/createBooleanStore.ts
   :language: typescript
   :lines: 18-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BooleanStore

**What this does.** Describes the four things a boolean store hands back: a toggle that flips the value, a set that changes it (doing nothing when unchanged), a plain read, and a hook that redraws the caller when the value changes.

**Why it is here.** This is the single shared surface every chrome-toggle store presents, so the read/subscribe split (a plain read for one-off callers, a hook for components that must reflect the value) is defined in one place.

.. CG-EXPLANATION-END id=interface:BooleanStore

``function createBooleanStore``
-------------------------------

.. CG-BLOCK id=function:createBooleanStore lines=42-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/createBooleanStore.ts
   :language: typescript
   :lines: 42-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:createBooleanStore

**What this does.** Builds a store around a private value and a set of listeners. It defines a notify step that calls every listener, a subscribe step that adds a listener and returns a function to remove it, and a plain read; then it returns the four-part surface — toggle flips the value and notifies, set changes it and notifies only when it actually differs, get reads it, and use subscribes the calling component through React's built-in external-store hook.

**Why it is here.** The comment on the hook records that it is only ever called from the per-store custom hooks, which are themselves bound by the rules of hooks at their call sites — so this factory never breaks the rule that hooks must be called in a stable order. Building each store from this one function is the single-source-of-truth reason from the header.

.. CG-EXPLANATION-END id=function:createBooleanStore

