desktop.renderer.src.utils.sectionPartition.columnReduce
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionPartition/columnReduce.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionPartition/columnReduce.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/columnReduce.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file holding the two-and-a-bit column-reduction helpers that survived the v1 engine: closing depth gaps in a column, collapsing adjacent same-soil units, and computing the bottom-tie line. It imports the column and unit shapes.

**Why it is here.** The comment records (debt #280) that the rest of the old column-reduction code — interval extraction, side reduction, drilled-depth arithmetic — served only the v1 fill and left with it; only these general helpers were kept.

.. CG-EXPLANATION-END id=module-header

``function closeColumnGaps``
----------------------------

.. CG-BLOCK id=function:closeColumnGaps lines=24-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/columnReduce.ts
   :language: typescript
   :lines: 24-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:closeColumnGaps

**What this does.** Walks a column's units top to bottom and snaps each unit's base down to the next unit's top, editing them in place, so the stack has no vertical gaps or overlaps. The deepest unit keeps its own base as the column floor.

**Why it is here.** The accepted litho layers can carry a depth gap where a rejected segment's base no longer meets the next unit's top. The litho bands hide this by drawing contact-to-next-contact, and the docstring records the partition fill must do the same or it shows a hole (dogfeed 2026-06-08).

.. CG-EXPLANATION-END id=function:closeColumnGaps

``function collapseAdjacentSameFormation``
------------------------------------------

.. CG-BLOCK id=function:collapseAdjacentSameFormation lines=50-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/columnReduce.ts
   :language: typescript
   :lines: 50-91
   :lineno-match:

.. CG-EXPLANATION-START id=function:collapseAdjacentSameFormation

**What this does.** Merges runs of neighbouring units that share BOTH the same soil and the same body into one unit, editing the stack in place and keeping the shallowest unit's body as the representative.

**Why it is here.** Soil is the fill primitive: a stack of same-soil beds is one matrix band regardless of how the resolver split it into bodies, and without merging, one column's single matrix facing another's split matrix orphans the surplus into spurious pinches. The docstring explains the merge is gated on body id as well as soil so that two genuinely different bodies of the same soil, exposed when an interbedded lens is pulled, are kept apart — otherwise the deep sand top a correlation needs would be erased (the S6 case, spec section 9).

.. CG-EXPLANATION-END id=function:collapseAdjacentSameFormation

``function computeBottomTieLine``
---------------------------------

.. CG-BLOCK id=function:computeBottomTieLine lines=92-205

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/columnReduce.ts
   :language: typescript
   :lines: 92-205
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeBottomTieLine

**What this does.** Builds a per-column elevation line from the base-tie correlations (edges tied base-to-base). It maps every layer id to its column and base elevation, turns each base-tie into a segment between two columns, and at every column takes the DEEPEST interpolated value across all segments that span it (the lower envelope). The soil and body come from the deeper end of the winning segment; columns no segment covers stay null, except at the outer ends where the nearest covered value extends flat outward.

**Why it is here.** Base-ties are how the deepest units, which have no layer below them, are correlated across gaps; the lower envelope gives the substrate a single deepest floor to fill down to, and the flat outward extension continues that substrate past the section ends. The deeper-end identity is carried because the deeper soil is the one that owns the ground down there.

.. CG-EXPLANATION-END id=function:computeBottomTieLine

