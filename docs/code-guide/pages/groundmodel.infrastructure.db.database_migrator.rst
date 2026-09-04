groundmodel.infrastructure.db.database_migrator
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/database_migrator.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/database_migrator.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-82

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 1-82
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the class that takes a brand-new, empty PostgreSQL
database all the way up to the schema the current build expects. It imports
asyncpg (a fast PostgreSQL driver), Alembic (the schema-migration tool), and the
file's own constants and error stages.

**Why it is here.** Normally ``alembic upgrade head`` is run by a person from the
project folder. None of that holds in the shipped app: it carries no project
folder, creates a fresh database in a per-user location, and starts PostgreSQL on
a random free port. Something has to take that empty database to the right
version on *every* launch. This class is that something, in four ordered,
repeatable steps — wait for the server, create the database, add the PostGIS
extension, run the migrations. See ``docs/distribution-db-decision.md``.

.. CG-EXPLANATION-END id=module-header

Function ``def _run_alembic_upgrade``
-------------------------------------

.. CG-BLOCK id=function:_run_alembic_upgrade lines=83-87

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 83-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_alembic_upgrade

**What this does.** A one-line default: run Alembic's "upgrade to the latest
version" against a given configuration.

**Why it is here.** It is pulled out as a swappable seam so tests can replace it
with a do-nothing stand-in — that way the class's own logic can be exercised
without Alembic actually opening a real database connection.

.. CG-EXPLANATION-END id=function:_run_alembic_upgrade

Function ``def _run_pg_dump``
-----------------------------

.. CG-BLOCK id=function:_run_pg_dump lines=88-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 88-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_pg_dump

**What this does.** The default backup step: runs ``pg_dump`` to write a
compressed, restorable copy of the whole database to a file. If ``pg_dump``
fails it raises an error.

**Why it is here.** Before the migrator changes a database that already holds the
user's work, it writes a recovery point first. ``-Fc`` is the compressed format
that ``pg_restore`` can read back. The password is never on the command line — it
rides safely inside the connection string. Like the Alembic runner, it is a
swappable seam so tests never actually spawn ``pg_dump``.

.. CG-EXPLANATION-END id=function:_run_pg_dump

Function ``def _prune_old_backups``
-----------------------------------

.. CG-BLOCK id=function:_prune_old_backups lines=122-148

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 122-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:_prune_old_backups

**What this does.** Deletes all but the newest few backup files in the backup
folder. Newness is read straight from the filename, whose timestamp sorts
correctly as plain text.

**Why it is here.** Each migration writes a fresh recovery point; without pruning
they would pile up forever (a full database dump is not small). It keeps the
newest few and quietly ignores a file it cannot delete — a failed clean-up is
never a reason to fail a migration that already succeeded.

.. CG-EXPLANATION-END id=function:_prune_old_backups

Function ``def _revision_is_known``
-----------------------------------

.. CG-BLOCK id=function:_revision_is_known lines=149-173

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 149-173
   :lineno-match:

.. CG-EXPLANATION-START id=function:_revision_is_known

**What this does.** Answers "does this build know about this schema version?" by
looking it up in the build's own migration history. Any failure to resolve it
counts as "no, unknown".

**Why it is here.** A version stamped in the database that this build has never
heard of is the tell-tale sign that a *newer* build already upgraded the data.
This is the check behind that decision (see ``NewerDatabaseError`` below).

.. CG-EXPLANATION-END id=function:_revision_is_known

Class ``NewerDatabaseError`` — header
-------------------------------------

.. CG-BLOCK id=class:NewerDatabaseError lines=174-191

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 174-191
   :lineno-match:

.. CG-EXPLANATION-START id=class:NewerDatabaseError

**What this does.** A named error type raised when the database is stamped at a
version this build does not recognise.

**Why it is here.** It means an older StrixGeo has been opened on top of data a
newer StrixGeo already upgraded. The right answer is not to migrate (this build
cannot reach a version it does not have) but to tell the user, in plain words, to
install the current version — their data is fine, it is just written for a newer
schema. Giving this its own error type lets the launcher show that specific
message instead of a generic "migration failed".

.. CG-EXPLANATION-END id=class:NewerDatabaseError

Method ``NewerDatabaseError``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:NewerDatabaseError.__init__ lines=192-197

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 192-197
   :lineno-match:

.. CG-EXPLANATION-START id=method:NewerDatabaseError.__init__

**What this does.** Stores the unknown version string and a ready-to-show message
on the error.

**Why it is here.** So the code that catches this error has both the offending
version (for the log) and the exact user-facing sentence (for the dialog).

.. CG-EXPLANATION-END id=method:NewerDatabaseError.__init__

Class ``DatabaseMigratorError`` — header
----------------------------------------

.. CG-BLOCK id=class:DatabaseMigratorError lines=198-218

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 198-218
   :lineno-match:

