desktop.renderer.src.shell.stages.shared.makeBodyRecomputeBuilder
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/makeBodyRecomputeBuilder.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/makeBodyRecomputeBuilder.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeBodyRecomputeBuilder.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. Its job is to assemble the 'recompute bodies' request — the message the desktop sends the engine to work out afresh which same-lithology layers count as one body. A 'request builder' is code that gathers the inputs and packs them into the shape the engine expects. It imports the section-input assembler, the API client, the boundary-shape type, the pure payload builder, a feature flag, the logger, and the per-section edge fetch from the file above.

**Why it is here.** The comment states this is the recompute sibling of the voxel-build request builder and shares its shape on purpose: fetch the section-scoped approved edges fresh, refuse on any partial input, assemble the fence inputs, then hand the rest to a pure builder. Two differences are called out as deliberate. First, the edges are fetched with the suspended-tie filter on, because the body resolver suspends 'class_changed' and 'ambiguous_band' ties from unioning (owner ruling F31), so identity geometry must not weld through them. Second, when it must refuse it returns nothing (with a warning) rather than throwing an error, because the recompute runs quietly in the background after edits — there is no click to answer with a dialog, and the next edit will schedule it again anyway.

.. CG-EXPLANATION-END id=module-header

``interface BodyRecomputeAssemblyParams``
-----------------------------------------

.. CG-BLOCK id=interface:BodyRecomputeAssemblyParams lines=32-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeBodyRecomputeBuilder.ts
   :language: typescript
   :lines: 32-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyRecomputeAssemblyParams

**What this does.** Describes the snapshot of inputs the assembly reads at the moment it fires (an 'interface' names the exact shape). The fields are: the project id, the model id (litho or geotech), the visible sections, the investigations (all visible CPTs and boreholes in projection form), the model's layer rows, a log-channel label, an optional geotech packing-class map (formation id to a canonical class key), and an optional litho frame — a frame model id plus its layer rows.

**Why it is here.** The packing-class map is supplied only for the geotech model, where body identity groups by packing class ('one mass one body', owner 2026-08-21); the litho model keeps plain row identity so it is omitted there. The litho frame is set only on the geotech recompute (owner ruling R6, debt #278): with it, body identity is decided from the hierarchical fill on the litho frame's columns — the very picture the geotech axis renders — and without it the recompute uses the model's own whole-section partition, which is what the litho stage wants.

.. CG-EXPLANATION-END id=interface:BodyRecomputeAssemblyParams

``function assembleBodyRecomputePayload``
-----------------------------------------

.. CG-BLOCK id=function:assembleBodyRecomputePayload lines=84-198

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/makeBodyRecomputeBuilder.ts
   :language: typescript
   :lines: 84-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleBodyRecomputePayload

**What this does.** The async assembler. It returns nothing (null) whenever nothing should be sent: no project, model or sections; a section's edge fetch failed; the litho frame's edge fetch failed; the hand-drawn-boundary fetch failed while freedraw editing is on; or the assembly came out empty. Otherwise it fetches the section-scoped approved edges (dropping the suspended ties), loads the stored hand-drawn body boundaries only when freedraw editing is enabled, assembles the section inputs, optionally assembles the litho frame's inputs (fetching the frame's edges plain), and hands it all to the pure payload builder. 'Async' means it can pause to wait for those network fetches.

**Why it is here.** Every refusal is deliberate: a payload built from partial edges would weld the wrong bodies together; a payload from a partial litho frame would state the wrong soil families; boundaries must match the sections the engineer actually drew; and the engine refuses an empty payload outright, so a recompute can never wipe the model's bodies. It returns null instead of throwing because this is a background debounce (debounce = wait until edits stop, then act once), so there is no gesture to interrupt with an error and the next edit reschedules it. The frame edges are fetched plain — without the suspended-tie filter — because the suspended reasons are geotech tie reasons, so the geotech filter must never silence a genuine litho tie in the frame.

.. CG-EXPLANATION-END id=function:assembleBodyRecomputePayload

