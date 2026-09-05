desktop.renderer.src.shell.stages.geotechnical.GeotechnicalCanvas
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-68

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
   :language: tsx
   :lines: 1-68
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the Geotechnical stage's canvas — the main screen of the stage, which here is the 3-D room showing the geotech body solids. The long comment explains that this stage now mirrors the Lithology stage: the litho world splits its 2-D view (on the Sections stage) from its 3-D view (on the Lithology stage), and the geotech world does the same, so this canvas is the 3-D room and the 2-D geotech band view is reached by switching the Sections stage's axis picker to "Geotech". It lists what is shared with the litho canvas (view plumbing, the fence, the voxel payload builder) with the geotech data swapped in, and describes two guided empty screens and where the Build button lives. It then pulls in its React tools and the shared 3-D helpers.

**Why it is here.** The owner ruled on 2026-08-26 to retire the old stage-local 2D/3D toggle so the two model worlds behave identically — "one place per job". Everything 3-D is shared with the Lithology canvas so the two stages cannot drift apart; only the data differs (NAD packing colours instead of the inherited lithology colour, the geotech model's solids, and the geotech layers and correlation edges feeding the same model-agnostic builders). The Build button lives in the geotech toolbar, co-mounted with this canvas, so the payload this canvas assembles is always available when Build is pressed.

.. CG-EXPLANATION-END id=module-header

``const resetGeotechCameraCallback``
------------------------------------

.. CG-BLOCK id=const:resetGeotechCameraCallback lines=69-79

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
   :language: tsx
   :lines: 69-79
   :lineno-match:

.. CG-EXPLANATION-START id=const:resetGeotechCameraCallback

**What this does.** A shared slot (a mutable reference) that the 3-D viewer fills in with its own "reset the camera" function while it is on screen. The camera is the virtual eye looking at the 3-D world.

**Why it is here.** The Reset Camera button lives in the geotech toolbar but the code that actually moves the camera lives inside the viewer, so this module-level slot bridges the two without a heavier message channel — only one geotech canvas is ever mounted at a time, so the slot cannot be claimed by two views at once. It mirrors the same pattern the Lithology canvas uses.

.. CG-EXPLANATION-END id=const:resetGeotechCameraCallback

``const resetGeotechSplitViewportCallback``
-------------------------------------------

.. CG-BLOCK id=const:resetGeotechSplitViewportCallback lines=80-96

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
   :language: tsx
   :lines: 80-96
   :lineno-match:

.. CG-EXPLANATION-START id=const:resetGeotechSplitViewportCallback

**What this does.** A second shared slot holding the function that collapses the split viewport back to a single view. A viewport is the on-screen window into the 3-D world; split mode shows two side by side.

**Why it is here.** Same bridge as the camera reset: the toolbar's Reset button needs to first exit split mode and then reset the camera, but the split-mode state lives in the canvas, so the canvas writes its exit function into this slot for the toolbar to call. It mirrors the litho canvas's equivalent.

.. CG-EXPLANATION-END id=const:resetGeotechSplitViewportCallback

``const geotechVoxelRequestCallback``
-------------------------------------

.. CG-BLOCK id=const:geotechVoxelRequestCallback lines=97-109

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
   :language: tsx
   :lines: 97-109
   :lineno-match:

.. CG-EXPLANATION-START id=const:geotechVoxelRequestCallback

**What this does.** A shared slot holding the function that assembles the build request for the active geotech model — the payload that tells the builder how to turn the 2-D partition into 3-D body solids. It is asynchronous (it can pause to fetch data) because the geotech correlation edges are section-scoped and fetched fresh at the moment Build is clicked, and it can take a set of investigations to leave out of this one build.

**Why it is here.** The "Build model" button lives in the toolbar, but the data it needs is held by this canvas, so the canvas fills this slot and the toolbar reads it — the same module-reference bridge the litho canvas uses. The optional exclusion set carries the pre-flight's "Build without them" choice (owner ruling 2026-08-26); leaving it out is the ordinary whole-model build. It resolves to nothing when there is no geotech model or no section to build from.

.. CG-EXPLANATION-END id=const:geotechVoxelRequestCallback

``const geotechFenceExportCallback``
------------------------------------

.. CG-BLOCK id=const:geotechFenceExportCallback lines=110-132

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
   :language: tsx
   :lines: 110-132
   :lineno-match:

.. CG-EXPLANATION-START id=const:geotechFenceExportCallback

**What this does.** A shared slot holding the function that exports the geotech fence diagram to DXF. A fence diagram stands the section walls up in 3-D; DXF is the AutoCAD drawing format used by CAD tools.

**Why it is here.** The fence walls are canvas-local state that never reaches the shell's shared bus, so the toolbar's "Export fence" button cannot assemble the export itself — this slot is how the canvas hands it over. It is emptied when the canvas leaves the screen so a click after a stage switch does nothing rather than exporting a destroyed view's geometry.

.. CG-EXPLANATION-END id=const:geotechFenceExportCallback

``function GeotechnicalCanvas``
-------------------------------

.. CG-BLOCK id=function:GeotechnicalCanvas lines=133-428

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx
   :language: tsx
   :lines: 133-428
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechnicalCanvas

**What this does.** The canvas component — the function that draws the stage's main screen. It reads the project, the litho and geotech models, and the overlay and section state from the shell's shared context; filters the solids by the marker toggle; builds the formation-to-class map that defines mass identity; sets up the shared 3-D view plumbing pointed at the geotech model but framed by the litho model; and, every render, fills the toolbar-bridge slots with this canvas's build, fence-export and split-reset functions. It shows one of two guided empty screens (no litho model to subdivide from, or a litho model but nothing built yet) or the full 3-D viewer with the NAD-coloured body solids, the view-mode pills, and a compare pane against the litho model. In every branch it also draws the gapless build-report banner.

**Why it is here.** The mass-identity map and the litho-framing are threaded so that the 3-D build, the fence and the 2-D fill all weld exactly the same masses — render equals build on one path (owner 2026-08-21, and the litho-frames-geotech ruling 2026-08-18). The build, fence and split slots are filled ABOVE the early "empty screen" returns so Build still works while a guide screen shows; each is memoised or guarded so the viewer's rebuild does not thrash and a stale closure is never left behind; and an unmount cleanup empties only the slots this instance still owns, because React can mount a replacement canvas before running the old one's cleanup, and an older instance must never wipe a slot a newer one has claimed (debt #276). The report banner is drawn in all three branches — including the "nothing built" screen — because a build that produced nothing is exactly when the engineer most needs to read why. Several ``const`` declarations and the cleanup effect are placed above the early returns so the order of React features never depends on which branch renders (the hook-order and temporal-dead-zone rules).

.. CG-EXPLANATION-END id=function:GeotechnicalCanvas

