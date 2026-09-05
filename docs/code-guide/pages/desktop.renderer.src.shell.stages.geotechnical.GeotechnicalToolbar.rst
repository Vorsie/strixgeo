desktop.renderer.src.shell.stages.geotechnical.GeotechnicalToolbar
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalToolbar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalToolbar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalToolbar.tsx
   :language: tsx
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the Geotechnical stage's toolbar — the verb row on top of the stage. The comment records that it mirrors the Lithology toolbar scoped to the geotech model: a single "Build model" verb that posts the geotech partition to the shared 3-D builder, and a "Reset camera" button once solids exist. It explains why the Build verb lives here rather than on the Sections toolbar, and notes that since 2026-08-26 the press goes through a pre-flight. It pulls in the icons, the shell context, the translation helper, the toolbar primitives, the attention chip, the inline build-progress bar, the stale-column helpers, the two dialogs, the pre-flight hook, and the canvas's toolbar-bridge slots.

**Why it is here.** Build lives on the geotech stage toolbar, not the Sections toolbar, because the build payload is assembled by the geotech canvas and reaches the toolbar through a module-level slot — and the canvas is only mounted alongside this toolbar. A Build button on the Sections toolbar would never have the payload and would be a permanent no-op. The 2-D editing verbs (Subdivide, Correlate packing) stay on the Sections toolbar. The pre-flight was added because a test imported after the subdivision carries accepted litho and no bands, so a straight build would frame a gap around it with nothing to fill; on a finished model the pre-flight finds nothing and the press behaves exactly as before.

.. CG-EXPLANATION-END id=module-header

``function GeotechnicalToolbar``
--------------------------------

.. CG-BLOCK id=function:GeotechnicalToolbar lines=63-255

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalToolbar.tsx
   :language: tsx
   :lines: 63-255
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechnicalToolbar

**What this does.** The toolbar component — the function that draws the verb row. It reads the geotech model, layers, build state and stale-column signals from the shell's shared context and calls the pre-flight hook. It returns nothing until a geotech model exists. Otherwise it draws the "Build model" button (or, while a background build runs, an inline progress bar with Cancel), an amber chip naming any tests the last build deliberately left out, an "Export fence" button once solids exist, an amber chip for columns whose lithology moved after their bands were made, a "Reset camera" button, a button to re-open the admixture prompt, and the two dialogs the pre-flight drives.

**Why it is here.** The pre-flight hook and the translator are called ABOVE the early "no model, draw nothing" return, so the order of React features never depends on whether a model exists yet (the hook-order / temporal-dead-zone rule). Build is disabled when there are no geotech bands, because the builder would have nothing to project and the button would be a confusing no-op — the tooltip points the engineer to the Sections stage. The excluded-tests chip is a real button because it can act: pressing it walks the left-out tests one at a time. The stale-litho chip appears here as well as on the Sections toolbar because THIS is the button that bakes those bands into an exportable 3-D model — the last chance to notice before the staleness stops being visible — and it is passive because those columns can sit on any section, so there is no single "next" spot to jump to. The re-open admixture button is the change-my-answer path (owner ruling 2026-09-04): auto-prompting on Build only fires while a unit is unanswered, so this is the way back in once every unit has an answer.

.. CG-EXPLANATION-END id=function:GeotechnicalToolbar

