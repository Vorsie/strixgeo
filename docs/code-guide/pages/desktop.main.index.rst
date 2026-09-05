desktop.main.index
==================

.. CG-PAGE source=desktop/src/main/index.ts complete=true

*Source file:* ``desktop/src/main/index.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-123

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1-123
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long list of ``import`` lines followed by one running statement. The first imports pull in Electron's own building blocks (the ``app`` object, ``BrowserWindow`` for on-screen windows, ``ipcMain`` for answering messages from the web page, native dialogs and menus, the network ``session``, and ``shell`` for handing links to the operating system's browser) and Node's file-system and child-process tools. The rest import this app's own main-process helpers — the ``.strix`` reader and writer, the beta-expiry check, the activation and licence pieces, the diagnostics and crash-bundle code, the recovery store, the embedded-database boot, the security guards, and more. Then ``applyPackagedProfile`` actually runs, and the closing comment introduces the authorised-paths set below.

**Why it is here.** This file is the conductor of the entire main process — the Node.js program with full computer access that starts everything and answers the sandboxed web page (the renderer). Gathering every subsystem's entry point at the top is what lets the lifecycle code below wire them together. ``applyPackagedProfile`` is placed first on purpose because it is the first statement that can affect the app's per-user data folder, and a packaged (installed) build must not share the developer's profile — see ``packagedProfile.ts``.

.. CG-EXPLANATION-END id=module-header

``const authorisedPaths``
-------------------------

.. CG-BLOCK id=const:authorisedPaths lines=124-125

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 124-125
   :lineno-match:

.. CG-EXPLANATION-START id=const:authorisedPaths

**What this does.** Creates an empty set of file paths the app is allowed to read or write. A "set" is a collection that holds no duplicates.

