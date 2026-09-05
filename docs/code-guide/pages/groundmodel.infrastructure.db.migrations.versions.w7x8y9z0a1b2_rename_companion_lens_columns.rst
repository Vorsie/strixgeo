groundmodel.infrastructure.db.migrations.versions.w7x8y9z0a1b2_rename_companion_lens_columns
============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/w7x8y9z0a1b2_rename_companion_lens_columns.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/w7x8y9z0a1b2_rename_companion_lens_columns.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/w7x8y9z0a1b2_rename_companion_lens_columns.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``w7x8y9z0a1b2``, following ``v6w7x8y9z0a1``) that renames the two cross-section companion columns from lens vocabulary to body vocabulary.

**Why it is here.** The docstring records debt #222: the lens table was renamed to ``body`` earlier, but the two cross-section columns pointing at it kept the retired lens wording. A plain column rename preserves the data, the foreign key and the nullability; backwards-compatibility is suspended pre-ship, and old saved projects still restore through a read-side alias map.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=29-34

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/w7x8y9z0a1b2_rename_companion_lens_columns.py
   :language: python
   :lines: 29-34
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Renames ``companion_lens_id`` to ``companion_body_id`` and ``is_lens_companion`` to ``is_body_companion``.

**Why it is here.** This brings the column names into line with the renamed body table.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=35-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/w7x8y9z0a1b2_rename_companion_lens_columns.py
   :language: python
   :lines: 35-38
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Restores the retired lens-companion column names.

**Why it is here.** This reverses the rename.

.. CG-EXPLANATION-END id=function:downgrade

