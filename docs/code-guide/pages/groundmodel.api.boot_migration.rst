groundmodel.api.boot_migration
==============================

.. CG-PAGE source=src/groundmodel/api/boot_migration.py complete=true

*Source file:* ``src/groundmodel/api/boot_migration.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../src/groundmodel/api/boot_migration.py
   :language: python
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports the one worker it leans on,
``DatabaseMigrator``, plus the settings and the timeout values. The file's job
is to bring the database up to the correct version *inside the engine process*
at start-up.

**Why it is here.** The docstring tells the story. The packaged app used to bring
the database up to date with a whole *second* Python program, started after the
bundled PostgreSQL had finished booting and before the engine started — three
slow cold-starts stacked one after another, over a minute of it avoidable.
Folding that step into the engine deletes the second program and lets the
engine's own slow load happen *at the same time* as the database booting. The
engine loads everything first, then — here — waits for the database and updates
it. See the boot story in ``docs/distribution-build.md``.

.. CG-EXPLANATION-END id=module-header

Function ``def _engine_migration_requested``
--------------------------------------------

.. CG-BLOCK id=function:_engine_migration_requested lines=52-69

.. literalinclude:: ../../../src/groundmodel/api/boot_migration.py
   :language: python
   :lines: 52-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:_engine_migration_requested

**What this does.** Returns ``True`` only when the launcher set a particular
environment switch (``STRIX_ENGINE_MIGRATE``) to a "yes" value. It reads the
switch from a mapping so a test can hand it a fake one.

**Why it is here.** Only the packaged app should migrate from inside the engine.
In development, in continuous integration, and in the end-to-end test harness the
database is brought up to date separately, so this must be a do-nothing there.
The switch is how the engine tells the two situations apart.

.. CG-EXPLANATION-END id=function:_engine_migration_requested

Function ``async def run_boot_migration``
-----------------------------------------

.. CG-BLOCK id=function:run_boot_migration lines=70-138

.. literalinclude:: ../../../src/groundmodel/api/boot_migration.py
   :language: python
   :lines: 70-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:run_boot_migration

**What this does.** The single entry point the start-up routine calls. If the
launcher asked for it, it waits (with a time limit) for the database to accept
connections and then updates the schema in this process; if the launcher did not
ask, it does nothing and says so in the log. It hands back ``True`` when it
migrated and ``False`` when it skipped.

**Why it is here.** This is the thin wrapper that ties the "should I?" check to
the actual ``DatabaseMigrator`` work, with all the knobs (which database, how
long to wait) defaulting to the real runtime values but overridable in a test.
The many arguments after the ``*`` are keyword-only on purpose, so a caller
always spells out what it is passing. If a migration step fails it lets the error
travel up, so the engine refuses to serve against a half-updated database rather
than starting quietly on top of one.

.. CG-EXPLANATION-END id=function:run_boot_migration

