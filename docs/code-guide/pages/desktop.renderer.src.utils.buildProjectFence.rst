desktop.renderer.src.utils.buildProjectFence
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/buildProjectFence.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/buildProjectFence.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildProjectFence.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for building the whole-project 3D fence: the panel builder and its shapes, the panel merger, the partition types, the frame-alignment helper, the two fill engines (hierarchical geotech and the active litho fill), the section-assembly helper, and the section-endpoints type.

**Why it is here.** The fence build reuses the app's real fill engines and section-assembly helpers rather than re-deriving geometry, so it imports them here; the reason each is needed is documented at the block below that uses it.

.. CG-EXPLANATION-END id=module-header

``interface FenceSectionInput``
-------------------------------

.. CG-BLOCK id=interface:FenceSectionInput lines=16-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildProjectFence.ts
   :language: typescript
   :lines: 16-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceSectionInput

**What this does.** Describes everything needed to fence one section: an optional cross-section id, the section endpoints, the projected columns, the accepted layers, and the correlation edges. The block also shows the function's documentation of how the fence is built section by section.

**Why it is here.** The comment records that the id is optional here because the fence render never reads it, but the body-recompute wire requires it (audit P1-3: the server verifies the payload covers every section) — so the same shape serves both a render that ignores the id and a wire that demands it, in keeping with the additive-only contract.

.. CG-EXPLANATION-END id=interface:FenceSectionInput

``function buildProjectFence``
------------------------------

.. CG-BLOCK id=function:buildProjectFence lines=67-158

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildProjectFence.ts
   :language: typescript
   :lines: 67-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildProjectFence

**What this does.** Builds all the 3D wall panels for the project. It first assembles every section and computes a canonical world position per test id (the position on the densest section that contains the test). If a litho frame is supplied (a geotech fence), it indexes the frame per section. Then, for each section, it stamps each column's canonical world position, computes the fill regions — the hierarchical geotech fill on the frame when present, otherwise the active litho fill — turns them into fence regions carrying their gap index and producing layer ids, builds the wall panels, and collapses each section's per-gap panels into one panel per connected body before collecting them all.

**Why it is here.** The comments record several decisions: drawing each column at its canonical position makes a sparse two-column tie inherit the dense cross-section's column positions so the tie rung meets the walls cleanly (dogfeed 2026-06-10); the geotech fence uses the same hierarchical fill the axis renders and the voxel build posts so all three agree (owner 2026-08-18); a panel's body scope is resolved through the label-independent layer ids, never the local body label the weld mints; and one comment flags a known, deliberate divergence (audit FE-UTILS-09): unlike the on-screen overlay and the voxel build, the litho arm here does not pass the real per-column along-metres, so its substrate pass slices at a uniform fallback spacing — kept explicit and awaiting an owner sign-off rather than silently changing the rendered fence.

.. CG-EXPLANATION-END id=function:buildProjectFence

