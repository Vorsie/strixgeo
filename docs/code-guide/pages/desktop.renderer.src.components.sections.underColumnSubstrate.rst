desktop.renderer.src.components.sections.underColumnSubstrate
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/underColumnSubstrate.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/underColumnSubstrate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/underColumnSubstrate.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Builds the fill for the column-width sliver BELOW each test's drilled depth, its TD, on the section.

**Why it is here.** The docstring records that this was forked verbatim from the frozen v1 helper with exactly ONE change, for the S60 owner rule: below a column's TD the space belongs to the partition, so the gap regions' fill must run continuously under the column glyph. The old v1 guard rejected any edge slice whose top sat above the TD, which under the v2 engine (whose bottom unit runs continuously through the TD) threw the sand away and extended the deeper clay up to the TD, producing the B2 phantom clay-directly-under-the-sand block. Here every slice is clipped to the below-TD band instead. A reconciliation trigger is noted: fold this clip-only guard back into the v1 helper and delete this fork once the v2 cutover unfreezes the shared file.

.. CG-EXPLANATION-END id=module-header

``const EPS``
-------------

.. CG-BLOCK id=const:EPS lines=38-58

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/underColumnSubstrate.ts
   :language: typescript
   :lines: 38-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:EPS

**What this does.** A one-centimetre elevation tolerance. The comment after it describes the substrate function.

**Why it is here.** It matches the v1 helper's own local tolerance so the fork stays byte-identical on the four frozen v1 cases.

.. CG-EXPLANATION-END id=const:EPS

``function computeUnderColumnSubstrateForRender``
-------------------------------------------------

.. CG-BLOCK id=function:computeUnderColumnSubstrateForRender lines=59-172

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/underColumnSubstrate.ts
   :language: typescript
   :lines: 59-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeUnderColumnSubstrateForRender

**What this does.** For each column it reads the stack of soil bands at its left and right gap edges below the TD, clipping each slice to the below-TD band, filling any vertical void with the formation directly above it, and merging consecutive same-formation bands; then it draws those bands as quads: sloped across the column when both edges carry the same stack, or flat from whichever side has data when they differ.

**Why it is here.** The single removed line is the v1 rejection of slices that straddle the TD, because the partition owns the sub-TD space and a region running through the TD must contribute its below-TD portion (clip it, do not reject it). Owner ruling 2026-08-31 on CS1's S7A: even a lens is sliced by its geometry, because a neighbour's band that travels the gap as a lens but arrives at this edge at real thickness is ground the partition carries there, while a lens that has pinched out at the edge slices to nothing and contributes nothing.

.. CG-EXPLANATION-END id=function:computeUnderColumnSubstrateForRender

