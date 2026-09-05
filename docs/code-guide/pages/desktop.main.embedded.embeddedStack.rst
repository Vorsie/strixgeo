desktop.main.embedded.embeddedStack
===================================

.. CG-PAGE source=desktop/src/main/embedded/embeddedStack.ts complete=true

*Source file:* ``desktop/src/main/embedded/embeddedStack.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This block is the file's *docstring* (a long explanatory comment for the reader) followed by its ``import`` lines, which pull in the ready-made tools the rest of the file uses — Node's random-byte generator, file-system helpers, and the sibling modules that resolve install paths, pick a port, load the secrets, build the connection string, and drive PostgreSQL. The docstring explains that this file boots the packaged app's own database. Electron runs two programs: the *main process* (full computer access — files, launching other programs, windows; this file is part of it) and the *renderer* (the sandboxed web page the user sees). In development the database already runs in Docker; a packaged build finds nothing, so it must pick a free port (a numbered network channel), create the database's storage on first launch, start the server, and wait for it. Crucially the work is split into two phases: ``prepareEmbeddedStack`` does the fast part and returns the moment the port is known, and ``startEmbeddedCluster`` brings PostgreSQL up afterwards.

**Why it is here.** The two-phase split exists to save the user real time on a cold first launch. The owner's installer #13 report showed three slow things happening one after another — roughly a minute of database startup, then a whole extra Python process just to answer whether the schema was already up to date, then the engine's own long first-time load. By returning as soon as the port is known, the launcher can start the Python engine (whose slow first-time load can then run at the same time as the database is coming up) instead of waiting for the database first. The note also records that this file runs in the packaged app only — the calling code guards it behind ``app.isPackaged``, so a development session never reaches it and keeps talking to Docker — and that the schema update is no longer done here: the engine brings the database up to date inside its own process, switched on by an environment variable this file sets.

.. CG-EXPLANATION-END id=module-header

``interface EmbeddedStack``
---------------------------

.. CG-BLOCK id=interface:EmbeddedStack lines=49-63

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 49-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EmbeddedStack

**What this does.** Describes the shape of a fully booted stack, ready for the backend to run against it. An *interface* is a written description of the fields a value must carry. It holds the ``port`` PostgreSQL ended up on, the ``pythonExe`` (the bundled Python interpreter to run the backend with), a ``backendEnv`` (the set of environment variables the backend child process must inherit — an *environment variable* is a named setting passed to a program when it starts), and a ``stop`` function that shuts the database down cleanly and is safe to call more than once.

**Why it is here.** Gathering everything the caller needs to launch and later shut down the backend into one record means the startup code has a single object to hold on to for the life of the session, rather than juggling separate loose values.

.. CG-EXPLANATION-END id=interface:EmbeddedStack

``interface EmbeddedStackPrep``
-------------------------------

.. CG-BLOCK id=interface:EmbeddedStackPrep lines=64-79

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 64-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EmbeddedStackPrep

**What this does.** Describes the result of the fast first phase — everything needed to spawn the engine, plus the in-progress boot log so the second phase can continue writing it. It carries the resolved ``layout`` (paths to the bundled trees and the data directory), this install's ``secrets``, the chosen ``port``, the ``databaseUrl`` (a *DSN*, or database connection string — the single line of text, including host, port, user, password and database name, that tells a program how to reach the database), the ``backendEnv`` both Python children inherit, and the ``boot`` recorder carried through from the first phase into the second.

**Why it is here.** This is the hand-off between the two phases. It bundles exactly what the launcher needs to spawn the engine early (chiefly the connection string), while also carrying the running boot log forward so the whole launch still reads as one continuous, timed sequence even though it was produced in two parts.

.. CG-EXPLANATION-END id=interface:EmbeddedStackPrep

``type PrepareEmbeddedResult``
------------------------------

.. CG-BLOCK id=type:PrepareEmbeddedResult lines=80-84

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 80-84
   :lineno-match:

