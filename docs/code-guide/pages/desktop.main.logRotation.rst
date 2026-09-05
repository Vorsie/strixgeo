desktop.main.logRotation
========================

.. CG-PAGE source=desktop/src/main/logRotation.ts complete=true

*Source file:* ``desktop/src/main/logRotation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring*). It explains that this helper keeps a log file bounded to a maximum size by *rotating* it — when the file grows past the cap, the current file is renamed to ``.1``, the old ``.1`` to ``.2``, and so on up to a set number of generations, and the oldest is dropped. The note lists the inputs: the log's path, the maximum size in bytes, and how many rotated backups to keep.

**Why it is here.** A log that only ever grows would eventually swallow disk space and become too big to attach to a support request; *log rotation* — capping a growing file by size — prevents that. The note stresses that the helper does purely file operations (no Electron, no streams) and takes its filesystem operations as an argument, so the rotation logic can be tested without ever touching a real disk.

.. CG-EXPLANATION-END id=module-header

``interface FsOps``
-------------------

.. CG-BLOCK id=interface:FsOps lines=26-51

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 26-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FsOps

**What this does.** Describes the small set of four file operations the rotation logic depends on (an *interface* is a written description of the fields, here functions, a value must provide): ``size`` (a file's byte size, or 0 if absent), ``exists`` (does the file exist?), ``rename`` (move one file over another), and ``unlink`` (delete a file, silently). The block also carries the note that leads into the next function.

**Why it is here.** By naming the exact operations it needs rather than reaching for Node's ``fs`` directly, the rotation code can be handed either the real disk operations or a lightweight test stand-in, so its behaviour is checkable without a real filesystem.

.. CG-EXPLANATION-END id=interface:FsOps

``function shouldRotate``
-------------------------

.. CG-BLOCK id=function:shouldRotate lines=52-84

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 52-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldRotate

**What this does.** A one-line yes/no test: is the current file size at or past the maximum allowed? The block also carries the note that leads into the next function.

**Why it is here.** Pulling the single size comparison into its own named function makes the rotation decision a self-documenting, separately testable rule instead of a bare comparison buried inside the file-shuffling code.

.. CG-EXPLANATION-END id=function:shouldRotate

``function rotateIfNeeded``
---------------------------

.. CG-BLOCK id=function:rotateIfNeeded lines=85-125

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 85-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:rotateIfNeeded

**What this does.** Performs the rotation when the primary log has crossed the size cap. It measures the file; if it is not over the cap it returns ``false`` and does nothing. Otherwise it deletes the oldest backup generation, shifts every remaining backup up one place (``.1`` becomes ``.2`` and so on), renames the primary log to ``.1``, and returns ``true``. The block also carries the note that leads into the next value.

**Why it is here.** This is the whole rotation shuffle in one place. It deliberately does only the renames and deletes — it does NOT create the fresh primary log; the caller reopens the log afterwards. Returning ``true`` is how it tells the caller a rotation happened, so the caller knows to reopen its write stream onto a new empty file.

.. CG-EXPLANATION-END id=function:rotateIfNeeded

``const DEFAULT_CHECK_EVERY_BYTES``
-----------------------------------

.. CG-BLOCK id=const:DEFAULT_CHECK_EVERY_BYTES lines=126-128

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 126-128
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_CHECK_EVERY_BYTES

**What this does.** Sets to 64 KiB (64 × 1024 bytes) how many appended bytes must accumulate before the appender re-checks the file's size.

**Why it is here.** Checking the file's size on every single line written would be needless disk work on the interface thread; checking once per 64 KiB is negligible, and the active log then never runs more than about that much (plus one line) past the cap. This closed a bug where a log bounded only at launch grew without limit through a long, chatty session until the next restart.

.. CG-EXPLANATION-END id=const:DEFAULT_CHECK_EVERY_BYTES

``interface AppendFsOps``
-------------------------

.. CG-BLOCK id=interface:AppendFsOps lines=129-165

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 129-165
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AppendFsOps

**What this does.** Describes the filesystem operations a rotating appender needs: the read-side ``FsOps`` from above, plus an ``append`` operation that adds text to a file (creating it if absent). The block also carries the note that leads into the next function.

**Why it is here.** The appender needs one operation more than plain rotation — the ability to add a line — so this bundles the read-side operations together with that one write-side operation, still as an injectable interface so the appender stays testable without a real disk.

.. CG-EXPLANATION-END id=interface:AppendFsOps

``function createRotatingAppender``
-----------------------------------

.. CG-BLOCK id=function:createRotatingAppender lines=166-195

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 166-195
   :lineno-match:

.. CG-EXPLANATION-START id=function:createRotatingAppender

**What this does.** Builds and returns a small function that appends a line (with a trailing newline) to the log and, once enough bytes have accumulated since the last check, re-checks the file size and rotates if it has crossed the cap. The returned function remembers the running byte count between calls. The block also carries the note that leads into the next function.

**Why it is here.** This is what keeps the active log bounded DURING a session, not merely at launch. It returns a *closure* — a function that remembers its own running byte count from one call to the next — so the caller simply calls it once per line and rotation takes care of itself. Built on the injected operations, it too can be exercised without a real disk.

.. CG-EXPLANATION-END id=function:createRotatingAppender

``function realFsOps``
----------------------

.. CG-BLOCK id=function:realFsOps lines=196-217

.. literalinclude:: ../../../desktop/src/main/logRotation.ts
   :language: typescript
   :lines: 196-217
   :lineno-match:

.. CG-EXPLANATION-START id=function:realFsOps

**What this does.** Provides the real, on-disk implementation of the four file operations, backed by Node's ``fs`` module: ``size`` returns the file's byte size or 0 when it cannot be read, ``exists`` checks presence, ``rename`` moves a file, and ``unlink`` deletes it while silently ignoring a missing file.

**Why it is here.** This is the production wiring the main process passes in. Node's ``fs`` is loaded only when this runs (a lazy require) so the surrounding module can still be imported in a test environment that does not bundle Node's built-in modules. Swallowing the missing-file error on delete honours the "delete silently if it exists" contract.

.. CG-EXPLANATION-END id=function:realFsOps

