groundmodel.infrastructure.db.migrations.versions.x8y9z0a1b2c3_rename_parent_model_id
=====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/x8y9z0a1b2c3_rename_parent_model_id.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/x8y9z0a1b2c3_rename_parent_model_id.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/x8y9z0a1b2c3_rename_parent_model_id.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``x8y9z0a1b2c3``, following ``w7x8y9z0a1b2``) that renames the geological-model parent column to the kind-neutral ``parent_model_id``.

**Why it is here.** The docstring records audit NAME-09: the column holds the parent model one level up the three-level hierarchy, but a geotechnical model's parent is a lithostratigraphic model, so the word 'geological' in the old name was false for a third of its uses. A plain rename preserves the data, foreign key, index and check constraint; old saved projects still restore through a read-side alias.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=32-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/x8y9z0a1b2c3_rename_parent_model_id.py
   :language: python
   :lines: 32-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Renames the parent-model foreign-key column to ``parent_model_id``.

**Why it is here.** This states what the column is without lying about the parent's kind.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=39-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/x8y9z0a1b2c3_rename_parent_model_id.py
   :language: python
   :lines: 39-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Restores the retired kind-specific column name.

**Why it is here.** This reverses the rename.

.. CG-EXPLANATION-END id=function:downgrade

