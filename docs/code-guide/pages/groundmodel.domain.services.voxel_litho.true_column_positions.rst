groundmodel.domain.services.voxel_litho.true_column_positions
=============================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/true_column_positions.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/true_column_positions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/true_column_positions.py
   :language: python
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Moves each section column onto its investigation's TRUE map position before the 3-D build labels space. It imports the maths helper and the column and section value objects, and declares its one public function.

**Why it is here.** This fixes debt #247, the docstring's 'defect'. The labeller ranks sections by distance to a line through the columns' positions, but the frontend had set those positions to each test's projected foot on the densest section it appears on, deliberately, for consistent 2-D drawing. On the real model that sat a median of 11 m (max 65 m) from the true location, with 77 of 83 columns off by more than a metre. Everything else in the builder (the grid, the footprint, the honoured columns) works in true world space, so the labeller was deciding which sections are nearest a point in one space while placing the material about 11 m away in another. This is the exact twin of an earlier footprint bug that had already been fixed. The owner's fix (ruling 2026-07-29, 'rank by true positions') is to re-seat the columns first. It re-measures only: the along-section distances, the section line and the region polygons are untouched, so the 2-D partition the engineer validated is not altered.

.. CG-EXPLANATION-END id=module-header

Function ``def apply_true_column_positions``
--------------------------------------------

.. CG-BLOCK id=function:apply_true_column_positions lines=61-121

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/true_column_positions.py
   :language: python
   :lines: 61-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:apply_true_column_positions

**What this does.** Builds a lookup from investigation id to its true world position, then walks every section and every column. A column whose investigation has a true position and has actually moved is rebuilt at that position; one that has not moved, or whose investigation has no known true position, is copied through unchanged. It returns the re-seated sections plus how many columns moved and the largest shift, and it never changes the input in place.

**Why it is here.** The move must be surgical: only the world coordinates change, while the along-section distance, the section endpoints and the region polygons are copied through verbatim, because this re-measures where the ground is without redrawing the validated 2-D partition. A column whose investigation has no honoured entry keeps the coordinate it arrived with, since dropping it would move geometry rather than re-measure it. The moved count and the largest shift are returned purely so the caller can log the size of the correction; the docstring records that the real model moved 83 columns, up to 64.9 m.

.. CG-EXPLANATION-END id=function:apply_true_column_positions

