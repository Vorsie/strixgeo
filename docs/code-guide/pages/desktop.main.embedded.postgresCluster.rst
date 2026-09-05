desktop.main.embedded.postgresCluster
=====================================

.. CG-PAGE source=desktop/src/main/embedded/postgresCluster.ts complete=true

*Source file:* ``desktop/src/main/embedded/postgresCluster.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's *docstring* — a comment introducing the file for the reader. It says this file owns the full life of the bundled PostgreSQL database server: creating its on-disk storage, starting it, waiting for it, and stopping it. In PostgreSQL a *cluster* means one such on-disk store — a data directory holding one server's databases (not several machines). This file is the part of the embedded stack that actually touches the disk and launches programs.

**Why it is here.** Everything that can be decided without touching the disk — resolving paths, picking a port, minting credentials, building the connection string — lives in separate, pure sibling files that are unit-tested on their own. What is left here is the messy real-world part: spawning the database program (a *child process* — a separate program this app launches and supervises) and waiting on it. That part cannot be proven correct by a quick unit test, so it is verified by actually installing the app and booting it.

.. CG-EXPLANATION-END id=module-header

``const READY_TIMEOUT_MS``
--------------------------

.. CG-BLOCK id=const:READY_TIMEOUT_MS lines=19-21

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 19-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:READY_TIMEOUT_MS

**What this does.** Sets how long to wait for the server to start accepting connections before giving up — 60,000 milliseconds, i.e. one minute. Milliseconds are thousandths of a second, the unit computers keep time in.

**Why it is here.** A minute is comfortably longer than a healthy server needs, so the app never gives up on a slow-but-fine startup, while still failing eventually rather than hanging forever if the server is genuinely never coming up.

.. CG-EXPLANATION-END id=const:READY_TIMEOUT_MS

``const READY_POLL_MS``
-----------------------

.. CG-BLOCK id=const:READY_POLL_MS lines=22-32

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 22-32
   :lineno-match:

.. CG-EXPLANATION-START id=const:READY_POLL_MS

**What this does.** Sets the gap between two checks of whether the server is ready yet to 250 milliseconds — a quarter of a second.

**Why it is here.** A quarter-second gap notices a ready server almost immediately without the app hammering the check thousands of times a second and wasting the processor while it waits.

.. CG-EXPLANATION-END id=const:READY_POLL_MS

``const EXPECTED_POSTGRES_MAJOR``
---------------------------------

.. CG-BLOCK id=const:EXPECTED_POSTGRES_MAJOR lines=33-47

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 33-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:EXPECTED_POSTGRES_MAJOR

**What this does.** Records the PostgreSQL *major version* this build bundles — the string ``16``. (A major version is the big number, like 16, as opposed to a minor bug-fix number like 16.10.)

**Why it is here.** A PostgreSQL server of one major version cannot open a data directory that was created by a different major version — the on-disk format is version-specific. So a future build that bundles a newer PostgreSQL must not silently try to reuse the old storage; this recorded number is what lets the code detect that mismatch. It is kept as text because the version marker on disk is compared as text.

.. CG-EXPLANATION-END id=const:EXPECTED_POSTGRES_MAJOR

``function clusterVersionMismatchMessage``
------------------------------------------

.. CG-BLOCK id=function:clusterVersionMismatchMessage lines=48-64

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 48-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:clusterVersionMismatchMessage

**What this does.** Compares the version marker read from an existing data directory against the bundled major version. It takes the first dot-separated token of the marker (which is the compatibility major, whether the file reads ``16`` or an old-style ``9.6``), trims a trailing newline, and returns nothing when the majors match — or, when they differ, a complete plain-language sentence naming both versions and telling the user to install the matching StrixGeo version or start fresh.

**Why it is here.** If the app simply started a version-16 server against version-17 storage it would fail with an unreadable internal database error. This turns that into a clear, self-contained explanation the user can act on, and by returning a value rather than acting it stays pure and testable.

.. CG-EXPLANATION-END id=function:clusterVersionMismatchMessage

``interface RunningCluster``
----------------------------

.. CG-BLOCK id=interface:RunningCluster lines=65-78

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 65-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RunningCluster

**What this does.** Describes a running server: the ``process`` (the launched database child process), the ``port`` it listens on, and a ``failure`` field that is empty while things are fine and later filled with the reason the server died or never started. An *interface* is a written description of the fields a value must carry.

**Why it is here.** The ``failure`` field is filled in the background, the moment the server reports trouble, precisely so the waiting code can fail immediately and by name instead of pointlessly polling a server that is never going to answer.

.. CG-EXPLANATION-END id=interface:RunningCluster

``type LogLine``
----------------

.. CG-BLOCK id=type:LogLine lines=79-81

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 79-81
   :lineno-match:

.. CG-EXPLANATION-START id=type:LogLine

**What this does.** Describes a *log sink* — a function that takes one line of text and writes it somewhere. In a packaged build that somewhere is the backend log file.

**Why it is here.** Passing the log destination in as a plain function lets this file record everything it does without knowing or caring where the lines end up, which keeps it free of any dependency on Electron or a particular file.

.. CG-EXPLANATION-END id=type:LogLine

``type ClusterInitOutcome``
---------------------------

.. CG-BLOCK id=type:ClusterInitOutcome lines=82-103

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 82-103
   :lineno-match:

.. CG-EXPLANATION-START id=type:ClusterInitOutcome

**What this does.** Names the three things the storage-creation step can report: ``reused`` (a finished cluster was already there), ``created`` (it was made fresh), and ``recovered`` (a previous first launch had died part-way and its remains were cleared before making a new one).

**Why it is here.** The three are kept distinct because they are genuinely different facts about the machine — only ``created`` and ``recovered`` explain a slow first launch, and ``recovered`` in particular flags that an earlier launch crashed, which is worth seeing in the log.

