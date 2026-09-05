groundmodel.infrastructure.db.migrations.versions.e1c4a7b9d28f_project_table
============================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e1c4a7b9d28f_project_table.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e1c4a7b9d28f_project_table.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e1c4a7b9d28f_project_table.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that creates the ``project`` table and backfills a row for every project id already referenced by CPTs and boreholes. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains it promotes the app-level project from desktop-only memory into a real database row that owns the project metadata. Until now every CPT and borehole carried a project id whose name lived only in the client.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=34-101

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e1c4a7b9d28f_project_table.py
   :language: python
   :lines: 34-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``project`` with its metadata columns and a status and phase kept as plain text, indexes the archive timestamp, then inserts an Untitled Project row for each distinct project id referenced by a CPT or borehole, ignoring ids already present.

**Why it is here.** Status and phase are plain text so adding a new lifecycle bucket never needs a type-altering migration; validation lives in the domain layer. The docstring deliberately adds no foreign key from CPT or borehole to project, because legacy rows might reference deleted projects and cleaning those edge cases is out of scope; the backfill loses no data and the user renames the placeholder later.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=102-105

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e1c4a7b9d28f_project_table.py
   :language: python
   :lines: 102-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the archive index and the ``project`` table; the backfilled rows are lost.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

