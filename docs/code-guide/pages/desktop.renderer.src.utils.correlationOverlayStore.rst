desktop.renderer.src.utils.correlationOverlayStore
==================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/correlationOverlayStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/correlationOverlayStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/correlationOverlayStore.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment introduces a store for the "Show / hide correlations" toggle — following the same store pattern introduced on the ``bandFillStore`` page — and imports the shared boolean-store factory. The toggle hides or shows the 2-D ribbons and lines that visualise the engineer's correlation edges on the litho axis.

**Why it is here.** The comment records that this is a pure 2-D visualisation toggle with no link to the 3-D model — it just lets the engineer read the columns and the model cleanly — and that it defaults to shown so the existing behaviour is unchanged on load; being screen chrome, it is not persisted and resets to shown on reload.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=24-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/correlationOverlayStore.ts
   :language: typescript
   :lines: 24-26
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the boolean store starting at ``true`` (correlations shown).

**Why it is here.** The same shared-factory reason as on the ``bandFillStore`` page; the default is shown so nothing changes on load.

.. CG-EXPLANATION-END id=const:store

``function toggleCorrelationOverlay``
-------------------------------------

.. CG-BLOCK id=function:toggleCorrelationOverlay lines=27-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/correlationOverlayStore.ts
   :language: typescript
   :lines: 27-31
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleCorrelationOverlay

**What this does.** Flips the visibility and notifies subscribers.

**Why it is here.** The single action the toolbar control needs.

.. CG-EXPLANATION-END id=function:toggleCorrelationOverlay

``function getCorrelationOverlayVisible``
-----------------------------------------

.. CG-BLOCK id=function:getCorrelationOverlayVisible lines=32-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/correlationOverlayStore.ts
   :language: typescript
   :lines: 32-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:getCorrelationOverlayVisible

**What this does.** Reads the current visibility without subscribing.

**Why it is here.** For callers that need the value once; the same read/subscribe split as on the ``bandFillStore`` page.

.. CG-EXPLANATION-END id=function:getCorrelationOverlayVisible

``function useCorrelationOverlayVisible``
-----------------------------------------

.. CG-BLOCK id=function:useCorrelationOverlayVisible lines=37-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/correlationOverlayStore.ts
   :language: typescript
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:useCorrelationOverlayVisible

**What this does.** A hook that returns the current value and redraws the caller when it flips.

**Why it is here.** The reactive read for the panel that gates the overlay on this value.

.. CG-EXPLANATION-END id=function:useCorrelationOverlayVisible

