groundmodel.infrastructure.db.migrations.versions.da111560a8d6_body_with_extent_rename_tables
=============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/da111560a8d6_body_with_extent_rename_tables.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/da111560a8d6_body_with_extent_rename_tables.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/da111560a8d6_body_with_extent_rename_tables.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that renames the three lens tables to their body names and drops the old content-key columns. The header carries its revision id and the id it follows.

**Why it is here.** It is the rename step of the body-with-extent rewrite: once body identity is carried by id and indexes rather than the content key, the lens tables become the body tables.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=21-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/da111560a8d6_body_with_extent_rename_tables.py
   :language: python
   :lines: 21-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Deletes any lens row still missing its source investigation (unreconcilable leftovers), prints how many, drops the two content-key columns, renames the three tables children-first to ``body_boundary_node``, ``body_boundary_shape`` and ``body``, then makes the source-investigation column not-nullable.

**Why it is here.** The docstring explains the leftover rows are pre-bilateral stale artefacts that cannot be reconciled, so pre-ship amnesty deletes them to let the not-null change succeed. Renaming children-first keeps foreign keys valid through the rename.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=63-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/da111560a8d6_body_with_extent_rename_tables.py
   :language: python
   :lines: 63-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses the renames and the not-null rule and restores empty content-key columns; the dropped content-key data is not recoverable.

**Why it is here.** The rename and constraint reverse cleanly, but the content-key values are gone, so only empty columns can be restored.

.. CG-EXPLANATION-END id=function:downgrade

