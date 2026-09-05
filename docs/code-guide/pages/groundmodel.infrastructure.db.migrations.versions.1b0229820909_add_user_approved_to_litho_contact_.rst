groundmodel.infrastructure.db.migrations.versions.1b0229820909_add_user_approved_to_litho_contact_
==================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/1b0229820909_add_user_approved_to_litho_contact_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/1b0229820909_add_user_approved_to_litho_contact_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/1b0229820909_add_user_approved_to_litho_contact_.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that adds a ``user_approved`` flag to the litho-contact correlation-edge table. Names its revision id and the migration it follows.

**Why it is here.** Why: not recorded — ask the owner. (The docstring carries only the revision bookkeeping; the reason is inferable from the column name — marking whether the engineer approved a correlation edge — but is not stated.)

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=21-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/1b0229820909_add_user_approved_to_litho_contact_.py
   :language: python
   :lines: 21-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds a non-nullable boolean ``user_approved`` column that defaults to true.

**Why it is here.** The inline note records existing rows are all manual edges, so they default to true — a true default keeps every already-stored edge marked as approved.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=34-36

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/1b0229820909_add_user_approved_to_litho_contact_.py
   :language: python
   :lines: 34-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the column, reversing the add.

**Why it is here.** So the chain can step back.

.. CG-EXPLANATION-END id=function:downgrade