.. CG-EXPLANATION-START id=class:DatabaseMigratorError

**What this does.** A named error type for when one of the migration steps fails,
carrying *which* step it was.

**Why it is here.** It lives right next to this class rather than in the shared
exceptions file because it means nothing outside this one caller. Carrying the
failed stage lets the command-line shim turn each failure class into its own exit
code, and the message is written to be shown verbatim to a non-technical tester —
so it must stand on its own, with no "see the logs".

.. CG-EXPLANATION-END id=class:DatabaseMigratorError

Method ``DatabaseMigratorError``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigratorError.__init__ lines=219-224

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 219-224
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigratorError.__init__

**What this does.** Stores the failed stage name and a self-contained message on
the error.

**Why it is here.** So callers can both act on the stage (map it to an exit code)
and show the message directly.

.. CG-EXPLANATION-END id=method:DatabaseMigratorError.__init__

Function ``def strip_asyncpg_driver_marker``
--------------------------------------------

.. CG-BLOCK id=function:strip_asyncpg_driver_marker lines=225-248

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 225-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:strip_asyncpg_driver_marker

**What this does.** Turns a database address written in SQLAlchemy's style
(``postgresql+asyncpg://...``) into the plainer form (``postgresql://...``) that
the raw asyncpg driver accepts. It leaves the password untouched.

**Why it is here.** The rest of the app addresses the database in SQLAlchemy's
style, but the low-level connections and ``pg_dump`` want the plain style. This is
the small translator between the two. It never decodes the password, because the
shipped app generates a random one that may contain characters that must not be
altered.

.. CG-EXPLANATION-END id=function:strip_asyncpg_driver_marker

Function ``def _with_database_name``
------------------------------------

.. CG-BLOCK id=function:_with_database_name lines=249-256

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 249-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:_with_database_name

**What this does.** A tiny helper that swaps the database name in an address for
a different one, leaving everything else the same.

**Why it is here.** The migrator needs two addresses: one for the target
application database and one for the always-present ``postgres`` maintenance
database it connects to while creating the first. This produces the second from
the first.

.. CG-EXPLANATION-END id=function:_with_database_name

Class ``DatabaseMigrator`` — header
-----------------------------------

.. CG-BLOCK id=class:DatabaseMigrator lines=257-284

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 257-284
   :lineno-match:

.. CG-EXPLANATION-START id=class:DatabaseMigrator

**What this does.** The class itself. It takes a fresh, empty database to the
right schema version. Every step logs the host, port, database and version it
resolved, and every step is safe to run again.

**Why it is here.** On a coworker's machine there is no terminal — the log file is
the only window into what happened, so each step narrates itself. Being safe to
re-run matters because the shipped app migrates on *every* launch, so the second
launch onward must be a quick "already done" pass. The parameters are all
swappable seams (the connector, the upgrade runner, the backup runner, the clock)
so the whole class can be tested without touching a real database.

.. CG-EXPLANATION-END id=class:DatabaseMigrator

Method ``DatabaseMigrator``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator.__init__ lines=285-303

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 285-303
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator.__init__

**What this does.** The set-up method. It stores the (usually default) database
connector, upgrade runner, backup runner, environment lookup and clock.

**Why it is here.** Each of these is defaulted to the real thing but can be
replaced in a test with a fake, so no test ever opens a real socket, runs a real
upgrade, or spawns a real ``pg_dump``. Reading the environment live by default
means the packaged launcher's settings are seen.

.. CG-EXPLANATION-END id=method:DatabaseMigrator.__init__

Method ``DatabaseMigrator``. ``async def migrate``
--------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator.migrate lines=304-354

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 304-354
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator.migrate

**What this does.** Runs all four steps in order against a freshly started
database: wait for the server, make sure the database exists, make sure PostGIS
is installed, and upgrade to the latest schema. It logs a start line and a
success line.

**Why it is here.** This is the one method the rest of the app calls. It first
splits the address into its parts and derives the maintenance-database address it
needs for the create step, then walks the four steps. If any step fails it raises
a ``DatabaseMigratorError`` naming the stage.

.. CG-EXPLANATION-END id=method:DatabaseMigrator.migrate

Method ``DatabaseMigrator``. ``async def wait_for_server_ready``
----------------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator.wait_for_server_ready lines=355-421

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 355-421
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator.wait_for_server_ready

**What this does.** Waits — with a time limit — for PostgreSQL to start accepting
connections, trying again every fraction of a second. It connects to the
always-present ``postgres`` database because the app database may not exist yet.

**Why it is here.** The launcher starts ``postgres.exe`` and calls this straight
away, but the server can need a second or two to begin listening. If the time
limit passes with no success it raises a clear error naming the host, the port,
and the last connection error — so a coworker sees *where* it looked, not a bare
timeout.

.. CG-EXPLANATION-END id=method:DatabaseMigrator.wait_for_server_ready

Method ``DatabaseMigrator``. ``async def ensure_database_exists``
-----------------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator.ensure_database_exists lines=422-465

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 422-465
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator.ensure_database_exists

**What this does.** Creates the application database if a fresh cluster does not
already have it. It checks first, and only creates if missing.

**Why it is here.** A brand-new PostgreSQL cluster ships with only the built-in
databases, so the app's own must be created. The comment notes two real details:
``CREATE DATABASE`` cannot run inside a transaction (this call is not wrapped in
one, so it is fine), and although the database name is the app's own trusted
value, an embedded quote is still doubled up as a defensive habit.

.. CG-EXPLANATION-END id=method:DatabaseMigrator.ensure_database_exists

Method ``DatabaseMigrator``. ``async def ensure_postgis``
---------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator.ensure_postgis lines=466-494

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 466-494
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator.ensure_postgis

**What this does.** Makes sure the PostGIS extension (the spatial add-on
PostgreSQL needs for map and geometry queries) is installed in the app database,
then reads its version back.

**Why it is here.** The app stores locations and shapes, which PostgreSQL only
understands with PostGIS switched on. "Create if not exists" makes this safe to
run every launch; reading the version back both confirms success and records it
in the log.

.. CG-EXPLANATION-END id=method:DatabaseMigrator.ensure_postgis

Method ``DatabaseMigrator``. ``async def upgrade_to_head``
----------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator.upgrade_to_head lines=495-618

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 495-618
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator.upgrade_to_head

**What this does.** Brings the schema up to the latest version. It first reads the
version the database is stamped at with one cheap query. If that already equals
the version this build ships, it returns immediately — the *fast path*. Otherwise
it loads the full migration machinery, refuses if the database is newer than this
build, writes a backup, and then runs the upgrade.

**Why it is here.** The fast path exists because loading the full migration
machinery and running a do-nothing "upgrade" costs about 30 seconds on the
packaged Python — on *every* launch, with nothing to do (owner report, installer
#12). Reading one version number and returning avoids all of it when there is
nothing to migrate. Any answer other than an exact match — a fresh database, a
behind-head one, or an unknown newer one — falls through to the full, careful
path, so the newer-database guard and the pre-migration backup are never skipped
for a database that is not already exactly up to date. Running the upgrade
happens on a worker thread because Alembic here drives an async engine and starts
its own event loop, which cannot be done from inside the one already running.

.. CG-EXPLANATION-END id=method:DatabaseMigrator.upgrade_to_head

Method ``DatabaseMigrator``. ``def _guard_not_newer_than_this_build``
---------------------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator._guard_not_newer_than_this_build lines=619-652

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 619-652
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator._guard_not_newer_than_this_build

**What this does.** Raises ``NewerDatabaseError`` when the database is stamped at
a version this build's history does not contain. A fresh (unstamped) database is
fine.

**Why it is here.** It is the check that stops an older build from trying — and
failing — to upgrade data a newer build already moved past. It is raised outside
the general migration-error handling so the launcher can show the specific
"install the current version; your data is intact" message.

.. CG-EXPLANATION-END id=method:DatabaseMigrator._guard_not_newer_than_this_build

Method ``DatabaseMigrator``. ``def _checkpoint_before_upgrade``
---------------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator._checkpoint_before_upgrade lines=653-732

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 653-732
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator._checkpoint_before_upgrade

**What this does.** Writes a ``pg_dump`` recovery point *before* a real,
data-changing upgrade. It skips entirely on a fresh database (nothing to save) and
when there is nothing pending. When migrations are pending it names any that
rewrite user data, then — only if the launcher provided the dump path and backup
folder — writes the dump and prunes old ones. In development, with no such folder,
it just says it skipped.

**Why it is here.** The app must never run a data-rewriting migration without a
recovery point first (production-readiness audit H2b). If the dump fails, the
whole upgrade is refused rather than run unprotected. In development the dev
database is not the user's only copy, so the dump is safely skipped.

.. CG-EXPLANATION-END id=method:DatabaseMigrator._checkpoint_before_upgrade

Method ``DatabaseMigrator``. ``async def _current_stamped_revision``
--------------------------------------------------------------------

.. CG-BLOCK id=method:DatabaseMigrator._current_stamped_revision lines=733-742

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/database_migrator.py
   :language: python
   :lines: 733-742
   :lineno-match:

.. CG-EXPLANATION-START id=method:DatabaseMigrator._current_stamped_revision

**What this does.** Reads the one version number recorded in the database's
``alembic_version`` table, or returns nothing when the table does not exist yet
(a fresh database).

**Why it is here.** This one cheap read is what both the fast path and the
newer-database guard are built on. A brand-new database has no such table, and
that missing table is caught and turned into a clean "no version yet" answer
rather than an error.

.. CG-EXPLANATION-END id=method:DatabaseMigrator._current_stamped_revision

