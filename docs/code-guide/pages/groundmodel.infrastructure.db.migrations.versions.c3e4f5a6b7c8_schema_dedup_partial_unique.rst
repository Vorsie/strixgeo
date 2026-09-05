groundmodel.infrastructure.db.migrations.versions.c3e4f5a6b7c8_schema_dedup_partial_unique
==========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c3e4f5a6b7c8_schema_dedup_partial_unique.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c3e4f5a6b7c8_schema_dedup_partial_unique.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c3e4f5a6b7c8_schema_dedup_partial_unique.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds two partial unique indexes — one on ``cpt``, one on ``borehole`` — over (project, source project, test) so a true duplicate cannot exist. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains the duplicate-check query filters on those three columns, and without a covering index PostgreSQL scans the whole table each time — fine at 50 CPTs, slow at 500-plus. The indexes are UNIQUE as defence-in-depth: the application already blocks duplicates with a 409, but a database-level unique also stops a race between two simultaneous inserts.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=43-117

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c3e4f5a6b7c8_schema_dedup_partial_unique.py
   :language: python
   :lines: 43-117
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** First removes any existing duplicate rows per (project, source project, test), keeping the earliest-imported one, then creates the two partial unique indexes over rows that have a project id.

**Why it is here.** The docstring notes the index cannot be built while duplicates exist, so they are cleared first. The partial condition (project id present) matches the scoping rule that the same test can appear in two different app projects. The comment records that the concurrent-build option is unavailable inside a migration's transaction, and that pre-ship there are no users, so a brief lock is safe.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=118-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c3e4f5a6b7c8_schema_dedup_partial_unique.py
   :language: python
   :lines: 118-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two dedup indexes.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