.. CG-EXPLANATION-END id=type:ClusterInitOutcome

``function initialiseCluster``
------------------------------

.. CG-BLOCK id=function:initialiseCluster lines=104-201

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 104-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:initialiseCluster

**What this does.** Creates the database storage when needed, handling three cases. If the version marker file is present, the storage is finished — but it is read (not merely checked for existence) so a bundled-version mismatch can be caught here with a clear message; otherwise the storage is reused. If nothing is there, it is created. If something is there but has no version marker, a previous first launch died part-way, so the remains are moved aside (never deleted) and a fresh cluster is made. It then writes the password to a file *outside* the data directory, runs the database initialiser (``initdb``) with explicit UTF-8 encoding, the ``C`` sort order, and password login over the loopback network, deletes the password file, and finally checks the result — telling apart the initialiser never running at all from it running and reporting an error.

**Why it is here.** The half-finished third case is the one that matters: the initialiser refuses any non-empty target, so a directory left over from a crashed first launch would otherwise break every future start with the same error forever. Moving it aside rather than deleting loses no data (it was never a working database) while still leaving the evidence for diagnosis. The password goes in a file, not on the command line, because a command line is readable by any other program on the machine. UTF-8 and the ``C`` sort order are forced because the default is taken from the Windows account's language, which would otherwise produce a database that sorts differently from every other install — and outright fails to create on an account whose name has non-English characters. The two error branches are split because a program that never launched reports no exit code, so the generic message would throw the real reason away.

.. CG-EXPLANATION-END id=function:initialiseCluster

``function stopOrphanedCluster``
--------------------------------

.. CG-BLOCK id=function:stopOrphanedCluster lines=202-220

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 202-220
   :lineno-match:

.. CG-EXPLANATION-START id=function:stopOrphanedCluster

**What this does.** Before every start, stops any leftover server that is still holding the data directory. It first checks for the server's lock file and returns at once if there is none; otherwise it asks the database control tool to stop whatever owns the directory, and simply logs the result — a failure here is expected and ignored.

**Why it is here.** If the Electron app is killed from Task Manager, its database child keeps running and keeps owning the data directory, and the next launch would then fail to start with a message about another server already running — a dead end for a non-technical tester. Clearing that orphan first turns a stuck installation back into a working one. The failure is ignored because the normal, healthy case is that nothing was left running at all.

.. CG-EXPLANATION-END id=function:stopOrphanedCluster

``function startCluster``
-------------------------

.. CG-BLOCK id=function:startCluster lines=221-292

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 221-292
   :lineno-match:

.. CG-EXPLANATION-START id=function:startCluster

**What this does.** Launches the database server. It spawns ``postgres.exe`` bound to loopback on the given port, with its own logging turned off so its output comes back on a pipe (a direct channel from the child's output to this program) instead of a separate rotating file. It records the running cluster, captures the tail of the server's *stdout* and *stderr* (a program's normal-output and error-output streams) into both the log and a short rolling buffer, and — crucially — attaches handlers for the child's ``error`` event (the program could not be launched at all) and its ``exit`` event (it started then quit), each of which records a plain-language failure.

**Why it is here.** Loopback-only binding keeps the database, which holds every project the engineer has imported, unreachable from the office network. Keeping the server's log on the pipe means the whole story of a launch sits in one place. The ``error`` handler is called mandatory, not defensive: Node delivers a could-not-launch failure as an asynchronous event, and with no listener it would become an uncaught crash outside the boot sequence's safety net — the boot step would hang open, the log would truncate, and the user would get a generic unexpected-error box instead of the one naming what failed. That exact case is real: the distribution notes list antivirus quarantining ``postgres.exe`` as an expected failure on a clean machine, and this is what catches it.

.. CG-EXPLANATION-END id=function:startCluster

``function awaitClusterReady``
------------------------------

.. CG-BLOCK id=function:awaitClusterReady lines=293-343

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 293-343
   :lineno-match:

.. CG-EXPLANATION-START id=function:awaitClusterReady

**What this does.** Waits until the server actually accepts connections, checking repeatedly until a deadline. It is *async* (a function allowed to pause and resume): each round it first checks whether the server has already reported a failure and bails out at once if so, then runs the bundled ``pg_isready`` probe, returning the moment that succeeds; between rounds it ``await``s a short pause so the rest of the app keeps running. If the probe tool itself cannot be launched that is a broken installation and it stops immediately; if the deadline passes it throws, naming the port and the last probe result.

**Why it is here.** It uses ``pg_isready`` rather than a bare is-the-port-open check because an open port only proves the process started, whereas the proper probe also covers the window where the server is up but still replaying its write-ahead log after an unclean shutdown. Checking the recorded failure first, every round, means a server that will never come up is reported in a fraction of a second instead of after the user waits out the full minute — and reported with the right reason.

.. CG-EXPLANATION-END id=function:awaitClusterReady

``function stopCluster``
------------------------

.. CG-BLOCK id=function:stopCluster lines=344-361

.. literalinclude:: ../../../desktop/src/main/embedded/postgresCluster.ts
   :language: typescript
   :lines: 344-361
   :lineno-match:

.. CG-EXPLANATION-START id=function:stopCluster

**What this does.** Shuts the server down cleanly. It asks the database control tool to stop in ``fast`` mode — disconnecting clients and writing everything safely to disk — and, only if that fails, falls back to forcibly killing the process.

**Why it is here.** A plain kill on Windows is an abrupt termination: the server would never write its final checkpoint, so the next launch would start with crash recovery every single time. The ``fast`` stop checkpoints properly; the kill is kept only as a last resort for a server that refuses to stop the polite way.

.. CG-EXPLANATION-END id=function:stopCluster

