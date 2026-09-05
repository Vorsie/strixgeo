desktop.main.diagnosticsStore
=============================

.. CG-PAGE source=desktop/src/main/diagnosticsStore.ts complete=true

*Source file:* ``desktop/src/main/diagnosticsStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring*) plus the ``import`` lines it depends on. The note explains the file's job: write one line per captured problem to ``diagnostics.log`` inside the user's own app-data folder. Each line is *NDJSON* — one complete JSON object (a labelled bag of fields) on its own line, so a file is just a stack of independent records. Rotation (capping the file's size, done through ``logRotation.ts``) keeps it from growing forever. The imports pull in file helpers, the event normaliser and its types from ``diagnosticsEvent``, and the rotation helper.

**Why it is here.** This file runs in Electron's *main process* — the part of the app with full computer access, as opposed to the sandboxed web page the user sees. It is the *capture* half of diagnostics, and capture is always on; *sending* anything is a separate, opt-in step that lives in other files and defaults to off. The note draws the load-bearing line: a log the user can read, delete and hand over on purpose is not telemetry — it is what makes "it crashed on my machine" answerable at all. Every byte has already passed the field whitelist and the redaction pass (the stripping of identifying text), so the file is safe to hand over *by construction*, not by the user's judgement in the moment. The user-data folder is passed in from outside rather than fetched from Electron here, so the automated tests can exercise this file without a real Electron running.

.. CG-EXPLANATION-END id=module-header

``const DIAGNOSTICS_DIR_NAME``
------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_DIR_NAME lines=38-40

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 38-40
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_DIR_NAME

**What this does.** Names the sub-folder, ``'diagnostics'``, that sits inside Electron's per-user app-data folder and holds every diagnostics artefact.

**Why it is here.** Keeping the log, its rotated copies, the consent file and the upload queue together under one predictable, named folder means the whole feature has a single home the user can find, inspect or delete.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_DIR_NAME

``const DIAGNOSTICS_FILENAME``
------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_FILENAME lines=41-49

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_FILENAME

**What this does.** Names the primary log file, ``'diagnostics.log'``; rotated older copies get ``.1`` / ``.2`` suffixes. The comment at the end of the block leads into the next value and is explained there.

**Why it is here.** Writing the name once in a single named place means every part of the code that reads or writes the log agrees on the exact spelling, never a separately retyped literal.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_FILENAME

``const DIAGNOSTICS_MAX_BYTES``
-------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_MAX_BYTES lines=50-52

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 50-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_MAX_BYTES

**What this does.** Sets the rotation threshold to 1 MiB (1024 × 1024 bytes) — when the log grows past this, it is rotated (the current file is set aside and a fresh one started).

**Why it is here.** 1 MiB is roughly 2,000 captured events, far more than any support question needs, and small enough that the whole file still fits in a mail attachment after zipping. The backend log's separate 5 MiB budget is unaffected by this number.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_MAX_BYTES

``const DIAGNOSTICS_MAX_FILES``
-------------------------------

.. CG-BLOCK id=const:DIAGNOSTICS_MAX_FILES lines=53-55

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 53-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIAGNOSTICS_MAX_FILES

**What this does.** Sets the number of rotated older generations kept to ``3``, the same count the backend log uses.

**Why it is here.** Keeping a few generations preserves a little history across rotations without letting the diagnostics folder grow without bound, and matching the backend log's count keeps the two logs behaving the same way.

.. CG-EXPLANATION-END id=const:DIAGNOSTICS_MAX_FILES

``interface DiagnosticsStoreConfig``
------------------------------------

.. CG-BLOCK id=interface:DiagnosticsStoreConfig lines=56-66

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 56-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiagnosticsStoreConfig

**What this does.** Describes the settings the store must be given (an *interface* is a written description of the fields a value must carry): ``userDataDir`` (the absolute path of Electron's per-user folder), ``appVersion`` and ``platform`` (stamped on every event), and an optional ``buildId`` present only on a stamped beta build.

**Why it is here.** These facts are injected rather than read from Electron directly so this file can be tested in isolation, and the version, platform and build id are stamped here by the *main* process so a message arriving from the renderer can never forge which build or platform it claims to come from.

.. CG-EXPLANATION-END id=interface:DiagnosticsStoreConfig

``let config``
--------------

.. CG-BLOCK id=let:config lines=67-76

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 67-76
   :lineno-match:

.. CG-EXPLANATION-START id=let:config

**What this does.** Declares one changeable module-level slot, ``config``, holding either the store's settings or ``null`` when it has not been set yet. The block also carries the note that leads into the next function.

**Why it is here.** A single shared slot is the one place the configure step fills in and every path below reads from, so all of them see the same directory and build facts.

.. CG-EXPLANATION-END id=let:config

``function configureDiagnosticsStore``
--------------------------------------

.. CG-BLOCK id=function:configureDiagnosticsStore lines=77-81

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 77-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureDiagnosticsStore

**What this does.** Stores the given settings into the shared ``config`` slot.

**Why it is here.** The startup code (``index.ts``) calls this once, handing over the real user-data directory and the build facts, so the rest of the file knows where to write and what to stamp on each event.

.. CG-EXPLANATION-END id=function:configureDiagnosticsStore

``function resetDiagnosticsStoreForTests``
------------------------------------------

.. CG-BLOCK id=function:resetDiagnosticsStoreForTests lines=82-86

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 82-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetDiagnosticsStoreForTests

**What this does.** Clears the shared ``config`` slot back to ``null``.

**Why it is here.** This exists only for the tests, so that the configuration set up by one test cannot leak into the next and quietly change its outcome.

.. CG-EXPLANATION-END id=function:resetDiagnosticsStoreForTests

``function requireConfig``
--------------------------

.. CG-BLOCK id=function:requireConfig lines=87-101

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 87-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:requireConfig

**What this does.** Returns the current settings, or throws a clear error whose message names the setup call that was skipped when the store has not been configured.

**Why it is here.** Failing loudly the instant the store is used before it was configured is far safer than silently writing to an empty or wrong path; the error message points straight at the missing startup call.

.. CG-EXPLANATION-END id=function:requireConfig

``function diagnosticsDirPath``
-------------------------------

.. CG-BLOCK id=function:diagnosticsDirPath lines=102-118

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 102-118
   :lineno-match:

.. CG-EXPLANATION-START id=function:diagnosticsDirPath

**What this does.** Returns the absolute path of the diagnostics folder by joining the configured user-data directory with the ``'diagnostics'`` sub-folder name. The block also carries the note that leads into the next function.

**Why it is here.** Building the directory path in one place means every caller — the writer, the reader, the crash bundle — computes it the same way and cannot drift apart.

.. CG-EXPLANATION-END id=function:diagnosticsDirPath

``function diagnosticsLogPath``
-------------------------------

.. CG-BLOCK id=function:diagnosticsLogPath lines=119-136

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 119-136
   :lineno-match:

.. CG-EXPLANATION-START id=function:diagnosticsLogPath

**What this does.** Returns the absolute path of the primary log file by joining the diagnostics folder with ``'diagnostics.log'``. The block also carries the note that leads into the next function.

**Why it is here.** This is the single source of the log's full path, used by the writer, the rotation helper, the reader and the crash bundle, so none of them can point at a different file by mistake.

.. CG-EXPLANATION-END id=function:diagnosticsLogPath

``function diagnosticsBuildFacts``
----------------------------------

.. CG-BLOCK id=function:diagnosticsBuildFacts lines=137-168

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 137-168
   :lineno-match:

.. CG-EXPLANATION-START id=function:diagnosticsBuildFacts

**What this does.** Returns just the build facts — ``appVersion``, ``platform`` and the optional ``buildId`` — pulled from the configuration. The block also carries the note that leads into the next function.

**Why it is here.** The crash bundle's manifest describes the whole installation rather than any one event, so it needs these facts on their own, without having to read an event line to find them.

.. CG-EXPLANATION-END id=function:diagnosticsBuildFacts

``function captureDiagnostic``
------------------------------

.. CG-BLOCK id=function:captureDiagnostic lines=169-204

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 169-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:captureDiagnostic

**What this does.** Records one problem. It runs the raw payload through the field whitelist and redaction (via ``normaliseDiagnosticEvent``), returning nothing if there was nothing worth logging; otherwise it (re)creates the diagnostics folder, rotates the log if it has grown past 1 MiB, and appends the event as a single NDJSON line. The whole body is wrapped so that any failure is swallowed and it returns ``null`` instead.

**Why it is here.** This function must NEVER throw. Every caller is already an error path — a crash handler, an IPC message handler (IPC being how the renderer asks the main process to do something), a renderer-gone listener — and a diagnostics write that failed and masked the original crash would be the worst possible trade. The folder is recreated on every capture, not once at startup, so a user who cleaned out their app-data folder between two crashes still gets the second one recorded.

.. CG-EXPLANATION-END id=function:captureDiagnostic

``function readDiagnosticEvents``
---------------------------------

.. CG-BLOCK id=function:readDiagnosticEvents lines=205-226

.. literalinclude:: ../../../desktop/src/main/diagnosticsStore.ts
   :language: typescript
   :lines: 205-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:readDiagnosticEvents

**What this does.** Reads the primary log back into a list of events: it returns an empty list if the file is absent or unreadable, otherwise splits the text into lines, JSON-parses each non-empty line into an event, and silently skips any line that will not parse.

**Why it is here.** A log truncated by a power cut in the middle of a write must still yield every event captured before the tear — so the reader skips the one torn line and keeps all the rest, rather than discarding the whole file over a single broken record.

.. CG-EXPLANATION-END id=function:readDiagnosticEvents

