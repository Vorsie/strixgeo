groundmodel.infrastructure.db.migrations.env
============================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/env.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/env.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The Alembic environment file. It imports the migration tooling and the async engine, imports every ORM model so all tables are registered, honours a ``DATABASE_URL`` override on the configuration, points the tooling at the full set of tables, and records the app's own table names.

**Why it is here.** This file is what Alembic loads to know how to run migrations. Importing all models first is essential: it registers every table on the shared metadata before the tooling compares the schema. Honouring ``DATABASE_URL`` matches the rest of the stack's precedence, so a command run with that variable set migrates the same database everything else is talking to — notably the separate integration-test database. Recording the app's own table names lets the filter below ignore the PostGIS system tables that would otherwise look like tables to drop.

.. CG-EXPLANATION-END id=module-header

Function ``def include_name``
-----------------------------

.. CG-BLOCK id=function:include_name lines=41-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 41-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:include_name

**What this does.** Tells the auto-generator to consider only the application's own tables and to leave every non-table object alone.

**Why it is here.** Without this the auto-generator would see PostGIS's built-in geocoder tables (visible but not the app's) and propose dropping them. Restricting to the app's own table names keeps generated migrations focused on the real schema.

.. CG-EXPLANATION-END id=function:include_name

Function ``def run_migrations_offline``
---------------------------------------

.. CG-BLOCK id=function:run_migrations_offline lines=48-61

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 48-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:run_migrations_offline

**What this does.** Runs migrations in "offline" mode — producing the SQL statements from the configured address without opening a live database connection.

**Why it is here.** *Offline mode* emits the migration as a script of SQL rather than executing it, which is useful for review or for a database an operator will update by hand.

.. CG-EXPLANATION-END id=function:run_migrations_offline

Function ``def _do_run_migrations``
-----------------------------------

.. CG-BLOCK id=function:_do_run_migrations lines=62-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 62-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:_do_run_migrations

**What this does.** Configures the tooling against an open connection and runs the pending migrations inside one transaction.

**Why it is here.** The shared inner step both the online path uses; wrapping the run in a transaction means a failed migration leaves the schema untouched.

.. CG-EXPLANATION-END id=function:_do_run_migrations

Function ``async def _run_async_migrations``
--------------------------------------------

.. CG-BLOCK id=function:_run_async_migrations lines=72-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 72-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_async_migrations

**What this does.** Opens an async engine to the configured database, runs the migration step on a connection, then disposes of the engine.

**Why it is here.** The app uses the async PostgreSQL driver, so migrations run through an async engine; disposing of it afterwards releases the connection cleanly.

.. CG-EXPLANATION-END id=function:_run_async_migrations

Function ``def run_migrations_online``
--------------------------------------

.. CG-BLOCK id=function:run_migrations_online lines=80-84

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 80-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:run_migrations_online

**What this does.** Runs migrations in "online" mode against a live database, by starting the async run.

**Why it is here.** *Online mode* is the normal path: connect to the real database and apply the changes. It has to start its own async loop because the underlying driver is asynchronous.

.. CG-EXPLANATION-END id=function:run_migrations_online

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=85-88

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/env.py
   :language: python
   :lines: 85-88
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** At load time, picks offline or online mode depending on how Alembic was invoked, and runs that path.

**Why it is here.** Alembic loads this file to perform a migration, so the choice and the run happen at import; the mode is set by the command the operator or launcher used.

.. CG-EXPLANATION-END id=module-statements

