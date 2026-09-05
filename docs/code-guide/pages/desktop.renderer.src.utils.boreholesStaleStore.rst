desktop.renderer.src.utils.boreholesStaleStore
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/boreholesStaleStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/boreholesStaleStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholesStaleStore.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment introduces a store for the geotech "Divide boreholes" stale flag, following the same store pattern introduced on the ``bandFillStore`` page, and imports the shared boolean-store factory. The flag records whether the borehole packing bands have gone out of date.

**Why it is here.** The comment records the reason the flag exists: the borehole packing bands are divided from the CPT bodies' geometry, so they go stale whenever the bodies change — after a "Subdivide all bodies" run or any packing correlation. Tracking that lets the toolbar button go amber (the unsaved/needs-attention colour, never red) to prompt the engineer to re-divide. It defaults to not-stale because a freshly opened project already matches whatever was last divided and saved.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=22-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholesStaleStore.ts
   :language: typescript
   :lines: 22-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the boolean store starting at ``false`` (not stale).

**Why it is here.** The same shared-factory reason as on the ``bandFillStore`` page.

.. CG-EXPLANATION-END id=const:store

``function markBoreholesStale``
-------------------------------

.. CG-BLOCK id=function:markBoreholesStale lines=25-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholesStaleStore.ts
   :language: typescript
   :lines: 25-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:markBoreholesStale

**What this does.** Sets the flag to stale.

**Why it is here.** Called when the bodies or correlations change, so the toolbar can prompt a re-divide.

.. CG-EXPLANATION-END id=function:markBoreholesStale

``function clearBoreholesStale``
--------------------------------

.. CG-BLOCK id=function:clearBoreholesStale lines=30-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholesStaleStore.ts
   :language: typescript
   :lines: 30-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:clearBoreholesStale

**What this does.** Sets the flag back to not-stale.

**Why it is here.** Called after a successful "Divide boreholes" run, when the bands match the bodies again.

.. CG-EXPLANATION-END id=function:clearBoreholesStale

``function getBoreholesStale``
------------------------------

.. CG-BLOCK id=function:getBoreholesStale lines=35-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholesStaleStore.ts
   :language: typescript
   :lines: 35-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:getBoreholesStale

**What this does.** Reads the current stale state without subscribing.

**Why it is here.** For callers that need the value once; the same read/subscribe split as on the ``bandFillStore`` page.

.. CG-EXPLANATION-END id=function:getBoreholesStale

``function useBoreholesStale``
------------------------------

.. CG-BLOCK id=function:useBoreholesStale lines=40-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/boreholesStaleStore.ts
   :language: typescript
   :lines: 40-42
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBoreholesStale

**What this does.** A hook that returns the current value and redraws the caller when staleness flips.

**Why it is here.** The reactive read for the toolbar button that shows the amber state.

.. CG-EXPLANATION-END id=function:useBoreholesStale