.. CG-EXPLANATION-START id=type:PrepareEmbeddedResult

**What this does.** A *type* saying the fast phase returns one of exactly two shapes: either a success carrying the prepared stack, or a failure carrying the step that stopped it.

**Why it is here.** Making success and failure two distinct, clearly-labelled shapes forces the calling code to check which one it got before using it, so a failed preparation can never be mistaken for a good one.

.. CG-EXPLANATION-END id=type:PrepareEmbeddedResult

``type EmbeddedClusterResult``
------------------------------

.. CG-BLOCK id=type:EmbeddedClusterResult lines=85-101

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 85-101
   :lineno-match:

.. CG-EXPLANATION-START id=type:EmbeddedClusterResult

**What this does.** A *type* saying the cluster phase likewise returns one of two shapes: either a success carrying the running database plus the full boot log, or a failure carrying the step that stopped it.

**Why it is here.** The same two-shape pattern as the fast phase, for the same reason — the caller must decide whether the database actually came up before it treats the app as ready, and a labelled failure cannot slip through unchecked.

.. CG-EXPLANATION-END id=type:EmbeddedClusterResult

``function prepareEmbeddedStack``
---------------------------------

.. CG-BLOCK id=function:prepareEmbeddedStack lines=102-161

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 102-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:prepareEmbeddedStack

**What this does.** The fast first phase. In order it opens and records four steps: locate the bundled files (and fail by name if one is missing), read or create this install's secrets, pick a free port, and then build the connection string and the child-process environment from those. It returns the prepared stack the instant the environment is built — it does NOT wait for PostgreSQL. It is an *async* function (one that is allowed to pause and resume) because picking a free port involves a short wait; ``await`` pauses for that without freezing the rest of the app.

**Why it is here.** This is the half of the boot that must finish before the engine can be started, so it is deliberately kept to only the quick, decidable work and returns the moment the port is known — leaving the slow database startup to run at the same time as the engine's slow first-time load. Note that a failure here is *returned* rather than thrown: that guarantees the caller always receives the step that stopped the launch, so the error dialog can name what the app was doing.

.. CG-EXPLANATION-END id=function:prepareEmbeddedStack

``function startEmbeddedCluster``
---------------------------------

.. CG-BLOCK id=function:startEmbeddedCluster lines=162-203

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 162-203
   :lineno-match:

.. CG-EXPLANATION-START id=function:startEmbeddedCluster

**What this does.** The second phase. Using the prepared stack, it opens and records three steps: create the database storage (recording whether it was newly created, re-created after an unfinished first launch, or simply reused), stop any leftover server still holding the storage and then start PostgreSQL, and finally wait until the server accepts connections. On success it writes the completed boot log and returns the running database; on failure it records the failed step and, importantly, stops any server it had already started.

**Why it is here.** This half runs at the same time as the engine's slow first-time load — the engine has already been pointed at the connection string and is loading while this brings the server up. Stopping a half-started server on failure is the key safety step: a server left running would keep the data directory locked and block the very next launch too, turning a one-off failure into a permanent one. No schema update runs here — the engine brings the database up to date in its own process.

.. CG-EXPLANATION-END id=function:startEmbeddedCluster

``function assertBundledFilesPresent``
--------------------------------------

.. CG-BLOCK id=function:assertBundledFilesPresent lines=204-233

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 204-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:assertBundledFilesPresent

**What this does.** Checks that every file a boot depends on is actually present in the installation — the database server and initialiser, the Python runtime, the backend source, and one specific compiled engine file — and throws an error naming the missing piece in plain words if any is absent.

