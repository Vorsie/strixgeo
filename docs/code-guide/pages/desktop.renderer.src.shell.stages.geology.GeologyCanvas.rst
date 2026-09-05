desktop.renderer.src.shell.stages.geology.GeologyCanvas
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCanvas.tsx
   :language: tsx
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the geology stage canvas file and imports its tools: React hooks, the mountain and plus icons, the geological-formation filter, the shell context, the translator, the Cesium 3-D viewer, a shared 3-D view-state hook, and the empty-state decision helper. The comment records the design: the canvas shows the 3-D viewer once at least one non-stale formation surface exists, and otherwise a clean guidance message — never a 2-D map; a split-viewport mode; and two module-level ref callbacks it shares with the toolbar.

**Why it is here.** The canvas (the main screen of a stage) is 3-D-or-message by design — Cesium is a 3-D globe library tied to real geography, and here it is the ONLY content. A plan-view map is deliberately absent because the Data stage owns geographic context, and investigation-selection is absent because the Geology stage is the model-definition surface, not the inspection surface.

.. CG-EXPLANATION-END id=module-header

``const resetCameraCallback``
-----------------------------

.. CG-BLOCK id=const:resetCameraCallback lines=41-51

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCanvas.tsx
   :language: tsx
   :lines: 41-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:resetCameraCallback

**What this does.** Defines a module-level mutable reference, ``resetCameraCallback``, that holds a function (or nothing). The 3-D viewer fills it in when it mounts; the toolbar calls it to fly the camera back to the model. The lines that follow document the sibling split-reset callback.

**Why it is here.** A ref is a slot whose contents survive redraws. This slot lets the toolbar's Reset button reach into the canvas without routing through the shell context bus — safe because only one canvas is ever mounted at a time, so the shared slot can never be a state race.

.. CG-EXPLANATION-END id=const:resetCameraCallback

``const resetSplitViewportCallback``
------------------------------------

.. CG-BLOCK id=const:resetSplitViewportCallback lines=52-74

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCanvas.tsx
   :language: tsx
   :lines: 52-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:resetSplitViewportCallback

**What this does.** Defines the second module-level reference, ``resetSplitViewportCallback``, which collapses a split viewport back to a single one; the canvas fills it in and the toolbar calls it on Reset. The lines that follow are the canvas component's docstring.

**Why it is here.** Same reasoning as the camera callback: a bus-free channel for session-ephemeral view state (the split is not saved to the ``.gmproj`` bundle), which needs no persistence and so does not justify extending the shared bus.

.. CG-EXPLANATION-END id=const:resetSplitViewportCallback

``function GeologyCanvas``
--------------------------

.. CG-BLOCK id=function:GeologyCanvas lines=75-238

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyCanvas.tsx
   :language: tsx
   :lines: 75-238
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyCanvas

**What this does.** The canvas component. It reads the project, boreholes, formations, surfaces, active model, the inline-create-formation handler and the confidence-fade flag from the shell; owns a busy flag for inline formation creation and the split-viewport plus ground-surface plumbing through a shared hook. If any surface has geometry it renders the 3-D viewer with only the geological-kind formations; otherwise it renders a centred empty-state (icon, guidance sentence, and an optional "Add formation" button that creates a placeholder the engineer renames).

**Why it is here.** It filters to geological formations because the shell exposes every formation — geological, lithology and geotech — and only the geological vocabulary belongs on this stage; an earlier naive test (parent-is-null) leaked orphan lithology units into the panel (dogfeed 2026-05-21). The Add-formation button exists so a CPT-only project (no boreholes, so Fill-from-boreholes is disabled) does not dead-end (debt #33). The placeholder name "New formation" stays English because it is a stored and exported token, never translated.

.. CG-EXPLANATION-END id=function:GeologyCanvas

