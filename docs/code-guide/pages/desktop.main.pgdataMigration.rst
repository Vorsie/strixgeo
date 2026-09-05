desktop.main.pgdataMigration
============================

.. CG-PAGE source=desktop/src/main/pgdataMigration.ts complete=true

*Source file:* ``desktop/src/main/pgdataMigration.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's *docstring* — a comment explaining the file for the reader. It handles a one-time move: relocating the database's storage folder (its data directory, called ``pgdata``) from the user's *Roaming* profile to their *Local* profile. On Windows the Roaming profile is a per-user folder that a company network can automatically sync to a shared drive; the Local profile stays on that one machine. Before the database server starts, if an old Roaming ``pgdata`` exists and no Local one does yet, this file moves it.

**Why it is here.** The app changed where it keeps its large stores — moving them to the machine-local profile — and without this step an already-installed profile that had created its database under Roaming would be stranded: the server would start against an empty Local folder and the user's data would appear to have vanished (it had not; it was in the old Roaming folder). A same-drive move is *atomic and instant* — it happens all-at-once and is the normal case, since the two profiles usually sit on the same ``C:`` drive. A move that crosses drives (a Roaming profile redirected to another disk) falls back to copy-then-verify-then-delete, and never deletes the original until the copy is confirmed good — so a failure always leaves the data exactly where it was. The file-system operations are passed in rather than called directly, so every branch can be unit-tested.

.. CG-EXPLANATION-END id=module-header

``type PgdataMigrationDecision``
--------------------------------

.. CG-BLOCK id=type:PgdataMigrationDecision lines=26-28

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=type:PgdataMigrationDecision

**What this does.** Names the two possible decisions: ``move`` (relocate the storage) or ``skip`` (leave things as they are). A *type* here restricts a value to one of these two words.

**Why it is here.** Separating the yes/no decision from the actual moving keeps the decision logic tiny and pure, so it can be tested on its own without touching any real files.

.. CG-EXPLANATION-END id=type:PgdataMigrationDecision

``type PgdataMigrationResult``
------------------------------

.. CG-BLOCK id=type:PgdataMigrationResult lines=29-31

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 29-31
   :lineno-match:

.. CG-EXPLANATION-START id=type:PgdataMigrationResult

**What this does.** Names the three ways a relocation attempt can end: ``moved`` (it succeeded), ``skipped`` (there was nothing to do), or ``failed`` (it could not complete, and the original was kept intact).

**Why it is here.** The caller and the log need to tell these three apart — in particular ``failed`` is the case that must reassure everyone the original data is untouched, so it cannot be silently lumped in with ``skipped``.

.. CG-EXPLANATION-END id=type:PgdataMigrationResult

``interface PgdataFsOps``
-------------------------

.. CG-BLOCK id=interface:PgdataFsOps lines=32-50

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 32-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PgdataFsOps

**What this does.** Describes the file-system operations a relocation needs: ``exists`` (does a path exist), ``rename`` (move a folder, which throws a specific error when the move would cross drives), ``copyDir`` (copy a folder tree), ``removeDir`` (delete a folder tree), and ``isCrossVolume`` (recognise whether a failed move failed because it crossed drives). An *interface* is a written description of the members a value must provide.

**Why it is here.** Describing the file work as an injected set of operations, instead of calling the real disk directly, is what lets a test drive the whole move — including the tricky cross-drive fallback and its failures — entirely in memory, with no real folders created or destroyed.

.. CG-EXPLANATION-END id=interface:PgdataFsOps

``function decidePgdataMigration``
----------------------------------

.. CG-BLOCK id=function:decidePgdataMigration lines=51-61

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 51-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:decidePgdataMigration

**What this does.** Answers whether to relocate: ``move`` only when the old Roaming storage exists AND the new Local storage does not yet, and ``skip`` in every other case.

**Why it is here.** Requiring the destination to be absent is the safety condition — it guarantees the move only ever runs once, on the first launch of the new layout, and can never overwrite or clash with a Local database that already holds data.

.. CG-EXPLANATION-END id=function:decidePgdataMigration

``const CLUSTER_VERSION_STAMP``
-------------------------------

.. CG-BLOCK id=const:CLUSTER_VERSION_STAMP lines=62-73

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 62-73
   :lineno-match:

.. CG-EXPLANATION-START id=const:CLUSTER_VERSION_STAMP

**What this does.** Names the marker file that every valid PostgreSQL data directory carries — ``PG_VERSION`` — which is used to confirm a cross-drive copy actually completed before the original is deleted.

**Why it is here.** ``PG_VERSION`` is written by PostgreSQL as the final touch of creating its storage, so its presence in the copied folder is a reliable proof the copy is whole. Checking for it before deleting the original is exactly what makes the cross-drive path safe.

.. CG-EXPLANATION-END id=const:CLUSTER_VERSION_STAMP

``function migratePgdata``
--------------------------

.. CG-BLOCK id=function:migratePgdata lines=74-117

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 74-117
   :lineno-match:

.. CG-EXPLANATION-START id=function:migratePgdata

**What this does.** Performs the relocation when needed. If the decision is ``skip`` it returns at once. Otherwise it tries a plain rename first; if that fails for a reason other than crossing drives it gives up and keeps the original. If it failed because the move crossed drives, it copies the folder, checks the copy carries the ``PG_VERSION`` marker — deleting the incomplete copy and keeping the original if it does not — and only once the copy is verified does it remove the original.

**Why it is here.** The order is the whole point: the original database is never destroyed until a replacement is proven to exist and be complete. A rename that fails on the same drive, a cross-drive copy that comes out incomplete, or any error mid-copy all end with the user's data sitting exactly where it started, so a botched move can never lose a project.

.. CG-EXPLANATION-END id=function:migratePgdata

``function realPgdataFsOps``
----------------------------

.. CG-BLOCK id=function:realPgdataFsOps lines=118-128

.. literalinclude:: ../../../desktop/src/main/pgdataMigration.ts
   :language: typescript
   :lines: 118-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:realPgdataFsOps

**What this does.** Provides the real, production version of those file-system operations, backed by Node's built-in ``fs`` module — existence checks, folder rename, recursive copy and delete, and recognition of the cross-drive error code.

**Why it is here.** This is the one place the abstract operations meet the actual disk. Node's ``fs`` is loaded on demand here rather than at the top of the file so the module can still be imported in a browser-like test environment that has no real file system — the pure decision logic stays testable even where ``fs`` does not exist.

.. CG-EXPLANATION-END id=function:realPgdataFsOps

