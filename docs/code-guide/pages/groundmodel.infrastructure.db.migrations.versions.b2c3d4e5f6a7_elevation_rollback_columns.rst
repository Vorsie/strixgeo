groundmodel.infrastructure.db.migrations.versions.b2c3d4e5f6a7_elevation_rollback_columns
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b2c3d4e5f6a7_elevation_rollback_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b2c3d4e5f6a7_elevation_rollback_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2c3d4e5f6a7_elevation_rollback_columns.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds three original-elevation snapshot columns to both the CPT and borehole tables.

**Why it is here.** The docstring records the purpose (debt #21): the snapshot captures the upstream surface height the first time the user manually overrides it, so clearing a manual edit restores the surveyed value instead of nulling the row — a graceful undo rather than losing the height. All three are nullable with no default, because a snapshot is genuinely absent until the first override, and empty is the marker the rollback logic keys on. This honours the elevation-trust rule that a surveyed collar value is worth preserving.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=31-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2c3d4e5f6a7_elevation_rollback_columns.py
   :language: python
   :lines: 31-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the original elevation, original vertical-system, and original elevation-source columns to both tables.

**Why it is here.** Together they snapshot the full original height record so a cleared override restores exactly what was surveyed.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=42-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b2c3d4e5f6a7_elevation_rollback_columns.py
   :language: python
   :lines: 42-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the three snapshot columns from both tables.

**Why it is here.** So the chain can step backwards; the reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

