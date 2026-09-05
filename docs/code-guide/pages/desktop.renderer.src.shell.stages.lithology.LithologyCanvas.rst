desktop.renderer.src.shell.stages.lithology.LithologyCanvas
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-72

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
   :language: tsx
   :lines: 1-72
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: two React hooks (``useEffect``, ``useMemo``, ``useRef``), a layers icon, the shell context hook and translator, the shared ``EmptyState`` prompt, the reused 3-D viewer ``Geology3DViewer``, a helper that recolours geotech formations into their NAD colours, and the shared 3-D plumbing (the view-state hook, the view-mode pills, the fence-DXF export, the voxel-request builder). The long comment records the file's history and its design: this is the Lithology stage's centre canvas — a 3-D viewer of the built litho body solids, or a guided empty prompt when none exist yet.

**Why it is here.** React is the library that builds the screen from small functions; a ``component`` is one such function that returns a piece of screen; a ``hook`` is a ``use...`` function that lets a component use a React feature. The comment records the key design decisions: the litho pane reuses the geology 3-D viewer unchanged but is handed an always-empty surfaces map so the TIN-surface layer is suppressed on this pane only; the mount gate is "has built solids", because the litho pane shows body solids, not surfaces; and the shared 3-D plumbing (split viewport, ground surface, fence edges) was extracted so the geotech canvas can reuse the same modules. CesiumJS is the 3-D globe library the viewer draws on.

.. CG-EXPLANATION-END id=module-header

``const resetLithoCameraCallback``
----------------------------------

.. CG-BLOCK id=const:resetLithoCameraCallback lines=73-84

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
   :language: tsx
   :lines: 73-84
   :lineno-match:

.. CG-EXPLANATION-START id=const:resetLithoCameraCallback

**What this does.** Declares a shared reference slot that the 3-D viewer fills in with its "reset the camera" function when it mounts. It starts empty.

**Why it is here.** The Reset-camera button lives in the stage toolbar, which is a separate component from the canvas, and the two do not pass values to each other directly. This module-level slot is the bridge: the viewer writes its reset function into it, and the toolbar button calls whatever is in it. Only one lithology canvas is mounted at a time, so a single shared slot is race-free.

.. CG-EXPLANATION-END id=const:resetLithoCameraCallback

``const resetLithoSplitViewportCallback``
-----------------------------------------

.. CG-BLOCK id=const:resetLithoSplitViewportCallback lines=85-103

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
   :language: tsx
   :lines: 85-103
   :lineno-match:

.. CG-EXPLANATION-START id=const:resetLithoSplitViewportCallback

**What this does.** Declares a second shared reference slot, filled in with the function that collapses the split viewport back to a single view. It starts empty.

**Why it is here.** Same bridge pattern as the camera slot: the split-viewport state lives in the canvas's shared view-state hook, but the Reset button that collapses it lives in the toolbar, so the function is passed through this module-level slot. It mirrors the geology canvas's identical arrangement.

.. CG-EXPLANATION-END id=const:resetLithoSplitViewportCallback

``const lithoVoxelRequestCallback``
-----------------------------------

.. CG-BLOCK id=const:lithoVoxelRequestCallback lines=104-116

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
   :language: tsx
   :lines: 104-116
   :lineno-match:

.. CG-EXPLANATION-START id=const:lithoVoxelRequestCallback

**What this does.** Declares a third shared reference slot, filled in with a function that assembles the 3-D build request for the active litho model. It starts empty and its builder is asynchronous.

**Why it is here.** The "Build model" button is in the toolbar, but the per-section partition data the build needs lives here in the canvas, so the canvas writes the builder into this slot and the button calls it. The builder is asynchronous (it can pause and resume) because the correlation edges are section-scoped and fetched fresh at click time — the default Solid view keeps no edge cache, so the build cannot rely on fence-mode state. It resolves to nothing when there is nothing to build (no model, no sections, or no accepted layers), which the button turns into a "nothing to build" toast.

.. CG-EXPLANATION-END id=const:lithoVoxelRequestCallback

``const lithoFenceExportCallback``
----------------------------------

.. CG-BLOCK id=const:lithoFenceExportCallback lines=117-156

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
   :language: tsx
   :lines: 117-156
   :lineno-match:

.. CG-EXPLANATION-START id=const:lithoFenceExportCallback

**What this does.** Declares a fourth shared reference slot, filled in with a function that exports the litho fence diagram to DXF. It starts empty and holds nothing while the canvas is not mounted.

**Why it is here.** The Export-fence button is in the toolbar but the fence walls are canvas-local state that never reaches the shell, so this slot bridges the two the same way the voxel-request slot does. A fence diagram places the section walls in 3-D, and DXF is the AutoCAD drawing format the walls are written to for CAD; when the canvas is unmounted the slot holds nothing so a stray click after a stage switch does nothing.

.. CG-EXPLANATION-END id=const:lithoFenceExportCallback

``function LithologyCanvas``
----------------------------

.. CG-BLOCK id=function:LithologyCanvas lines=157-374

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx
   :language: tsx
   :lines: 157-374
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithologyCanvas

**What this does.** The canvas component. It reads everything it needs from the shell (the project, the model bundle, the confidence-fade flag, the sections, the toast function) — it takes no inputs of its own. It memoises the marker-filtered solids, pulls the shared 3-D view state (view mode, wireframe, split, ground surface, fence panels), records into per-instance references which shared toolbar-bridge functions it currently owns, builds the geotech comparison scene in its NAD colours, and every draw writes its fence-export and voxel-request functions into the shared slots. A cleanup effect nulls those slots when the canvas unmounts. Finally: when built solids exist it draws the view-mode pills and the 3-D viewer; otherwise it draws a guided empty prompt.

**Why it is here.** The visible solids are memoised (cached until their inputs change) because an inline filter would produce a new array every draw, and the viewer rebuilds every Cesium primitive whenever that array changes — the old runaway-rebuild class of bug. The toolbar-bridge slots are written above the early return and nulled only while they still point at THIS canvas's own functions, because React can mount a replacement canvas before running the old one's cleanup, and both stages can be alive at once in the split view, so an older instance must never wipe a slot a newer one has already claimed (debt #276). The comparison pane recolours the geotech bodies into their NAD packing colours at the presentation boundary, because a geotech body must read its packing colour, not the inherited lithology colour. The empty surfaces map keeps TIN sheets off the litho pane without touching the shared viewer.

.. CG-EXPLANATION-END id=function:LithologyCanvas

