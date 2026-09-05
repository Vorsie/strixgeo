desktop.main.crashBundle
========================

.. CG-PAGE source=desktop/src/main/crashBundle.ts complete=true

*Source file:* ``desktop/src/main/crashBundle.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring* — a comment written for whoever reads the code) followed by its ``import`` lines, the tools this file borrows. The note explains the file's one job: assemble, on demand, a single ``.zip`` archive (a compressed folder packed into one file) that a tester can be asked to save and hand over. It spells out what goes inside and, crucially, that ``diagnostics.log`` is already safe because every line was cleaned before it was ever written, whereas ``backend.log`` is the Python engine's own raw output and must be cleaned here on the way in. The imports pull in file-reading helpers, the redaction cleaner from ``diagnosticsRedaction``, the diagnostics store's build facts and event reader, and the zip builder from ``zipArchive``.

**Why it is here.** This file lives in Electron's *main process* — the part of the desktop app with full computer access (files, windows, launching other programs), as opposed to the *renderer*, the sandboxed web page the user sees. It is the USER-DRIVEN half of crash reporting: the automatic, consent-gated upload lives elsewhere, but a "Help, Save diagnostics bundle" action must stay available for a tester who has not opted in to any sending, or who wants to open and inspect the file first. The promise the whole file keeps, stated in the note, is that everything inside the zip is safe to send — *redaction* meaning the stripping-out of identifying or sensitive text before anything leaves the machine.

.. CG-EXPLANATION-END id=module-header

``const CRASH_BUNDLE_KIND``
---------------------------

.. CG-BLOCK id=const:CRASH_BUNDLE_KIND lines=45-47

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:CRASH_BUNDLE_KIND

**What this does.** Defines one fixed label, ``CRASH_BUNDLE_KIND``, the text ``'strixgeo.crash-bundle'`` that is stamped into the bundle's manifest so a reader can tell at a glance what kind of file this is.

**Why it is here.** A short, unmistakable name in the manifest lets any tool — or a future StrixGeo version — recognise the artefact as our crash bundle rather than have to guess from its contents.

.. CG-EXPLANATION-END id=const:CRASH_BUNDLE_KIND

``const CRASH_BUNDLE_FORMAT_VERSION``
-------------------------------------

.. CG-BLOCK id=const:CRASH_BUNDLE_FORMAT_VERSION lines=48-50

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 48-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:CRASH_BUNDLE_FORMAT_VERSION

**What this does.** Sets ``CRASH_BUNDLE_FORMAT_VERSION`` to the number ``1`` — the version of the bundle's layout.

**Why it is here.** Recording a version number now means that if the bundle's shape ever changes, an old bundle and a new bundle can still be told apart, so a reader never misreads one as the other.

.. CG-EXPLANATION-END id=const:CRASH_BUNDLE_FORMAT_VERSION

``const BACKEND_LOG_FILENAME``
------------------------------

.. CG-BLOCK id=const:BACKEND_LOG_FILENAME lines=51-58

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 51-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:BACKEND_LOG_FILENAME

**What this does.** Names the backend's log file, ``'backend.log'`` — the file inside Electron's logs folder that holds the Python engine's own printed output (its *stdout*, the ordinary channel a program prints to). The comment at the end of the block leads into the next value and is explained there.

**Why it is here.** Writing the name once in a single named place means both the code that reads the file and the code that names it inside the archive use exactly the same spelling, never a separately retyped literal.

.. CG-EXPLANATION-END id=const:BACKEND_LOG_FILENAME

``const BACKEND_LOG_TAIL_BYTES``
--------------------------------

.. CG-BLOCK id=const:BACKEND_LOG_TAIL_BYTES lines=59-61

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 59-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:BACKEND_LOG_TAIL_BYTES

**What this does.** Sets ``BACKEND_LOG_TAIL_BYTES`` to 256 KiB (256 × 1024 bytes) — how much of the backend log travels in the bundle.

**Why it is here.** Only the *tail* (the end) of the log is included, because that is where a crash lands; 256 KiB is roughly 2,500 lines, comfortably past the start of any crash, and compresses to well under a megabyte. A 5 MiB attachment is not a support flow, so the cap keeps the bundle small enough to send.

.. CG-EXPLANATION-END id=const:BACKEND_LOG_TAIL_BYTES

``const TRIM_MARKER``
---------------------

.. CG-BLOCK id=const:TRIM_MARKER lines=62-64

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 62-64
   :lineno-match:

.. CG-EXPLANATION-START id=const:TRIM_MARKER

**What this does.** Defines ``TRIM_MARKER``, the text ``'[earlier lines trimmed]'`` written at the very top of a log that had to be cut down to its tail.

**Why it is here.** When only the end of the log is kept, this marker makes the cut visible so nobody mistakes the first surviving line for the true start of the session.

.. CG-EXPLANATION-END id=const:TRIM_MARKER

``interface CrashBundleOptions``
--------------------------------

.. CG-BLOCK id=interface:CrashBundleOptions lines=65-74

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 65-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrashBundleOptions

**What this does.** Describes the inputs the bundle builder needs (an *interface* is simply a written description of the fields a value must carry): ``logsDir`` (Electron's logs folder, where ``backend.log`` lives), ``consent`` (the recorded yes/no answer to "may diagnostics be sent?", copied into the manifest), and an optional ``nowIso`` timestamp that tests pin and production leaves unset.

**Why it is here.** Gathering the builder's inputs into one named shape keeps the call site tidy and lets the test suite drive the builder with a fixed clock, so its output is repeatable rather than depending on the real time of day.

.. CG-EXPLANATION-END id=interface:CrashBundleOptions

``interface CrashBundleManifest``
---------------------------------

.. CG-BLOCK id=interface:CrashBundleManifest lines=75-93

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 75-93
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrashBundleManifest

**What this does.** Describes the ``manifest.json`` that sits inside every bundle and says what the bundle is: its ``kind`` and ``format_version`` labels, a ``bundleId``, its creation time, the app version, platform and optional build id, ``transmissionOptIn`` (whether the user had opted in to sending at bundle time), ``eventCount`` (how many diagnostic events it carries), ``contents`` (every other file in the archive), and ``redaction`` — a plain-language sentence of what was removed.

**Why it is here.** A manifest lets whoever receives the bundle understand it without unzipping and reading every file, and the plain-language ``redaction`` line tells the person sending it, in words they can read, exactly what was stripped before they hand it over.

.. CG-EXPLANATION-END id=interface:CrashBundleManifest

``interface CrashBundle``
-------------------------

.. CG-BLOCK id=interface:CrashBundle lines=94-118

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 94-118
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrashBundle

**What this does.** Describes the finished result the builder returns: ``fileName`` (a suggested name for the Save dialog), ``bytes`` (the actual archive as raw binary data — a *Buffer* is Node's container for a block of bytes), and ``manifest`` (the same manifest that is also embedded inside the archive). The comment at the end of the block leads into the next function.

**Why it is here.** Returning the file name, the bytes and the manifest together hands the calling code everything it needs in one object — to offer a Save dialog and to log what was produced.

.. CG-EXPLANATION-END id=interface:CrashBundle

``function crashBundleFileName``
--------------------------------

.. CG-BLOCK id=function:crashBundleFileName lines=119-124

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 119-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:crashBundleFileName

**What this does.** Builds the suggested file name from the creation timestamp, for example ``strixgeo-diagnostics-2026-08-26T12-34-56.zip``. It drops the sub-second fraction and replaces every colon with a dash.

**Why it is here.** Colons are illegal in Windows file names, so a raw ISO-8601 timestamp cannot be used as-is; rewriting the colons as dashes produces a name Windows will accept while still keeping the moment readable.

.. CG-EXPLANATION-END id=function:crashBundleFileName

``function readRedactedLogTail``
--------------------------------

.. CG-BLOCK id=function:readRedactedLogTail lines=125-152

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 125-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:readRedactedLogTail

**What this does.** Reads a log file and returns its tail, cleaned line by line. If the file is missing or unreadable it returns nothing (``null``). If the file is larger than the 256 KiB cap it keeps only the last 256 KiB, throws away the partial first line so the tail begins on a whole record, and remembers that it trimmed. It then runs every line through the redaction cleaner and, when it trimmed, prepends the ``[earlier lines trimmed]`` marker.

**Why it is here.** This is where ``backend.log`` is made safe to send. Because the engine's raw output carries the database password (inside its connection string) and real file paths, it must be redacted *here*, on the way into the archive — it was never cleaned when written, unlike ``diagnostics.log``. Dropping the partial first line and marking the cut keep the trimmed log honest about where it starts.

.. CG-EXPLANATION-END id=function:readRedactedLogTail

``function readIfPresent``
--------------------------

.. CG-BLOCK id=function:readIfPresent lines=153-181

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 153-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:readIfPresent

**What this does.** Reads a file and returns its raw text, or nothing (``null``) when the file is absent or cannot be read. The comment at the end of the block leads into the next function.

**Why it is here.** Several files that may go into the bundle are optional — a rotated log generation may not exist, a file may be momentarily locked — so this helper lets the builder simply skip whatever is not there instead of failing the whole bundle over one missing file.

.. CG-EXPLANATION-END id=function:readIfPresent

``function buildCrashBundle``
-----------------------------

.. CG-BLOCK id=function:buildCrashBundle lines=182-225

.. literalinclude:: ../../../desktop/src/main/crashBundle.ts
   :language: typescript
   :lines: 182-225
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildCrashBundle

**What this does.** Assembles the whole bundle. It reads the build facts from the diagnostics store, picks a creation time, then collects the archive entries in order: the current ``diagnostics.log`` if present, any rotated generations of it, and the redacted tail of ``backend.log``. It fills in the manifest (kind, version, id, build facts, the consent answer, the event count, the list of contents and the plain-language redaction statement), places the manifest first in the archive, and returns the file name, the zipped bytes and the manifest. If the diagnostics store was never configured it raises an error rather than producing a bundle.

**Why it is here.** This is the single entry point the "Save diagnostics bundle" menu calls. The order — collect only whitelisted files, redact the one raw log, describe everything in a manifest — is the design: a *whitelist, not a sweep*, so nothing new that later lands in the logs folder starts travelling with support bundles by accident. It refuses rather than degrades when the store is unconfigured, because a bundle that cannot say which build it describes is a useless artefact.

.. CG-EXPLANATION-END id=function:buildCrashBundle

