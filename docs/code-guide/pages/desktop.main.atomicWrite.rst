desktop.main.atomicWrite
========================

.. CG-PAGE source=desktop/src/main/atomicWrite.ts complete=true

*Source file:* ``desktop/src/main/atomicWrite.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring introduces this file as a shared helper for the Electron main process — the part of the desktop app with full computer access (files, windows, launching other programs), as opposed to the renderer, the sandboxed web page the user sees. Its job is safe file writing. The imports pull low-level file tools from Node's built-in ``fs`` (file-system) toolbox: open, close, write, rename and delete a file, plus ``fsyncSync`` (force written bytes all the way onto the physical disk).

**Why it is here.** The helper was pulled out of the big ``index.ts`` startup file once a second caller (the crash-recovery store) needed the same safe write — one copy, one set of tests, no drift. It sticks to Node's own tools and imports nothing from Electron on purpose, so the test runner can exercise it as plain code without launching the whole app.

.. CG-EXPLANATION-END id=module-header

``function tmpPathFor``
-----------------------

.. CG-BLOCK id=function:tmpPathFor lines=21-36

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 21-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:tmpPathFor

**What this does.** A one-line helper that builds the name of the temporary file to write to — the target's own path with ``.tmp.`` and the process id tacked on. (The process id is the number the operating system gives each running program.)

**Why it is here.** Every safe write here first writes to a sibling temp file and then renames it into place; putting the process id in the temp name means two programs, or two runs, writing near the same file cannot collide on the same temp.

.. CG-EXPLANATION-END id=function:tmpPathFor

``function writeTempFileSync``
------------------------------

.. CG-BLOCK id=function:writeTempFileSync lines=37-87

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 37-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeTempFileSync

**What this does.** The shared 'durable write' step: it opens the temp file, writes the contents (as UTF-8 text if given text, otherwise as raw bytes), forces those bytes onto the physical disk with ``fsync``, then closes the file. If closing fails it deliberately ignores that one error.

**Why it is here.** Both public writers below reuse this exact step, so the careful open-write-flush-close is written once, not copied where the copies could drift. It passes a text encoding only for text — never for raw bytes — because a binary ``.strix`` project must not be quietly treated as text. And it swallows a close error because, if the write or flush already failed, letting a failing close throw would hide the real, earlier error.

.. CG-EXPLANATION-END id=function:writeTempFileSync

``function writeFileAtomic``
----------------------------

.. CG-BLOCK id=function:writeFileAtomic lines=88-128

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 88-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeFileAtomic

**What this does.** Writes contents to a file 'atomically': it writes to the sibling temp file (flushed to disk), then renames the temp onto the real name in one step. If anything fails it deletes the leftover temp and re-throws the original error.

**Why it is here.** An atomic write means a reader never sees a half-written file — an interrupted save (the app killed, power lost, or a second save racing the first) must never leave the target half-overwritten. A real dogfeed bug on 20 May 2026 was exactly that: a stray backspace byte and a duplicated value from two writes overlapping. Renaming on the same disk is atomic on Windows and Linux/Mac alike, so a reader sees either the whole old file or the whole new one, never a blend. Flushing before the rename matters because the rename survives the program dying but the bytes could still sit in memory; a power loss right after the rename could otherwise leave the file empty — fatal for the crash-recovery snapshot, whose entire job is to be readable after an abrupt death.

.. CG-EXPLANATION-END id=function:writeFileAtomic

``function defaultRotationLog``
-------------------------------

.. CG-BLOCK id=function:defaultRotationLog lines=129-152

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 129-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:defaultRotationLog

**What this does.** The fallback place to send a single 'could not rotate a backup' warning line when a caller supplies no logger of its own — it simply calls ``console.warn``.

**Why it is here.** The main process funnels ``console.warn`` into ``backend.log``, so the line is captured there. A failed rotation is only a lost recovery convenience, never a failed save, so it is a warning rather than an error that stops anything.

.. CG-EXPLANATION-END id=function:defaultRotationLog

``function rotateGenerations``
------------------------------

.. CG-BLOCK id=function:rotateGenerations lines=153-196

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 153-196
   :lineno-match:

.. CG-EXPLANATION-START id=function:rotateGenerations

**What this does.** Shuffles the previous saved copies of a file up by one before it is overwritten: the current file becomes ``.1``, the old ``.1`` becomes ``.2``, and so on up to a limit, with the oldest kept copy falling off the end and being deleted. Any failure along the way is logged and swallowed, not thrown.

**Why it is here.** This keeps a few 'generations' of a saved file beside it so a mistaken save can be undone by hand. It is best-effort by contract: a save must never fail just because an old backup could not be moved (a read-only leftover, an antivirus lock), so a rotation problem at worst loses one backup copy, never the save itself.

.. CG-EXPLANATION-END id=function:rotateGenerations

``function writeFileAtomicKeepingGenerations``
----------------------------------------------

.. CG-BLOCK id=function:writeFileAtomicKeepingGenerations lines=197-217

.. literalinclude:: ../../../desktop/src/main/atomicWrite.ts
   :language: typescript
   :lines: 197-217
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeFileAtomicKeepingGenerations

**What this does.** The second public writer: it writes the new contents to a durable temp file first, then rotates the previous copies aside (keeping three by default), then renames the temp into place. On a write or rename failure it cleans up the temp and re-throws; a rotation failure alone never throws.

**Why it is here.** This is the 'File → Save' path for a ``.strix`` project, which keeps the previous few saves as recovery points. Doing the durable temp write before the rotation is deliberate: if the program dies mid-rotation, the previous save is still recoverable and the new content is safely on its temp, and the rename is the single near-instant step that flips which file is the live one.

.. CG-EXPLANATION-END id=function:writeFileAtomicKeepingGenerations

