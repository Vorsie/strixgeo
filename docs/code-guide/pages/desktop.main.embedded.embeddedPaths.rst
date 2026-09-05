desktop.main.embedded.embeddedPaths
===================================

.. CG-PAGE source=desktop/src/main/embedded/embeddedPaths.ts complete=false

*Source file:* ``desktop/src/main/embedded/embeddedPaths.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedPaths.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file whose single job is to work out the absolute location of everything the packaged app ships and everything it writes, and imports ``join`` (Node's helper for gluing folder and file names into one path). The comment beneath sets up the module's core rule and opens the description of the ``configuredPgdataRoot`` setting in the next block.

**Why it is here.** The rule this file enforces, in one line: **everything the installer ships is read-only; everything the app writes goes in a per-user folder.** A standard Windows install lands under ``C:\Program Files\``, which an ordinary account is not allowed to write to. So a data folder worked out relative to the install path happens to work on the developer's machine (where the app runs from a writable build folder) and fails on every real customer's machine — this module is where that mistake is prevented, once, for every path.

.. CG-EXPLANATION-END id=module-header

``let configuredPgdataRoot``
----------------------------

.. CG-BLOCK id=let:configuredPgdataRoot lines=31-38

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedPaths.ts
   :language: typescript
   :lines: 31-38
   :lineno-match:

.. CG-EXPLANATION-START id=let:configuredPgdataRoot

**What this does.** Holds one changeable setting: where the database's data folder should be rooted. ``null`` (the default) means "leave it under the per-user data folder", which is what development, automated tests and isolated runs want. The comment that follows opens the description of the ``configurePgdataRoot`` function below.

**Why it is here.** On a real packaged launch the startup code sets this to ``%LOCALAPPDATA%\StrixGeo`` — a machine-local folder — so the live database does not sit on a Windows "Roaming" profile (a folder that some setups sync between machines, which is wrong for a live database). It is a module-level setting rather than a new argument threaded through every path call because a neighbouring change owned that call at the time; flipping one setting moved the cluster without disturbing it. It is set once at startup, before anything asks for a layout.

.. CG-EXPLANATION-END id=let:configuredPgdataRoot

``function configurePgdataRoot``
--------------------------------

.. CG-BLOCK id=function:configurePgdataRoot lines=39-43

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedPaths.ts
   :language: typescript
   :lines: 39-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:configurePgdataRoot

**What this does.** The setter for the value above: hand it a folder to root the database data directory under, or ``null`` to keep the default per-user location.

**Why it is here.** It gives the startup code one clear place to point the database's storage at a machine-local folder on a packaged launch, while leaving development and tests on the default. Splitting the setter from the stored value keeps the "who is allowed to change this" boundary obvious.

.. CG-EXPLANATION-END id=function:configurePgdataRoot

``interface EmbeddedLayout``
----------------------------

.. CG-BLOCK id=interface:EmbeddedLayout lines=44-80

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedPaths.ts
   :language: typescript
   :lines: 44-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EmbeddedLayout

**What this does.** Describes the shape of a fully worked-out set of paths for one install — an *interface* is just a named checklist of the fields a value must carry. It lists where the bundled PostgreSQL tree lives, the two database programs (``initdb.exe`` to create the storage on first launch, ``postgres.exe`` the server itself), the bundled Python runtime and the folder the backend source is imported from (all read-only), and the three things the app writes: the database data directory, the file holding this install's generated password, and a short-lived file used to hand the initial password to ``initdb``.

**Why it is here.** Gathering every path into one typed object means the rest of the code asks for ``layout.postgresExe`` instead of re-gluing the path together each time — and the read-only-versus-writable split is visible in one place. The long comment on ``initPasswordFile`` records two hard-won reasons: the password file must be a SIBLING of the data directory, never inside it, because ``initdb`` refuses to run against a folder that already contains anything; and the password is passed through a file rather than a command-line argument because any other program on the machine can read another program's command line.

.. CG-EXPLANATION-END id=interface:EmbeddedLayout

``function resolveEmbeddedLayout``
----------------------------------

.. CG-BLOCK id=function:resolveEmbeddedLayout lines=81-111

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedPaths.ts
   :language: typescript
   :lines: 81-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveEmbeddedLayout

**What this does.** Takes the two folders Electron provides — ``resourcesPath`` (where the installer unpacked the bundled programs) and ``userDataPath`` (the per-user, writable folder that survives app updates) — and returns the fully filled-in set of paths described above. The database data directory is rooted under the machine-local folder when one has been configured, and everything else stays under the per-user profile so it follows the user.

**Why it is here.** This is the single function that turns "where Electron says things are" into "where each specific file is", so the naming convention lives in one spot instead of being re-derived, slightly differently, by every caller.

.. CG-EXPLANATION-END id=function:resolveEmbeddedLayout

``function writablePaths``
--------------------------

.. CG-BLOCK id=function:writablePaths lines=112-114

.. literalinclude:: ../../../desktop/src/main/embedded/embeddedPaths.ts
   :language: typescript
   :lines: 112-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:writablePaths

**What this does.** Returns the three paths in a layout that the app actually writes to: the data directory, the credentials file, and the transient init-password file.

**Why it is here.** It makes the rule "nothing under the install directory is writable" checkable in one place instead of trusting every reader to remember it — and a test asserts these are the only writable members, so adding a new writable path without listing it here fails that test.

.. CG-EXPLANATION-END id=function:writablePaths