**Why it is here.** Without this check a packaging mistake would surface much later as a raw ``spawn ENOENT`` (Node's error for a program it cannot find) from whichever step happened to run first, naming nothing a person could use. Checking the compiled engine file specifically doubles as a guard on the source-protection build step: the engine and parsers are meant to ship as compiled ``.pyd`` files, never as readable source, so if that step was skipped this sentinel file is absent and the app fails by name at boot rather than quietly shipping the source it was supposed to hide.

.. CG-EXPLANATION-END id=function:assertBundledFilesPresent

``function secretsFileIo``
--------------------------

.. CG-BLOCK id=function:secretsFileIo lines=234-254

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 234-254
   :lineno-match:

.. CG-EXPLANATION-START id=function:secretsFileIo

**What this does.** Builds a tiny read/write helper for the secrets file: reading returns the file's text or nothing when it does not exist, and writing first creates the containing folder (on first launch it may not exist yet) and then saves the text.

**Why it is here.** The code that decides *what* the secrets are is kept separate and pure, so it can be tested without a real disk. This helper is the thin layer that connects that pure logic to the actual file, and it is passed in rather than reached for directly — which is what makes the decision testable in isolation.

.. CG-EXPLANATION-END id=function:secretsFileIo

``let configuredNumbaCacheRoot``
--------------------------------

.. CG-BLOCK id=let:configuredNumbaCacheRoot lines=255-262

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 255-262
   :lineno-match:

.. CG-EXPLANATION-START id=let:configuredNumbaCacheRoot

**What this does.** A single changeable module-level value remembering where the numba compile cache should live. ``null`` (the default) keeps it under the per-user data folder — the behaviour development, the end-to-end tests, and isolated runs all want; the packaged launcher sets it to a machine-local folder instead.

**Why it is here.** numba is the tool that compiles the 3D voxel builder's hot loop the first time it runs and caches the result; that cache is large and rebuildable. On an office machine whose Roaming profile is synced to a network share, letting a rebuildable cache live there would be pure wasted network churn, so the packaged app moves it to a machine-local folder — while dev and tests keep the simple default.

.. CG-EXPLANATION-END id=let:configuredNumbaCacheRoot

``function configureNumbaCacheRoot``
------------------------------------

.. CG-BLOCK id=function:configureNumbaCacheRoot lines=263-278

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 263-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureNumbaCacheRoot

**What this does.** The setter for the value above — the packaged launcher calls it once at startup to point the numba cache at a machine-local folder, or passes nothing to keep the default per-user location.

**Why it is here.** Exposing this as a single explicit call, made once before the backend environment is built, keeps the cache-location choice in the launcher's hands and out of this file's logic — the same pattern used for choosing where the database storage lives.

.. CG-EXPLANATION-END id=function:configureNumbaCacheRoot

``function buildBackendEnv``
----------------------------

.. CG-BLOCK id=function:buildBackendEnv lines=279-323

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedStack.ts
   :language: typescript
   :lines: 279-323
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildBackendEnv

**What this does.** Assembles the set of environment variables both Python child processes inherit. It first ensures the numba cache folder exists, then returns the current environment plus a handful of overrides: ``PYTHONPATH`` pointed at the shipped backend source, the ``DATABASE_URL`` connection string, a per-install ``SECRET_KEY``, ``ENVIRONMENT=production``, ``PYTHONUTF8`` so Dutch text logs correctly, the numba cache folder, ``STRIX_ENGINE_MIGRATE`` to switch on the engine's own schema update, the bundled backup tool path and folder for the pre-update database snapshot, and a head-less plotting backend for report figures.

**Why it is here.** Each override fixes a concrete failure that only appears in a shipped build. The backend ships as plain source files (not an installed package), so Python must be told where to find them. ``SECRET_KEY`` is per-install because a production build refuses to start on the shipped placeholder key — a constant baked into every copy of a distributed program is not a secret. ``PYTHONUTF8`` is set because Windows still defaults program output to a codepage that cannot represent the Dutch soil tokens and project names the backend logs. ``STRIX_ENGINE_MIGRATE`` is set only here, on the packaged path, so development, CI and the end-to-end tests keep updating the schema the external way. And the plotting override stops the report code from probing for an on-screen backend that needs a display the shipped app does not have.

.. CG-EXPLANATION-END id=function:buildBackendEnv

