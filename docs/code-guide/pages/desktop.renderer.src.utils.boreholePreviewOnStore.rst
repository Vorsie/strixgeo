desktop.renderer.src.utils.boreholePreviewOnStore
=================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/boreholePreviewOnStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/boreholePreviewOnStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholePreviewOnStore.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment introduces a store for the geotech axis "Show borehole preview" toggle, following the same store pattern introduced on the ``bandFillStore`` page, and imports the shared boolean-store factory. The toggle is set from the geotech toolbar's Display menu and read by the sections canvas.

**Why it is here.** The comment records the owner's dogfeed ruling (2026-08-07): the divide-boreholes preview ghosts must be opt-in, because when they appeared uninvited they read as "my boreholes got subdivided". The store holds only the toggle bit — the gate rule lives elsewhere — and, being screen chrome, it is not persisted and resets to off on reload.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=18-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholePreviewOnStore.ts
   :language: typescript
   :lines: 18-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the boolean store starting at ``false`` (preview off).

**Why it is here.** The same shared-factory reason as on the ``bandFillStore`` page.

.. CG-EXPLANATION-END id=const:store

``function toggleBoreholePreviewOn``
------------------------------------

.. CG-BLOCK id=function:toggleBoreholePreviewOn lines=21-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholePreviewOnStore.ts
   :language: typescript
   :lines: 21-25
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleBoreholePreviewOn

**What this does.** Flips the preview toggle and notifies subscribers.

**Why it is here.** The single action the Display-menu control needs.

.. CG-EXPLANATION-END id=function:toggleBoreholePreviewOn

``function getBoreholePreviewOn``
---------------------------------

.. CG-BLOCK id=function:getBoreholePreviewOn lines=26-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholePreviewOnStore.ts
   :language: typescript
   :lines: 26-30
   :lineno-match:

.. CG-EXPLANATION-START id=function:getBoreholePreviewOn

**What this does.** Reads the current toggle state without subscribing.

**Why it is here.** For callers that need the value once rather than a redraw on change; the same read/subscribe split as on the ``bandFillStore`` page.

.. CG-EXPLANATION-END id=function:getBoreholePreviewOn

``function useBoreholePreviewOn``
---------------------------------

.. CG-BLOCK id=function:useBoreholePreviewOn lines=31-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholePreviewOnStore.ts
   :language: typescript
   :lines: 31-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBoreholePreviewOn

**What this does.** A hook that returns the current value and redraws the caller when it flips.

**Why it is here.** The reactive read for components that must reflect the toggle on screen.

.. CG-EXPLANATION-END id=function:useBoreholePreviewOn

