desktop.renderer.src.shell.stages.lithology.LithologyStage
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx
   :language: tsx
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: four icons, the stage-descriptor and stage-summary types, the shell context hook, the canvas component and its four shared toolbar-bridge slots, the inspector component, the toolbar-button primitive, the inline voxel-build progress bar, and the translator. The long comment records the stage's place and its toolbar design.

**Why it is here.** The comment states where this stage sits: the lithostratigraphic model refines the geological backbone and is itself refined into the geotechnical NAD model, so Litho sits between them on the left spine of stages. This stage is the model-management and 3-D-view surface — the actual contact editing happens on the Sections stage scoped to the active litho model. It also records that the toolbar's several old build buttons were collapsed into one "Build model" verb, and that the split-viewport Reset wiring mirrors the geology canvas.

.. CG-EXPLANATION-END id=module-header

``function LithologyToolbar``
-----------------------------

.. CG-BLOCK id=function:LithologyToolbar lines=53-147

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx
   :language: tsx
   :lines: 53-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithologyToolbar

**What this does.** The stage's toolbar — the verb row at the top of the screen. It reads the model bundle and the build state from the shell, and returns nothing when no litho model is active. Otherwise it shows either an inline progress bar with a Cancel (while a build job is running) or a single "Build model" button, plus — once solids exist — an "Export fence" button and a "Reset camera" button. The Build button is disabled when the model has no contacts and turns amber when the built solids are stale; Reset camera first collapses the split viewport, then flies to the model bounds.

**Why it is here.** The translator hook is called unconditionally, above the "no active model" early return, because React requires hooks to run in the same order every draw. Build is gated on having contacts so the button is never a confusing no-op — with zero contacts the builder has nothing to work with, and the tooltip points the engineer to the section view to accept contacts first. Build routes through the voxel streaming path, invoking the canvas-populated request builder (the source of truth for the per-section partition) and running it as a cancellable background job (debt #282). The Export-fence button is offered only once solids exist, because the fence needs a built model; the action itself refuses with a warning when the view is not in fence mode, so a silently empty DXF is never mistaken for a successful export.

.. CG-EXPLANATION-END id=function:LithologyToolbar

``function useLithologyStageSummary``
-------------------------------------

.. CG-BLOCK id=function:useLithologyStageSummary lines=148-179

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx
   :language: tsx
   :lines: 148-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithologyStageSummary

**What this does.** A small custom hook that returns the badge shown on this stage's spine button. Normally it is the count of litho units in the model (no badge when there are none). But when the built 3-D model is stale it instead returns an amber "!" badge, with the word "stale" carried in the button's label and tooltip.

**Why it is here.** Staleness outranks the count (owner ruling 2026-08-10) because the edit that makes the 3-D model stale is usually made on another stage — dragging a contact on the geotech axis moves a litho boundary — so the badge is how a stage reports out-of-date work without being opened. It borrows the one badge rather than adding a second mark, because two indicators on one tiny spine button stop it being readable. The badge shows "!" rather than the word because the spine truncates any badge over four characters to an ellipsis, which would say nothing; the word lives in the label, which is the tooltip and the accessible name.

.. CG-EXPLANATION-END id=function:useLithologyStageSummary

``const LithologyStage``
------------------------

.. CG-BLOCK id=const:LithologyStage lines=180-193

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx
   :language: tsx
   :lines: 180-193
   :lineno-match:

.. CG-EXPLANATION-START id=const:LithologyStage

**What this does.** Builds the stage descriptor object: its id, its spine icon and label, the stage-summary hook above, and the three components that make up the stage — the canvas, the toolbar, and the inspector.

**Why it is here.** A stage descriptor is the fixed shape the shell expects for every stage on the left spine, so registering Litho is just filling this object in. The icon is deliberately the flat-stacked-beds glyph — a different glyph family from the Sections and Geology icons — so the adjacent spine buttons stay unambiguous at their small size (a UX-review point).

.. CG-EXPLANATION-END id=const:LithologyStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=194-194

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyStage.tsx
   :language: tsx
   :lines: 194-194
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Makes the stage descriptor the file's default export.

**Why it is here.** Exporting the one descriptor as the default is the standard way the shell's stage registry imports and registers this stage.

.. CG-EXPLANATION-END id=default:default

