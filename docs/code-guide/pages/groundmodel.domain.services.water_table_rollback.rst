groundmodel.domain.services.water_table_rollback
================================================

.. CG-PAGE source=src/groundmodel/domain/services/water_table_rollback.py complete=true

*Source file:* ``src/groundmodel/domain/services/water_table_rollback.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/domain/services/water_table_rollback.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the pure logic behind the water-table "put it back the way it was" offer, and imports the stored water-source enum. There is no database or file access here.

**Why it is here.** The Parameters inspector offers to restore the original water table, and for that offer to be true something must remember the original: without a snapshot the first engineer override overwrites the file's value in place and it is recoverable only by re-importing. The docs are explicit that copy on a destructive path is part of the safety rail, and a promise the code cannot keep is worse than none. It is deliberately the same shape as the elevation rollback: setting a value always stamps engineer so a re-import never overwrites the engineer's judgement, the first override snapshots the file value, clearing restores and consumes the snapshot, and clearing with no snapshot returns the row to nothing-recorded. It differs in one way: a held snapshot is signalled by the presence of the original depth, not by the source token, so a legacy row with a null source is not the one class of row that cannot be undone.

.. CG-EXPLANATION-END id=module-header

Class ``WaterTableState``
-------------------------

.. CG-BLOCK id=class:WaterTableState lines=41-70

.. literalinclude:: ../../../src/groundmodel/domain/services/water_table_rollback.py
   :language: python
   :lines: 41-70
   :lineno-match:

.. CG-EXPLANATION-START id=class:WaterTableState

**What this does.** A frozen data holder mirroring the four water-table columns of a CPT row: the current depth, its source token, and the snapshotted original depth and original source.

**Why it is here.** It is the full provenance state the rollback logic reads and writes as one unit. The original-source field may legitimately be empty even while a snapshot is held (the legacy-row case), which is exactly why the depth, not the source, is the flag for whether a snapshot exists.

.. CG-EXPLANATION-END id=class:WaterTableState

Function ``def resolve_water_table_change``
-------------------------------------------

.. CG-BLOCK id=function:resolve_water_table_change lines=71-132

.. literalinclude:: ../../../src/groundmodel/domain/services/water_table_rollback.py
   :language: python
   :lines: 71-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolve_water_table_change

**What this does.** Computes the new four-field state for a set-or-clear request. Setting a value stamps engineer, snapshotting the file's depth and source on the first override of a recorded value and otherwise carrying the existing snapshot through. Clearing restores and consumes the snapshot when one is held, and otherwise returns the row to nothing-recorded.

**Why it is here.** It returns all four fields authoritatively so the caller just writes them back. Carrying the existing snapshot through on a later edit is what makes a second change still roll back to the file's value, not to the first thing the engineer typed. Clearing with no snapshot lands the row on nothing-recorded, where every consumer falls back to the assumed default and labels the result accordingly.

.. CG-EXPLANATION-END id=function:resolve_water_table_change

