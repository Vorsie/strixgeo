desktop.renderer.src.utils.framedGeotechFill
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/framedGeotechFill.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/framedGeotechFill.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/framedGeotechFill.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file computes the "framed geotech fill" — the one derivation that the geotech section view draws, the 3-D voxel build posts, and the body-identity recompute groups masses by. The comment records that it was extracted (2026-08-31) once a second consumer of the geotech fill appeared, so that all three consumers share one computation rather than each re-deriving it on a slightly different axis. It imports the frame assembler and the hierarchical-fill computation, plus the fence-input and partition types, and notes a deliberate runtime import cycle that is safe because both sides are hoisted function declarations that never call each other while the module is first loading.

**Why it is here.** The reason is the owner ruling (2026-08-18) that packing densities sit on top of the litho model, and the body-identity rule (debt #278) that which masses count as one body must be decided from the picture the render actually shows — the hierarchical fill on the litho frame's columns — not re-derived per consumer on a different axis. Keeping this as a sibling of the frame assembler, rather than folding it into that file, is deliberate because that file already carries the god-component warning (debt #201).

.. CG-EXPLANATION-END id=module-header

``function sectionFrameKey``
----------------------------

.. CG-BLOCK id=function:sectionFrameKey lines=43-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/framedGeotechFill.ts
   :language: typescript
   :lines: 43-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionFrameKey

**What this does.** Produces the text key that joins a litho frame to its geotech section: the section id when the caller has one, otherwise the section line's four endpoint coordinates joined together.

**Why it is here.** The docstring explains the fallback is safe because the same section always projects the same line and both models' inputs are assembled from the same cross-section rows, so the endpoints identify the section just as reliably as an id when no id is supplied.

.. CG-EXPLANATION-END id=function:sectionFrameKey

``function buildFrameBySectionId``
----------------------------------

.. CG-BLOCK id=function:buildFrameBySectionId lines=67-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/framedGeotechFill.ts
   :language: typescript
   :lines: 67-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFrameBySectionId

**What this does.** Assembles the litho frame sections and indexes them by their frame key, returning a lookup the voxel build and the body recompute both use to find a section's litho frame. It returns an empty map when there are no frame sections (a plain litho build) or when nothing assembles to a fillable section.

**Why it is here.** Having one builder means the two consumers join their frame identically and cannot diverge. The empty-map case is the signal for callers to fall back to their own whole-section partition, as the docstring records.

.. CG-EXPLANATION-END id=function:buildFrameBySectionId

``interface FramedGeotechFill``
-------------------------------

.. CG-BLOCK id=interface:FramedGeotechFill lines=80-111

.. literalinclude:: ../../../desktop/src/renderer/src/utils/framedGeotechFill.ts
   :language: typescript
   :lines: 80-111
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FramedGeotechFill

**What this does.** Describes one section's result: the frame's own litho partition regions (the axis the fill runs on) and the hierarchical geotech fill computed on that frame.

**Why it is here.** Returning both together lets a caller draw the litho frame and the packing fill from a single result, keeping the two in step.

.. CG-EXPLANATION-END id=interface:FramedGeotechFill

``function computeFramedGeotechFill``
-------------------------------------

.. CG-BLOCK id=function:computeFramedGeotechFill lines=112-138

.. literalinclude:: ../../../desktop/src/renderer/src/utils/framedGeotechFill.ts
   :language: typescript
   :lines: 112-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeFramedGeotechFill

**What this does.** Runs the hierarchical geotech fill on a litho frame. It first computes the frame's litho regions from the frame's columns, edges, apex overrides and along-metres; then it runs the hierarchical fill, feeding it the litho columns/edges/regions plus the geotech columns placed onto the frame's axis (so a column the packing model has not divided contributes an empty stack), the geotech correlation edges, the along-metres, and the packing-class identity map. It returns the litho regions and the hierarchical fill.

**Why it is here.** This is the single computation the three consumers share, so they can never disagree on which masses are one body. Placing the geotech columns onto the frame's axis internally is what keeps an un-divided column from breaking the alignment; passing the same packing-class identity as the render enforces the "one mass, one body" rule (2026-08-21). The packing class it carries is a Belgian-annex characterisation label (NBN EN 1997-1 ANB Tabel 2.1), used here only to decide mass identity — no soil-mechanics calculation happens in this file.

.. CG-EXPLANATION-END id=function:computeFramedGeotechFill

