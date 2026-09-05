desktop.renderer.src.hooks.boreholeExclusionToggle
==================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/boreholeExclusionToggle.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/boreholeExclusionToggle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/boreholeExclusionToggle.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports (React setter types, the API client and its model type, the logger, and the undo-command type). This file holds the shared logic for including or excluding a borehole from a geological or lithostratigraphic model.

**Why it is here.** A model's ``excluded_borehole_ids`` list is the bundle-portable source of truth for ``this borehole does not anchor this model``. Both the Geology inspector's checkbox roster and the Lithology inspector's ``Include again`` list flip it the same way, so the mechanics live here once instead of as two near-identical sixty-line handlers (the ``extract on the second copy`` rule). The comment records that the write is optimistic (local state updates before the network call) and reversible (an undo command is registered on success), and that a failed call rolls the local state back to what the server holds.

.. CG-EXPLANATION-END id=module-header

``interface BoreholeExclusionToggleArgs``
-----------------------------------------

.. CG-BLOCK id=interface:BoreholeExclusionToggleArgs lines=23-71

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/boreholeExclusionToggle.ts
   :language: typescript
   :lines: 23-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeExclusionToggleArgs

**What this does.** The inputs: the project id, the model and its setter, the borehole id, the include/exclude direction, the push-undo and mark-changed callbacks, the two undo-menu labels, a short log label, and an optional success toast. These lines also carry the documentation of the function below.

**Why it is here.** The setter is typed as the shared model setter so both the geological and the litho model setters fit the one function. ``included = true`` means the user wants the borehole IN the model, so it is removed from the exclusion list. Callers pass their own labels and toast because the geology checkbox toggles silently while the litho ``Include again`` confirms.

.. CG-EXPLANATION-END id=interface:BoreholeExclusionToggleArgs

``function toggleBoreholeExclusion``
------------------------------------

.. CG-BLOCK id=function:toggleBoreholeExclusion lines=72-120

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/boreholeExclusionToggle.ts
   :language: typescript
   :lines: 72-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleBoreholeExclusion

**What this does.** Works out the next exclusion list (dropping the borehole when it should be included, adding it when it should be excluded), updates the on-screen state immediately, then sends the change to the engine through the API. On success it marks the project changed, registers a reversible undo command (whose revert restores the old list and whose reapply re-applies the new one), and fires the optional toast. On failure it logs the error and rolls the on-screen state back. It never rejects.

**Why it is here.** The state updates optimistically first so the contacts overlay redraws without waiting for the round-trip, and the write goes through the API client (the window always reaches the engine through the API). Toggling model membership is a reversible action, so it fires immediately and registers an undo command rather than asking for confirmation (the reversible-vs-irreversible rule from CLAUDE.md). It never throws so that a stray click can never leave an uncaught rejection; a failed change simply rolls back to server truth.

.. CG-EXPLANATION-END id=function:toggleBoreholeExclusion

