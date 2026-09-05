groundmodel.infrastructure.db.migrations.versions.c8e15b3d47a9_add_water_table_rollback_columns
===============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c8e15b3d47a9_add_water_table_rollback_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c8e15b3d47a9_add_water_table_rollback_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c8e15b3d47a9_add_water_table_rollback_columns.py
   :language: python
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds two rollback-snapshot columns to ``cpt``: ``original_water_depth_m`` and ``original_water_depth_source``. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains the Parameters inspector offers to clear the engineer's water-table value and put back the file value or the assumption — but the old code overwrote the water depth in place, so the first override destroyed the recorded depth and only a re-import could bring it back. These two columns are the exact counterpart of the collar's elevation-rollback snapshot: the first override captures the recorded pair, and clearing restores and consumes it. The decision itself lives in the domain service so the collar and water-table rollbacks cannot drift apart; docs/ux.md treats a promise the code cannot keep as worse than none.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=56-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c8e15b3d47a9_add_water_table_rollback_columns.py
   :language: python
   :lines: 56-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the two nullable snapshot columns to ``cpt``.

**Why it is here.** The docstring notes no override can have happened before the editing surface existed, so no backfill is needed — every existing row correctly holds no snapshot. Presence of the depth, not the source token, is the sentinel that a snapshot exists.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=64-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c8e15b3d47a9_add_water_table_rollback_columns.py
   :language: python
   :lines: 64-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two rollback columns; any held snapshot is lost with them.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

