groundmodel.infrastructure.db.migrations.versions.j4d5e6f7a8b9_add_source_check_constraint_to_litho_
====================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/j4d5e6f7a8b9_add_source_check_constraint_to_litho_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/j4d5e6f7a8b9_add_source_check_constraint_to_litho_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/j4d5e6f7a8b9_add_source_check_constraint_to_litho_.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``j4d5e6f7a8b9``, following ``i3c4d5e6f7a8``) that adds a check constraint limiting the correlation-edge source column to exactly ``manual`` or ``auto``.

**Why it is here.** The docstring records #127: the source column was added earlier without a database-level check, and the auto-correlate feature now writes ``auto`` rows, so the constraint locks the column to the two permitted values and catches any future code path that writes an unknown token at the database boundary.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=31-39

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/j4d5e6f7a8b9_add_source_check_constraint_to_litho_.py
   :language: python
   :lines: 31-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the ``manual``-or-``auto`` check constraint to the correlation-edge table.

**Why it is here.** The docstring notes existing rows are all ``manual``, so the constraint adds without any data back-fill.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=40-42

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/j4d5e6f7a8b9_add_source_check_constraint_to_litho_.py
   :language: python
   :lines: 40-42
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the check constraint, leaving the source column an unconstrained text column.

**Why it is here.** This reverses the single constraint addition.

.. CG-EXPLANATION-END id=function:downgrade

