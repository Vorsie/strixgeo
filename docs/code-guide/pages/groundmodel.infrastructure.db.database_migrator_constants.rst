groundmodel.infrastructure.db.database_migrator_constants
=========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/database_migrator_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/database_migrator_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-119

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator_constants.py
   :language: python
   :lines: 1-119
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Gathers every fixed value the migrator and its command-line
shim use: the maintenance database name, the PostGIS extension name, the wait
timeout and poll interval, the migrations folder name, the stage names, the exit
codes, the backup environment switches, and — importantly — ``HEAD_REVISION``,
the schema version this build ships.

**Why it is here.** Keeping them in one file means a change (a longer timeout, a
renamed stage) touches one place. ``HEAD_REVISION`` deserves special note: it is
what lets the migrator take its fast path, and it *must* equal the true latest
migration. Two safety nets keep it honest — a unit test turns red if a new
migration lands without bumping it, and at runtime any mismatch simply falls
through to the slow-but-correct path. The rule is: bump this value in the same
commit as any new migration.

.. CG-EXPLANATION-END id=module-header

