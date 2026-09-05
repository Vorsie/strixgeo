desktop.renderer.src.utils.partitionFillV2.columnSeparation
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/columnSeparation.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/columnSeparation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/columnSeparation.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file keeps every gap wide enough to actually slice. When a CPT and a borehole are drilled at the same station they project to the same along-section position, and after the 1 mm snap the two columns collapse onto one vertical line -- the gap between them slices to nothing and paints an empty white ribbon. This module nudges any such coincident column out to a small minimum separation.

**Why it is here.** The docstring explains why this is invisible to the engineer: columns are drawn at their nudged screen positions and the output is per-gap fractions, so a gap's real width never reaches the renderer -- widening a degenerate gap changes nothing the user sees except that it now paints. Pure module.

.. CG-EXPLANATION-END id=module-header

``const MIN_COLUMN_SEPARATION_M``
---------------------------------

.. CG-BLOCK id=const:MIN_COLUMN_SEPARATION_M lines=28-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/columnSeparation.ts
   :language: typescript
   :lines: 28-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_COLUMN_SEPARATION_M

**What this does.** The minimum along-section distance (2 cm) enforced between two consecutive columns.

**Why it is here.** The docstring records it was chosen to sit well above the 1 mm snap grid (so the two verticals stay distinct integers after snapping) and well below the closest real spacing on any interpreted section in the dev model (Tie-section 8's 42 mm pair), so no existing section's geometry moves.

.. CG-EXPLANATION-END id=const:MIN_COLUMN_SEPARATION_M

``function enforceMinimumColumnSeparation``
-------------------------------------------

.. CG-BLOCK id=function:enforceMinimumColumnSeparation lines=43-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/columnSeparation.ts
   :language: typescript
   :lines: 43-48
   :lineno-match:

.. CG-EXPLANATION-START id=function:enforceMinimumColumnSeparation

**What this does.** Walks the columns left to right and pushes any column that sits at or behind its left neighbour out to the separation floor, leaving already-spaced columns untouched. It changes the columns in place.

**Why it is here.** The docstring notes the sweep is monotone -- each column is moved to at least its neighbour plus the floor -- so a run of coincident columns fans out in input order and the sequence stays strictly increasing.

.. CG-EXPLANATION-END id=function:enforceMinimumColumnSeparation

