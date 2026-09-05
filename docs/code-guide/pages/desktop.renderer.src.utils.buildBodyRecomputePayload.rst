desktop.renderer.src.utils.buildBodyRecomputePayload
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/buildBodyRecomputePayload.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/buildBodyRecomputePayload.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildBodyRecomputePayload.ts
   :language: typescript
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment explains this file's job — reshape the per-section fence inputs into the payload sent to the "recompute bodies" endpoint — and lists the rules that shape it, then imports the shapes and helpers it needs. It is the pure counterpart of the voxel-build assembler and reuses the very same section-partition frames, so body identity can never drift from the built geometry; only the engine call differs between a geotech recompute (which runs the hierarchical fill on the litho frame) and a litho recompute (which runs the identity fill on the model's own columns).

**Why it is here.** The comment records the load-bearing decisions: which masses count as one body must be read from the same picture the render shows (owner ruling R6, debt #278); regions painted by a fallback authority are omitted because inferred fill is not geometry evidence; every region carries its producing layer ids so the backend's cross-section rule runs without needing labels; and the merge groups are sent in layer-id space, never body-id space, because an earlier body-id design oscillated in production — after a successful merge the refetched evidence collapsed to singletons and the next post undid the merge.

.. CG-EXPLANATION-END id=module-header

``interface RecomputeBodiesRequest``
------------------------------------

.. CG-BLOCK id=interface:RecomputeBodiesRequest lines=51-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildBodyRecomputePayload.ts
   :language: typescript
   :lines: 51-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecomputeBodiesRequest

**What this does.** Describes the full payload sent to the recompute endpoint: one partition per fillable section, the matching list of section ids in the same order, and the per-section merge groups that list which layers' fill regions touch to form one body on that section. The block also carries the function's own documentation of its inputs and its null-on-empty return.

**Why it is here.** The field comments record why each part is shaped this way: the replace is model-wide, so the server refuses any payload whose section-id set does not exactly equal the project's sections (a partial post must never erase the omitted sections' evidence, audit P1-3); and the merge groups use layer ids as the only wire currency because body ids are the labels the recompute itself rewrites, and body-labelled evidence flapped in production.

.. CG-EXPLANATION-END id=interface:RecomputeBodiesRequest

``function buildBodyRecomputePayload``
--------------------------------------

.. CG-BLOCK id=function:buildBodyRecomputePayload lines=103-234

.. literalinclude:: ../../../desktop/src/renderer/src/utils/buildBodyRecomputePayload.ts
   :language: typescript
   :lines: 103-234
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildBodyRecomputePayload

**What this does.** Walks each section's partition frame and, for each, decides its regions and merge groups two ways: if the section has a matching litho frame it runs the hierarchical geotech fill on the frame's columns and welds regions by packing class; otherwise it runs the identity fill on the section's own columns and, for geotech, re-groups by class. It drops fallback-painted regions, logs a per-section summary, and refuses to build (returning null) if any section input lacks its id. Sections the frame assembly skipped are still added as empty entries, and if nothing fillable remains it returns null.

**Why it is here.** The inline comments record each guard's reason: identity is decided from the rendered picture, not a second engine, so the two can never disagree (owner ruling R6); fallback regions are never anchored to identity facts because they are inferred, not measured; a section with no id is refused rather than posted because the server cannot verify coverage without it (audit P1-3); empty sections are still listed because the server's coverage rule is exact and "this section holds no evidence" is an honest statement; and an all-empty assembly returns null because the endpoint refuses an empty payload, so the caller must never fire one.

.. CG-EXPLANATION-END id=function:buildBodyRecomputePayload