**Why it is here.** The comment (debt #37) states the rule: only two things ever add a path — a file the user just picked in a native open/save dialog (that pick is their consent) and the recent-projects list from a prior session. Every file read or write requested by the web page must name a path already in this set, which defends against a compromised page trying to read something like a key file out of the app's data folder.

.. CG-EXPLANATION-END id=const:authorisedPaths

``function authorisePath``
--------------------------

.. CG-BLOCK id=function:authorisePath lines=126-130

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 126-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:authorisePath

**What this does.** Adds a path to the authorised set after normalising it to one canonical spelling, so two ways of writing the same path still match.

**Why it is here.** A single doorway for granting file permission, called everywhere a dialog returns a chosen path, so the rule for what counts as authorised lives in one place.

.. CG-EXPLANATION-END id=function:authorisePath

``function pathIsAuthorised``
-----------------------------

.. CG-BLOCK id=function:pathIsAuthorised lines=131-143

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 131-143
   :lineno-match:

.. CG-EXPLANATION-START id=function:pathIsAuthorised

**What this does.** Answers whether a given path is in the authorised set, comparing in the same normalised form.

**Why it is here.** The single check every file-reading and file-writing handler runs before it touches the disk on the web page's behalf.

.. CG-EXPLANATION-END id=function:pathIsAuthorised

``const PROJECT_FILE_EXTENSION``
--------------------------------

.. CG-BLOCK id=const:PROJECT_FILE_EXTENSION lines=144-144

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 144-144
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_FILE_EXTENSION

**What this does.** Sets the canonical project-file extension to ``strix``.

**Why it is here.** Kept here rather than imported from the renderer so the main-process build is self-contained; new saves always use ``.strix``.

.. CG-EXPLANATION-END id=const:PROJECT_FILE_EXTENSION

``const PROJECT_FILE_OPEN_EXTENSIONS``
--------------------------------------

.. CG-BLOCK id=const:PROJECT_FILE_OPEN_EXTENSIONS lines=145-154

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 145-154
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_FILE_OPEN_EXTENSIONS

**What this does.** The two extensions the open dialog accepts: the current ``strix`` and the older, pre-rename ``gmproj``.

**Why it is here.** So users with pre-rebrand files can still open them, while every new save emits only ``.strix``.

.. CG-EXPLANATION-END id=const:PROJECT_FILE_OPEN_EXTENSIONS

``const FS_READ_CAP_BYTES``
---------------------------

.. CG-BLOCK id=const:FS_READ_CAP_BYTES lines=155-155

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 155-155
   :lineno-match:

.. CG-EXPLANATION-START id=const:FS_READ_CAP_BYTES

**What this does.** Caps a general authorised file read at 200 mebibytes.

**Why it is here.** The main process reads the whole file into memory before handing it on, so without a cap a multi-gigabyte file would exhaust the main thread regardless of the server's own upload limit (debt #12). This value mirrors the engine's upload cap.

.. CG-EXPLANATION-END id=const:FS_READ_CAP_BYTES

``const PROJECT_READ_CAP_BYTES``
--------------------------------

.. CG-BLOCK id=const:PROJECT_READ_CAP_BYTES lines=156-157

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 156-157
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_READ_CAP_BYTES

**What this does.** Caps a project-file read at 500 mebibytes.

**Why it is here.** A generous ceiling for a bundle that is normally a few megabytes (tens for a 500-CPT import) — headroom for "we got carried away" while still bounding memory use.

.. CG-EXPLANATION-END id=const:PROJECT_READ_CAP_BYTES

``function assertFileSizeUnder``
--------------------------------

.. CG-BLOCK id=function:assertFileSizeUnder lines=158-174

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 158-174
   :lineno-match:

.. CG-EXPLANATION-START id=function:assertFileSizeUnder

**What this does.** Throws a clear error if a file on disk is larger than a given cap, checking the size with a cheap ``statSync`` (which reads the on-disk size without opening the file) before any memory is allocated.

**Why it is here.** It bails BEFORE reading, so an oversized or corrupt file is refused rather than loaded into a buffer big enough to crash the process.

.. CG-EXPLANATION-END id=function:assertFileSizeUnder

``const RECENT_PROJECTS_MAX``
-----------------------------

.. CG-BLOCK id=const:RECENT_PROJECTS_MAX lines=175-175

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 175-175
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECENT_PROJECTS_MAX

**What this does.** Caps the recent-projects list at ten entries.

**Why it is here.** So the menu does not grow without bound and decade-old paths do not accumulate.

.. CG-EXPLANATION-END id=const:RECENT_PROJECTS_MAX

``const RECENT_PROJECTS_FILENAME``
----------------------------------

.. CG-BLOCK id=const:RECENT_PROJECTS_FILENAME lines=176-180

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 176-180
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECENT_PROJECTS_FILENAME

**What this does.** The filename of the recent-projects list, stored in the app's per-user data folder.

**Why it is here.** One named constant so the reader and the writer of the list always agree on which file it is.

.. CG-EXPLANATION-END id=const:RECENT_PROJECTS_FILENAME

``interface RecentProject``
---------------------------

.. CG-BLOCK id=interface:RecentProject lines=181-186

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 181-186
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecentProject

**What this does.** Describes one recent-list entry: a file ``path``, a ``name``, and an ISO timestamp of when it was last opened. (An interface is a written description of a value's fields.)

**Why it is here.** The ``name`` is a snapshot taken at last save; the real project name in the database may have drifted since, but the menu shows what was recorded.

.. CG-EXPLANATION-END id=interface:RecentProject

``const API_PORT``
------------------

.. CG-BLOCK id=const:API_PORT lines=187-187

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 187-187
   :lineno-match:

.. CG-EXPLANATION-START id=const:API_PORT

**What this does.** The fixed port the local engine listens on: 8765.

**Why it is here.** The one port the desktop app and its engine agree to use for the local web interface.

.. CG-EXPLANATION-END id=const:API_PORT

``const API_BASE``
------------------

.. CG-BLOCK id=const:API_BASE lines=188-193

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 188-193
   :lineno-match:

.. CG-EXPLANATION-START id=const:API_BASE

**What this does.** The base web address of the local engine, built from the port: ``http://127.0.0.1:8765``. The address ``127.0.0.1`` means "this computer only".

**Why it is here.** Bound to the loopback address so the engine is reachable only from this machine, never from the network. The comment records why the secret token below exists: to prove a request really comes from our own window.

.. CG-EXPLANATION-END id=const:API_BASE

``const localClientToken``
--------------------------

.. CG-BLOCK id=const:localClientToken lines=194-196

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 194-196
   :lineno-match:

.. CG-EXPLANATION-START id=const:localClientToken

**What this does.** Mints a secret string once, at module load, that is shared only with this launch's engine child process.

**Why it is here.** It proves that a request claiming the ``null`` origin really comes from our own window and not from a hostile page in a sandboxed frame on some site the user has open — see ``localClientToken.ts``. Minted before anything can spawn or fetch.

.. CG-EXPLANATION-END id=const:localClientToken

``const LOG_MAX_BYTES``
-----------------------

.. CG-BLOCK id=const:LOG_MAX_BYTES lines=197-197

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 197-197
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOG_MAX_BYTES

**What this does.** The maximum size of the main log file before it is rotated: 5 megabytes.

**Why it is here.** A log-rotation limit (#214c) so the log cannot grow without bound on disk.

.. CG-EXPLANATION-END id=const:LOG_MAX_BYTES

``const LOG_MAX_FILES``
-----------------------

.. CG-BLOCK id=const:LOG_MAX_FILES lines=198-199

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 198-199
   :lineno-match:

.. CG-EXPLANATION-START id=const:LOG_MAX_FILES

**What this does.** How many rotated backup copies of the log to keep: three.

**Why it is here.** Bounds total log disk use to a few generations while keeping enough history to diagnose a recent problem.

.. CG-EXPLANATION-END id=const:LOG_MAX_FILES

``let apiProcess``
------------------

.. CG-BLOCK id=let:apiProcess lines=200-204

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 200-204
   :lineno-match:

.. CG-EXPLANATION-START id=let:apiProcess

**What this does.** Holds the running engine child process, or ``null`` when none is running. (A "child process" is a separate program the app launches and manages; ``let`` marks a variable that can be reassigned.)

**Why it is here.** The single handle the lifecycle code uses to talk to, or stop, the engine.

.. CG-EXPLANATION-END id=let:apiProcess

``let mainWindow``
------------------

.. CG-BLOCK id=let:mainWindow lines=205-214

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 205-214
   :lineno-match:

.. CG-EXPLANATION-START id=let:mainWindow

**What this does.** Caches the one application window, or ``null``.

**Why it is here.** So a menu rebuild after the recent list changes can target the right window without walking every open window. Single-window app today.

.. CG-EXPLANATION-END id=let:mainWindow

``let quitHandshake``
---------------------

.. CG-BLOCK id=let:quitHandshake lines=215-219

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 215-219
   :lineno-match:

.. CG-EXPLANATION-START id=let:quitHandshake

**What this does.** Holds the close-handshake state for the current window (see ``quitHandshake.ts``).

**Why it is here.** It tracks "the user already confirmed the exit" so a programmatic quit does not re-trigger the close prompt in a loop, plus the escapes for a renderer that never answers. It is replaced per window, not kept for the app's life, because on macOS the app outlives its last window and stale state would make the next window close without ever asking.

.. CG-EXPLANATION-END id=let:quitHandshake

``let mainLogPath``
-------------------

.. CG-BLOCK id=let:mainLogPath lines=220-225

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 220-225
   :lineno-match:

.. CG-EXPLANATION-START id=let:mainLogPath

**What this does.** The absolute path of the main log file — set once in a packaged build, left ``null`` in dev.

**Why it is here.** Exposed to the crash handlers so they can write a timestamped crash line even when no log stream is open.

.. CG-EXPLANATION-END id=let:mainLogPath

``let mainLogAppend``
---------------------

.. CG-BLOCK id=let:mainLogAppend lines=226-230

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 226-230
   :lineno-match:

.. CG-EXPLANATION-START id=let:mainLogAppend

**What this does.** The size-bounded function that appends to the main log, set alongside the path; it re-checks the file size every so often and rotates the log mid-session.

**Why it is here.** So a long, verbose run cannot grow the active log past its cap until the next restart (M8/L1). Null in dev, where writing falls back to the console.

.. CG-EXPLANATION-END id=let:mainLogAppend

``let markBackendReady``
------------------------

.. CG-BLOCK id=let:markBackendReady lines=231-234

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 231-234
   :lineno-match:

.. CG-EXPLANATION-START id=let:markBackendReady

**What this does.** A function, set after the engine is spawned, that records the engine started cleanly.

**Why it is here.** So the exit handler can tell a normal shutdown from a startup crash.

.. CG-EXPLANATION-END id=let:markBackendReady

``let embeddedStack``
---------------------

.. CG-BLOCK id=let:embeddedStack lines=235-240

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 235-240
   :lineno-match:

.. CG-EXPLANATION-START id=let:embeddedStack

**What this does.** The bundled PostgreSQL stack in packaged builds — ``null`` in dev, where Docker owns the database and none of this runs.

**Why it is here.** A packaged build ships its own database; a dev session talks to Docker on port 5433 instead.

.. CG-EXPLANATION-END id=let:embeddedStack

``let embeddedCluster``
-----------------------

.. CG-BLOCK id=let:embeddedCluster lines=241-244

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 241-244
   :lineno-match:

.. CG-EXPLANATION-START id=let:embeddedCluster

**What this does.** The running embedded database cluster handle (packaged only), set asynchronously by the cluster-boot phase.

**Why it is here.** The boot runs CONCURRENTLY with the engine's cold import, so this can still be null while the engine is starting; the stop function reads this module-level handle so a shutdown that races the boot stops whatever is already up.

.. CG-EXPLANATION-END id=let:embeddedCluster

``let lastBackendRespawnAtMs``
------------------------------

.. CG-BLOCK id=let:lastBackendRespawnAtMs lines=245-251

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 245-251
   :lineno-match:

.. CG-EXPLANATION-START id=let:lastBackendRespawnAtMs

**What this does.** When the engine was last respawned this session, or ``null``.

**Why it is here.** A death within the guard window of this time is a crash loop and gives up to the failure banner rather than respawning forever (H3(a)).

.. CG-EXPLANATION-END id=let:lastBackendRespawnAtMs

``let intentionalBackendStop``
------------------------------

.. CG-BLOCK id=let:intentionalBackendStop lines=252-255

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 252-255
   :lineno-match:

.. CG-EXPLANATION-START id=let:intentionalBackendStop

**What this does.** True while the app is deliberately killing the engine (shutdown, or the uncaught-exception handler).

**Why it is here.** So the exit handler does not respawn or flag a failure for a death the app itself caused — otherwise quitting would spawn a lingering backend a second before the app exits. Reset when a fresh engine is spawned so its later unintentional death is respawned normally.

.. CG-EXPLANATION-END id=let:intentionalBackendStop

``const BACKEND_RESPAWN_BACKOFF_MS``
------------------------------------

.. CG-BLOCK id=const:BACKEND_RESPAWN_BACKOFF_MS lines=256-264

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 256-264
   :lineno-match:

.. CG-EXPLANATION-START id=const:BACKEND_RESPAWN_BACKOFF_MS

**What this does.** A one-second delay before respawning an engine that died mid-session.

**Why it is here.** Long enough to let the port free up, short enough to be invisible to the user (H3(a)).

.. CG-EXPLANATION-END id=const:BACKEND_RESPAWN_BACKOFF_MS

``function openMainLog``
------------------------

.. CG-BLOCK id=function:openMainLog lines=265-296

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 265-296
   :lineno-match:

.. CG-EXPLANATION-START id=function:openMainLog

**What this does.** Opens the packaged build's ``backend.log`` in the logs folder, first rotating an over-cap file down to ``.1``, and installs the size-bounded appender.

**Why it is here.** Log rotation (#214c): a stale over-cap file from the previous run rolls to ``.1`` before the first line lands, and the appender rotates again mid-session so a long session cannot grow the active log without bound.

.. CG-EXPLANATION-END id=function:openMainLog

``function writeMainLog``
-------------------------

.. CG-BLOCK id=function:writeMainLog lines=297-314

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 297-314
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeMainLog

**What this does.** Appends one line to the backend log in a packaged build, or prints it to the console in dev; a failed write is swallowed.

**Why it is here.** Backend and database output carry the database connection string, which includes this install's generated password, so in a packaged build it must never reach the renderer console (debt #200 F5). It is synchronous on purpose: a buffered stream once lost the entire startup log when the process died with lines still in the buffer — useless exactly when it is needed.

.. CG-EXPLANATION-END id=function:writeMainLog

``function startApi``
---------------------

.. CG-BLOCK id=function:startApi lines=315-443

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 315-443
   :lineno-match:

.. CG-EXPLANATION-START id=function:startApi

**What this does.** Spawns the Python engine as a child process. It chooses the bundled interpreter (packaged) or the project's virtual-environment Python (dev), runs the engine's own startup module pinned to the loopback address and port 8765, points it at a writable working directory and the right environment (including the secret launch token, and ENVIRONMENT=production when packaged), routes the child's output to the log, and installs an exit listener that decides whether a death is a normal shutdown, a crash to report, or a respawn.

**Why it is here.** The engine is started through its own module rather than the ``uvicorn`` command because the event loop must be pinned through the engine's own hook: a Windows bug seen live on 2 August 2026 saw the default loop retire the listening socket on a transient network error and then refuse every connection while the process stayed alive; the engine's ``serve`` module pins the safe loop. The launch token reaches the child only — never disk, never the renderer — and forcing production mode in a packaged build makes the engine's secret-key guard actually fire (audit #16).

.. CG-EXPLANATION-END id=function:startApi

``function stopApi``
--------------------

.. CG-BLOCK id=function:stopApi lines=444-468

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 444-468
   :lineno-match:

.. CG-EXPLANATION-START id=function:stopApi

**What this does.** Kills the engine child process (marking the kill as intentional) and then stops the embedded database.

**Why it is here.** Order matters: stopping the client before Postgres keeps the shutdown free of error lines in the log, and marking the kill as ours stops the exit handler from respawning it (H3(a)).

.. CG-EXPLANATION-END id=function:stopApi

``function probeBackendOnce``
-----------------------------

.. CG-BLOCK id=function:probeBackendOnce lines=469-487

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 469-487
   :lineno-match:

.. CG-EXPLANATION-START id=function:probeBackendOnce

**What this does.** Makes one web request to the engine's ``/openapi.json`` and classifies the result as reachable, foreign, or unreachable.

**Why it is here.** A packaged probe carries this launch's token, so a foreign engine — an orphaned uvicorn from a crashed previous launch, with a different token — answers with a permission error and is never adopted (H3(b)); a dev or e2e probe carries no token and adopts any listener.

.. CG-EXPLANATION-END id=function:probeBackendOnce

``function handleReadyBackendExit``
-----------------------------------

.. CG-BLOCK id=function:handleReadyBackendExit lines=488-516

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 488-516
   :lineno-match:

.. CG-EXPLANATION-START id=function:handleReadyBackendExit

**What this does.** Handles an engine that died AFTER it had been serving: it re-probes the port, then either ignores the death (an external engine still owns the port), gives up to the failure banner (a second death inside the guard window is a crash loop), or respawns once after the backoff and polls the new engine to readiness.

**Why it is here.** So the app never sits talking to a dead engine, yet also never respawns forever in a loop (H3(a)).

.. CG-EXPLANATION-END id=function:handleReadyBackendExit

``function awaitRespawnedBackendReady``
---------------------------------------

.. CG-BLOCK id=function:awaitRespawnedBackendReady lines=517-549

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 517-549
   :lineno-match:

.. CG-EXPLANATION-START id=function:awaitRespawnedBackendReady

**What this does.** Polls the just-respawned engine up to sixty times; on success it marks the new process ready and tells the renderer the engine is back, and if the respawn never answers or dies again it falls back to the failure banner.

**Why it is here.** So a mid-session restart shows a transient "reconnecting" banner and clears it only when the engine is genuinely serving again (H3(a)).

.. CG-EXPLANATION-END id=function:awaitRespawnedBackendReady

``function relocateMachineLocalStores``
---------------------------------------

.. CG-BLOCK id=function:relocateMachineLocalStores lines=550-581

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 550-581
   :lineno-match:

.. CG-EXPLANATION-START id=function:relocateMachineLocalStores

**What this does.** In a packaged build, moves the large machine-local stores — the live database directory and the numba compile cache — off the roaming user profile onto the local profile before Postgres starts, and points the embedded layout there. A failed move keeps the intact roaming copy and boots from it.

**Why it is here.** The live PostgreSQL cluster must not sit on a roaming share that a domain-joined consultancy syncs or redirects (audit M1). The cache moves too because it is rebuildable, so it carries only a pointer, not a migration; on a failed move both stay roaming together and the move is retried next launch.

.. CG-EXPLANATION-END id=function:relocateMachineLocalStores

``function showBootFailureAndQuit``
-----------------------------------

.. CG-BLOCK id=function:showBootFailureAndQuit lines=582-618

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 582-618
   :lineno-match:

.. CG-EXPLANATION-START id=function:showBootFailureAndQuit

**What this does.** Shows a native "could not start" dialog naming the failed boot step and the log file, then stops the engine and quits.

**Why it is here.** A native dialog because at boot time there may be no window yet; it names the one thing a non-technical tester can usefully send back. A database written by a NEWER build gets its own wording, because the generic stage message would read like corruption when in fact the data is intact and the cure is to install the current build.

.. CG-EXPLANATION-END id=function:showBootFailureAndQuit

``function bootEmbeddedDatabase``
---------------------------------

.. CG-BLOCK id=function:bootEmbeddedDatabase lines=619-663

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 619-663
   :lineno-match:

.. CG-EXPLANATION-START id=function:bootEmbeddedDatabase

**What this does.** Brings the bundled database up in a packaged build. It awaits the fast preparation (paths, secrets, port, environment) so the engine can be spawned against the connection string, then boots the cluster in the background so the engine's roughly 48-second cold import overlaps the database coming up. The engine waits for and migrates the database itself.

**Why it is here.** On installer #13 these two ran one after the other; overlapping them cuts the cold-start wait (owner report). The database boots regardless of the licence gate — the gate only decides whether the engine may spawn now — so a licence-deferred build still has a database ready for the engine that activation starts later.

.. CG-EXPLANATION-END id=function:bootEmbeddedDatabase

``function createWindow``
-------------------------

.. CG-BLOCK id=function:createWindow lines=664-972

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 664-972
   :lineno-match:

.. CG-EXPLANATION-START id=function:createWindow

**What this does.** Creates the application window and wires up all of its guards. It installs the network hooks that attach the launch token to every request to the local engine and set a strict Content-Security-Policy header; opens a 1400-by-900 window with the preload bridge, context isolation on and Node access off, and DevTools disabled in packaged builds; denies pop-up windows and blocks navigation away from the app's own pages (handing genuine external links to the OS browser); builds the menu; installs the close handshake (intercept the OS close, ask the renderer, offer a force-close if it never answers); logs and once-reloads a crashed renderer; mirrors the renderer console into the terminal in dev; and finally loads the page.

**Why it is here.** This is where the sandboxed page's security posture is set (context isolation, no Node, blocked navigation, strict content-security policy — audit #36/#37) and where the save-or-discard close flow and crash recovery are anchored. DevTools is off in a packaged build for two reasons: engine output carries the database password, and a stray Reload would discard the renderer-only session state that crash recovery exists to protect.

.. CG-EXPLANATION-END id=function:createWindow

``function buildMenu``
----------------------

.. CG-BLOCK id=function:buildMenu lines=973-1194

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 973-1194
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildMenu

**What this does.** Builds the native application menu from a template — File (new, open, recent, save, save-as, close, import, settings, quit), Edit (undo, redo), View (reload and DevTools only in dev), and Help (getting started, tutorial, cheatsheet, licence, updates, save-logs-for-support, about). Almost every item just fires a one-way message to the renderer, which owns the actual behaviour. The Recent submenu is rebuilt each time so a newly opened file appears without an app restart.

**Why it is here.** The renderer owns the app's state, so the menu is a set of signals, not actions. View's Reload and DevTools are dev-only: Reload is the single most likely accidental destroyer of unsaved renderer-only state, and DevTools would expose the database password. The raw-log item is dev-only because that file is un-redacted, while the redacted "Save logs for support" is the only log export a shipped build offers.

.. CG-EXPLANATION-END id=function:buildMenu

``function recentProjectsFile``
-------------------------------

.. CG-BLOCK id=function:recentProjectsFile lines=1195-1198

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1195-1198
   :lineno-match:

.. CG-EXPLANATION-START id=function:recentProjectsFile

**What this does.** Returns the full path of the recent-projects file inside the per-user data folder.

**Why it is here.** One place computes where the recent list lives, so the reader and writer never disagree on the location.

.. CG-EXPLANATION-END id=function:recentProjectsFile

``function readRecentProjects``
-------------------------------

.. CG-BLOCK id=function:readRecentProjects lines=1199-1215

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1199-1215
   :lineno-match:

.. CG-EXPLANATION-START id=function:readRecentProjects

**What this does.** Reads and parses the recent-projects file, returning an empty list if it is missing, unreadable or not an array, and filtering out any invalid entries.

**Why it is here.** A corrupt or unreadable file must not block startup, and the per-entry validation caps field lengths so a corrupted file with, say, a 100-megabyte name cannot freeze the menu rebuild (debt #41).

.. CG-EXPLANATION-END id=function:readRecentProjects

``function writeRecentProjects``
--------------------------------

.. CG-BLOCK id=function:writeRecentProjects lines=1216-1225

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1216-1225
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeRecentProjects

**What this does.** Writes the recent-projects list to disk using an atomic write — write to a temporary file, then rename it into place.

**Why it is here.** So a kill mid-write, or a second writer racing, cannot leave the file half-overwritten; recovering the list is friendlier than silently losing it.

.. CG-EXPLANATION-END id=function:writeRecentProjects

``function addRecentProject``
-----------------------------

.. CG-BLOCK id=function:addRecentProject lines=1226-1248

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1226-1248
   :lineno-match:

.. CG-EXPLANATION-START id=function:addRecentProject

**What this does.** Adds a project to the front of the recent list (dropping any existing entry for the same path), trims to the cap, writes it, and authorises every kept path.

**Why it is here.** Move-to-front avoids duplicates when the same project is opened repeatedly; authorising every entry is what lets a later "Open Recent" click read the file without going through a dialog again.

.. CG-EXPLANATION-END id=function:addRecentProject

``function bootstrapAuthorisedPaths``
-------------------------------------

.. CG-BLOCK id=function:bootstrapAuthorisedPaths lines=1249-1547

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1249-1547
   :lineno-match:

.. CG-EXPLANATION-START id=function:bootstrapAuthorisedPaths

**What this does.** The short ``bootstrapAuthorisedPaths`` function authorises every path in the recent list at startup. Everything after it in this block is the first batch of IPC handlers — the endpoints the preload bridge calls. (IPC, inter-process communication, is how the sandboxed page asks the main process to do something; ``ipcMain.handle`` registers a function that answers one named request.) They cover the engine's base URL; the synchronous launch flags; the open-file and open-files dialogs; the guarded ``fs:read-file``; the project open and save dialogs, the file-exists probe, the ``.strix`` read (which decodes and integrity-checks the file, returning a typed success-or-failure) and the ``.strix`` write (which wraps the JSON in the binary container and keeps three previous generations); the generic export save and write used by the DXF export; the worked-example sample project; the sheet-PDF registration; and adding to and reading the recent list.

**Why it is here.** Without the bootstrap, the user's first "Open Recent" click would be refused, because the renderer skips the dialog and so never authorises the path. The handlers are the entire request surface the sandboxed page has, and each file handler re-checks the authorised-path set and the size caps, so a buggy or compromised page cannot read or overwrite an arbitrary file. The ``.strix`` read is flattened into a typed success-or-failure result so a damaged file degrades to "could not open" instead of crossing the boundary as a stripped error.

.. CG-EXPLANATION-END id=function:bootstrapAuthorisedPaths

``const _WINDOW_TITLE_MAX_LEN``
-------------------------------

.. CG-BLOCK id=const:_WINDOW_TITLE_MAX_LEN lines=1548-1687

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1548-1687
   :lineno-match:

.. CG-EXPLANATION-START id=const:_WINDOW_TITLE_MAX_LEN

**What this does.** The constant caps the window title at 256 characters, and the ``window:set-title`` handler uses it. The rest of the block is more IPC handlers: the renderer's quit decision (approve or veto the close), show or hide the window (used by the close flow to take the window away the instant the engineer answers), the ``api:ready`` poll that waits for the engine to start with a packaged-aware deadline, and the whole crash-recovery family — write, list, read, delete, delete-primary, decline and delete-declined.

**Why it is here.** The title is capped so a renderer bug or a crafted call cannot inject an unbounded string into the OS title bar (debt #113). The recovery handlers deliberately never take a file path — their only input is a project id the store validates — so they can never become a way to read or write an arbitrary file; the primary-versus-declined split and the "Open without restoring keeps the copy" rule are the autosave-recovery design's rules (owner decision 3 August 2026).

.. CG-EXPLANATION-END id=const:_WINDOW_TITLE_MAX_LEN

``const CLOSE_FLOW_NOTE_MAX_LEN``
---------------------------------

.. CG-BLOCK id=const:CLOSE_FLOW_NOTE_MAX_LEN lines=1688-1758

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1688-1758
   :lineno-match:

.. CG-EXPLANATION-START id=const:CLOSE_FLOW_NOTE_MAX_LEN

**What this does.** The constant caps a close-flow note at 500 characters, and its handler mirrors one close-flow line from the renderer into the main-process console. The block continues with the logs-path query, a handler that forwards a renderer render error into the log and diagnostics, the ``diagnostics:capture`` endpoint, the display-only beta-status query, and the start of the ``saveDiagnosticsBundle`` helper.

**Why it is here.** The close flow never touches the engine, so a report like "it discarded my work without asking" has no server log behind it — and a packaged build's renderer console goes nowhere, while dogfeed reports arrive as pasted terminal output that shows the main process only. This one bounded channel makes the close sequence readable. It is deliberately NOT a general log bridge — one channel, one string, close-flow lines only.

.. CG-EXPLANATION-END id=const:CLOSE_FLOW_NOTE_MAX_LEN

``function saveDiagnosticsBundle``
----------------------------------

.. CG-BLOCK id=function:saveDiagnosticsBundle lines=1759-1794

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1759-1794
   :lineno-match:

.. CG-EXPLANATION-START id=function:saveDiagnosticsBundle

**What this does.** Builds a diagnostics zip bundle, lets the user choose where to save it, writes it atomically, and shows a confirmation naming its contents and the redaction applied.

**Why it is here.** Driven from Help → "Save logs for support". The bundle is redacted, which is what makes "mail us your logs" a request a consultancy's IT department can say yes to. It needs no authorised-path entry because the user just picked the destination and the renderer never sees the file.

.. CG-EXPLANATION-END id=function:saveDiagnosticsBundle

``let diagnosticsUploader``
---------------------------

.. CG-BLOCK id=let:diagnosticsUploader lines=1795-1809

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1795-1809
   :lineno-match:

.. CG-EXPLANATION-START id=let:diagnosticsUploader

**What this does.** Holds the diagnostics uploader for this run (or ``null``), and begins the documentation of the wiring function below.

**Why it is here.** Declared above its reader on purpose (temporal-dead-zone discipline — a variable read before its declaration line crashes at runtime), so the quit handler can stop its retry timer.

.. CG-EXPLANATION-END id=let:diagnosticsUploader

``function startDiagnosticsUpload``
-----------------------------------

.. CG-BLOCK id=function:startDiagnosticsUpload lines=1810-1873

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1810-1873
   :lineno-match:

.. CG-EXPLANATION-START id=function:startDiagnosticsUpload

**What this does.** Wires up the consent-gated diagnostics transmitter: it builds an uploader pointed at the activation service's origin, enqueues whatever was captured since the last upload (attaching a licence/device identity only when a deliberately-off gate is lifted), and starts draining the queue on an interval. The block also carries the optional hardware-acceleration opt-out and the start of the main-process crash-handler section.

**Why it is here.** The endpoint is the same origin as the activation service (owner ruling 31 August 2026); when no URL is configured (the mock/dogfeed default) or consent is off, every call is inert and nothing leaves the machine — consent is default-off. It is best-effort: any failure is logged and never keeps the app from starting. The GPU opt-out exists because an older or freshly-updated graphics driver caused a native boot crash on the owner's machine (dogfeed 23 May 2026), and disabling hardware acceleration lets the app still boot via software rendering.

.. CG-EXPLANATION-END id=function:startDiagnosticsUpload

``let consolePipeBroken``
-------------------------

.. CG-BLOCK id=let:consolePipeBroken lines=1874-1875

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1874-1875
   :lineno-match:

.. CG-EXPLANATION-START id=let:consolePipeBroken

**What this does.** A flag latched true the first time a write to the console fails with a broken pipe (the reader on the other end has gone away).

**Why it is here.** So the main process stops trying to talk to a reader that no longer exists. Declared above its first reader on purpose (temporal-dead-zone discipline).

.. CG-EXPLANATION-END id=let:consolePipeBroken

``function writeMainCrashLine``
-------------------------------

.. CG-BLOCK id=function:writeMainCrashLine lines=1876-1979

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1876-1979
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeMainCrashLine

**What this does.** Writes a crash to both the human-readable log and the redacted, machine-readable diagnostics store, guarding the console write so a dead pipe does not throw a second error from inside the handler. The block also installs the process-wide handlers: ``uncaughtException`` (log, show a dialog, stop the engine and Postgres, then exit — unless it is merely a broken output pipe, which is ignored), ``unhandledRejection`` (log only, keep running), and it starts the local crash reporter with uploads turned off.

**Why it is here.** Without these catch-alls a thrown error in the main process would kill it silently — the window goes blank with nothing in the log to diagnose from afar. A broken pipe is not an application fault (nobody is reading the console any more), so the app survives it. The uncaught-exception path stops the engine and database before exiting so it does not orphan a foreign backend on port 8765 or a locked data directory for the next launch to trip over (H3(c)). Crash collection is local only; upload is a Tier-B debt item (#16).

.. CG-EXPLANATION-END id=function:writeMainCrashLine

``const BETA_RENEW_URL``
------------------------

.. CG-BLOCK id=const:BETA_RENEW_URL lines=1980-1988

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1980-1988
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_RENEW_URL

**What this does.** The web address an expired build sends the user to — the StrixGeo site.

**Why it is here.** The exact checkout path is an owner decision (it lives on the landing page today); the host is what matters for the dialog to be useful.

.. CG-EXPLANATION-END id=const:BETA_RENEW_URL

``const BETA_RECHECK_INTERVAL_MS``
----------------------------------

.. CG-BLOCK id=const:BETA_RECHECK_INTERVAL_MS lines=1989-1996

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1989-1996
   :lineno-match:

.. CG-EXPLANATION-START id=const:BETA_RECHECK_INTERVAL_MS

**What this does.** How often a running app re-checks its own expiry: six hours. The trailing block logs the build's version and stamp at boot.

**Why it is here.** Six hours rather than a flat day so a workstation that is never restarted cannot keep an expired beta open beyond a single working session.

.. CG-EXPLANATION-END id=const:BETA_RECHECK_INTERVAL_MS

``const betaBuildStamp``
------------------------

.. CG-BLOCK id=const:betaBuildStamp lines=1997-2002

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 1997-2002
   :lineno-match:

.. CG-EXPLANATION-START id=const:betaBuildStamp

**What this does.** Reads the build's expiry stamp once, at module load — from the value compiled into a packaged binary, or from the environment in dev.

**Why it is here.** The stamp is baked into the binary and cannot change while the process runs, so reading it once is enough.

.. CG-EXPLANATION-END id=const:betaBuildStamp

``let betaVerdict``
-------------------

.. CG-BLOCK id=let:betaVerdict lines=2003-2005

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2003-2005
   :lineno-match:

.. CG-EXPLANATION-START id=let:betaVerdict

**What this does.** Caches the most recent expiry verdict.

**Why it is here.** So the display-only ``app:beta-status`` call can return the last decision without recomputing it.

.. CG-EXPLANATION-END id=let:betaVerdict

``function currentBetaVerdict``
-------------------------------

.. CG-BLOCK id=function:currentBetaVerdict lines=2006-2015

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2006-2015
   :lineno-match:

.. CG-EXPLANATION-START id=function:currentBetaVerdict

**What this does.** Returns the cached expiry verdict.

**Why it is here.** The read side of the display-only beta status; the actual blocking decision is made elsewhere, before the window exists.

.. CG-EXPLANATION-END id=function:currentBetaVerdict

``function betaCorroboratingTimestamps``
----------------------------------------

.. CG-BLOCK id=function:betaCorroboratingTimestamps lines=2016-2022

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2016-2022
   :lineno-match:

.. CG-EXPLANATION-START id=function:betaCorroboratingTimestamps

**What this does.** Collects the "last opened" timestamps from the recent-projects list as extra evidence of real elapsed time.

**Why it is here.** They feed the same high-water mark as the anchor file, so deleting the anchor is not on its own enough to make a wound-back clock believable.

.. CG-EXPLANATION-END id=function:betaCorroboratingTimestamps

``function refreshBetaVerdict``
-------------------------------

.. CG-BLOCK id=function:refreshBetaVerdict lines=2023-2030

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2023-2030
   :lineno-match:

.. CG-EXPLANATION-START id=function:refreshBetaVerdict

**What this does.** Advances the launch anchor and re-computes the expiry verdict against the current time and the corroborating timestamps, caching the result.

**Why it is here.** The one place the expiry rules (in ``betaExpiry.ts``) are applied, using the anchor file and the extra timestamps together.

.. CG-EXPLANATION-END id=function:refreshBetaVerdict

``function stopForExpiredBeta``
-------------------------------

.. CG-BLOCK id=function:stopForExpiredBeta lines=2031-2067

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2031-2067
   :lineno-match:

.. CG-EXPLANATION-START id=function:stopForExpiredBeta

**What this does.** Tells the user the beta has ended (or that the clock cannot be verified), offers a button to the renewal page, and quits. It reassures the user that their projects are untouched, living in their own database and ``.strix`` files.

**Why it is here.** A blunt, honest end-of-beta screen implementing the owner's ruling that beta builds must expire, worded so a tester is not frightened into thinking their data is lost.

.. CG-EXPLANATION-END id=function:stopForExpiredBeta

``function enforceBetaExpiry``
------------------------------

.. CG-BLOCK id=function:enforceBetaExpiry lines=2068-2092

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2068-2092
   :lineno-match:

.. CG-EXPLANATION-START id=function:enforceBetaExpiry

**What this does.** Decides whether this launch may proceed: it warns loudly if a packaged build carries no stamp, computes the verdict, and either returns "do not stop" or shows the end-of-beta screen and returns "stop".

**Why it is here.** It is called before the window is created, so a blocked build never renders and the renderer cannot be patched around the decision. The no-stamp warning catches the failure mode of cutting a release without the expiry value set (see ``buildStamp.ts``).

.. CG-EXPLANATION-END id=function:enforceBetaExpiry

``function startBetaExpiryWatch``
---------------------------------

.. CG-BLOCK id=function:startBetaExpiryWatch lines=2093-2132

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2093-2132
   :lineno-match:

.. CG-EXPLANATION-START id=function:startBetaExpiryWatch

**What this does.** Starts a six-hourly timer that re-decides expiry and stops the app if it has since expired; the timer is set not to hold the app open on its own. The block also carries the long explanation of the single-instance lock below.

**Why it is here.** So a long-running session that is never restarted cannot outlive the expiry date. The timer is detached from the event loop so quitting never waits for a six-hour timer.

.. CG-EXPLANATION-END id=function:startBetaExpiryWatch

``const singleInstanceLockRequested``
-------------------------------------

.. CG-BLOCK id=const:singleInstanceLockRequested lines=2133-2133

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2133-2133
   :lineno-match:

.. CG-EXPLANATION-START id=const:singleInstanceLockRequested

**What this does.** Decides whether to request the single-instance lock: always in a packaged build, and in dev unless a test environment variable disables it.

**Why it is here.** A packaged build ALWAYS locks; the environment variable is a test seam for the Playwright harness (which launches the binary many times against one shared data folder), not a supported user setting.

.. CG-EXPLANATION-END id=const:singleInstanceLockRequested

``const gotSingleInstanceLock``
-------------------------------

.. CG-BLOCK id=const:gotSingleInstanceLock lines=2134-2288

.. literalinclude:: ../../../desktop/src/main/index.ts
   :language: typescript
   :lines: 2134-2288
   :lineno-match:

.. CG-EXPLANATION-START id=const:gotSingleInstanceLock

**What this does.** Requests the operating-system single-instance lock and branches on the result. If another instance already holds it, this one focuses the existing window and quits. Otherwise this is the primary instance, and the large ``app.whenReady`` block is the app's real startup, in order: pre-authorise recent paths; relocate machine-local stores (packaged); configure the recovery, diagnostics and beta-expiry stores; set up activation (device id, store, service, prototype IPC); enforce beta expiry and start its watch; compute the licence gate; boot the embedded database and — only if the gate allows — spawn the engine concurrently with it (dev starts the engine directly); create the window; refresh activation; start the consented diagnostics upload; and check for updates. It also handles a second launch as a focus request and, at the very end, registers the backend and database teardown on the right lifecycle events.

**Why it is here.** A second instance is never something the user wanted — two would fight over port 8765 and end up silently editing the same project through one engine, which reads as data corruption rather than "I double-clicked the icon"; the lock turns that into a focus of the already-open window. The whenReady order is deliberate: every store is configured before anything can call into it, beta expiry is enforced before a window exists, and the licence gate blocks only the engine spawn (the database still boots) so a deferred build has a database ready when activation later starts the engine. Teardown is registered on the after-all-windows-closed events, never on ``before-quit``, because Electron fires ``before-quit`` ahead of the window-close save prompt, and stopping there would run the user's Save against a dead engine (autosave-recovery design).

.. CG-EXPLANATION-END id=const:gotSingleInstanceLock

