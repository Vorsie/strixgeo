groundmodel.infrastructure.db.migrations.versions.f3a6b1c0d9e2_index_parent_geological_model_id
===============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f3a6b1c0d9e2_index_parent_geological_model_id.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f3a6b1c0d9e2_index_parent_geological_model_id.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f3a6b1c0d9e2_index_parent_geological_model_id.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f3a6b1c0d9e2``, following ``e2f5a9c3d8b1``) that adds an index on the geological-model table's parent-model foreign-key column.

**Why it is here.** The docstring records senior-review S2: PostgreSQL does not automatically index foreign-key columns, and the delete-time check that looks for child models would otherwise scan the whole table. It is a separate migration because the migration that added the column had already been applied, and editing an applied migration would not re-run.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=25-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f3a6b1c0d9e2_index_parent_geological_model_id.py
   :language: python
   :lines: 25-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the index on the parent-model foreign-key column.

**Why it is here.** This is the index the delete-time child-model check relies on, as the docstring explains.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=34-36

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f3a6b1c0d9e2_index_parent_geological_model_id.py
   :language: python
   :lines: 34-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops that index.

**Why it is here.** This reverses the single index addition.

.. CG-EXPLANATION-END id=function:downgrade

