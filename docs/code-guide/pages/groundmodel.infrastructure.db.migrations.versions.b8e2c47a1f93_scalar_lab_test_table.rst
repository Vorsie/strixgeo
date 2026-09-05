groundmodel.infrastructure.db.migrations.versions.b8e2c47a1f93_scalar_lab_test_table
====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b8e2c47a1f93_scalar_lab_test_table.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b8e2c47a1f93_scalar_lab_test_table.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8e2c47a1f93_scalar_lab_test_table.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a migration and states its job. A migration is a small, ordered, replayable script that changes the database's shape — the layout of its tables, the named grids of rows and columns — so a database built by an older StrixGeo can be brought up to what a newer one expects. The header records this migration's own code-name, its revision id ``b8e2c47a1f93``, and the code-name of the one that must run just before it (``Revises: d4f8a92b6c10``); those ids link every migration into one ordered chain that is the schema's history. The rest imports the tools the migration tool (Alembic) uses. This migration's job is to add one new table, ``scalar_lab_test``.

**Why it is here.** The five typed laboratory tables — grain size, Atterberg limits, calcium-carbonate content, organic content, water content — each hold one kind of result. Anything else DOV reports (grain density, an ASTM classification code, a descriptive calcareous note) had nowhere to live. The docstring makes this one table the single catch-all home for those, so a new scalar parameter later is a one-line config addition rather than a fresh migration. It also explains the two value columns: DOV sends every result as a piece of text, so a number is parsed into ``value_numeric`` and a non-numeric code kept in ``value_text``.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=33-57

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8e2c47a1f93_scalar_lab_test_table.py
   :language: python
   :lines: 33-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the ``scalar_lab_test`` table. Its columns are a unique id; the sample this result belongs to; the raw DOV group and parameter names; a numeric value; a text value; a unit; a method; a test date; and a detection-condition flag. It ties each row to a real ``sample`` row with a foreign key (a column that must point at an existing row in another table) set to delete these results when their sample is deleted, marks ``id`` as the primary key (the row's unique handle), and adds an index (a lookup shortcut) on the sample id.

**Why it is here.** The group and parameter names are stored exactly as DOV sends them — raw upstream tokens, translated only in the desktop display (CLAUDE.md Data Integrity Rule 2). Numbers and codes get separate columns so one holds measured values and the other classification text; both may be empty (nullable) because a not-measurable row, flagged by ``detection_condition``, has neither. The cascade keeps orphaned lab rows from surviving a deleted sample, and the index makes reading all results for one sample fast.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=58-60

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b8e2c47a1f93_scalar_lab_test_table.py
   :language: python
   :lines: 58-60
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Undoes the change: drops the index, then drops the table.

**Why it is here.** Every migration ships with the exact reverse so a database can be stepped back one version; here that means removing the table this migration created.

.. CG-EXPLANATION-END id=function:downgrade

