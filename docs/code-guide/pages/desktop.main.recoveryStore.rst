desktop.main.recoveryStore
==========================

.. CG-PAGE source=desktop/src/main/recoveryStore.ts complete=true

*Source file:* ``desktop/src/main/recoveryStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-83

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 1-83
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This opening block is the file's introduction (a *docstring* — a note written for whoever reads the code) followed by the tools it borrows. It explains that this file runs in Electron's *main process* — the part of the desktop app with full computer access (files, folders, launching other programs) — as opposed to the *renderer*, the sandboxed web page the user actually sees. Its job is to be the storage drawer for crash-recovery files: small copies of a session's unsaved work, kept so that after a crash the app can offer to put that work back. The ``import`` lines pull in Node's file-system helpers (read, write, rename, delete, list a folder, check a file's size) plus one in-house helper, ``writeFileAtomic`` — which writes safely by writing to a temporary file and then renaming it into place, so a reader never sees a half-written file (an *atomic write*). The note then lays out the folder layout — two files per project, a *primary* slot and a *declined* slot (a slot being a fixed, named location for one copy) — and the module's security stance.

**Why it is here.** The long note records the whole reason the feature exists and the shape it took. A crash loses **no** interpretation, because every geological edit is already saved into the PostgreSQL database the instant it is made, and the ``.strix`` project file is a re-export of that database. What a crash actually loses is a small bundle of renderer-only session state (the stratigraphy lumping map, the litho ghost workspace, an unsaved metadata draft, import lists, the unsaved-changes flag). This file is where an *autosave scheduler* — a background timer that periodically saves the at-risk work, wired up in a later phase — writes that bundle. Two design rules are stated here and honoured everywhere below: the app never lets the web page hand in a file path — it hands in only a project id (a *UUID*, the database's unique 8-4-4-4-12 identifier for the project) and this file builds the path itself, under the app's private per-user folder (the *userData directory*); and a copy the user chose to keep-but-not-restore lives in a separate *declined slot* the autosave never touches, so a later restart can offer the same work again (owner decision, 3 August 2026).

.. CG-EXPLANATION-END id=module-header

``const RECOVERY_DIR_NAME``
---------------------------

.. CG-BLOCK id=const:RECOVERY_DIR_NAME lines=84-86

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 84-86
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_DIR_NAME

**What this does.** Names the sub-folder — ``recovery`` — inside the app's private per-user folder (the userData directory) where every recovery file is kept.

**Why it is here.** The folder name is written once, as a named value, so every function that builds a path spells it the same way; giving recovery files their own sub-folder keeps them apart from everything else the app stores.

.. CG-EXPLANATION-END id=const:RECOVERY_DIR_NAME

``const RECOVERY_FILE_SUFFIX``
------------------------------

.. CG-BLOCK id=const:RECOVERY_FILE_SUFFIX lines=87-104

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 87-104
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_FILE_SUFFIX

**What this does.** Sets the ending every ordinary (*primary*) recovery file carries — ``.recovery.json`` (the ``.json`` marking a plain-text data file) — with the project's UUID as the part before it, so a file is named like ``<projectId>.recovery.json``.

**Why it is here.** A fixed, recognisable ending lets the app pick its own recovery files out of the folder and ignore anything foreign, and using the project id as the stem means a file always answers the question "which project is this?" by its name alone.

.. CG-EXPLANATION-END id=const:RECOVERY_FILE_SUFFIX

``const RECOVERY_DECLINED_FILE_SUFFIX``
---------------------------------------

.. CG-BLOCK id=const:RECOVERY_DECLINED_FILE_SUFFIX lines=105-122

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 105-122
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_DECLINED_FILE_SUFFIX

**What this does.** Sets the ending for the **declined** slot — ``.recovery.declined.json`` — the file a recovery copy is moved to when the user picks "Open without restoring".

**Why it is here.** By owner decision (3 August 2026) declining preserves the copy Word-style, so a later restart offers the same unsaved work again, and only the prompt's explicit **Discard** destroys it. A second, separate file is what makes that possible: the autosave scheduler owns the primary slot and overwrites it within seconds of the new session having anything at risk, so a declined copy left in the primary slot would be gone almost immediately. The two endings are deliberately **disjoint** — ``.recovery.declined.json`` does not itself end in ``.recovery.json`` — so any filename matches at most one slot and the folder scan needs no tie-breaking rule between them.

.. CG-EXPLANATION-END id=const:RECOVERY_DECLINED_FILE_SUFFIX

``const RECOVERY_CORRUPT_FILE_SUFFIX``
--------------------------------------

.. CG-BLOCK id=const:RECOVERY_CORRUPT_FILE_SUFFIX lines=123-128

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 123-128
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_CORRUPT_FILE_SUFFIX

**What this does.** Sets the ending for the **quarantine** slot — ``.recovery.corrupt.json`` — where a primary file is moved aside when it turns out to be unreadable (garbled, foreign, a version this build does not understand, or above the size limit).

**Why it is here.** This is **not** a third recovery slot; nothing ever reads it. It exists because "a file being present means there is work to recover" is the right rule for a readable primary but the wrong rule for garbage: an unreadable primary left in place would hide a perfectly good declined copy behind it at every launch, forever, since no other path in the app ever cleaned it up. Moving it aside restores the fallback and keeps the bytes for a support question ("what was actually in that file?" is unanswerable once the file is deleted). It is disjoint from both other endings, so the folder scan skips it with no extra rule.

.. CG-EXPLANATION-END id=const:RECOVERY_CORRUPT_FILE_SUFFIX

``const RECOVERY_KIND``
-----------------------

.. CG-BLOCK id=const:RECOVERY_KIND lines=129-135

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 129-135
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_KIND

**What this does.** Sets the marker string — ``strixgeo.recovery`` — that every genuine recovery file carries inside it. A file whose marker is anything else is treated as foreign and skipped.

**Why it is here.** The recovery folder could contain a stray or hand-copied file (for instance a ``.strix`` project someone dropped in). Stamping a known marker inside each file, and checking it on read, is how the app tells its own recovery files apart from anything that merely happens to sit in the folder.

.. CG-EXPLANATION-END id=const:RECOVERY_KIND

``const RECOVERY_FORMAT_VERSION``
---------------------------------

.. CG-BLOCK id=const:RECOVERY_FORMAT_VERSION lines=136-152

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 136-152
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_FORMAT_VERSION

**What this does.** Sets the version number of the file's *envelope* (its wrapper of standard fields) to ``1``. A file carrying any other version number is skipped as stale rather than half-read.

**Why it is here.** If a future build changes the wrapper's fields, this number is bumped so the new build can tell that an old file speaks a different dialect. Refusing to best-effort parse an unknown version is deliberate — a half-understood recovery file is worse than offering no recovery at all. It starts at ``1`` on its own and is intentionally **not** tied to the ``.strix`` project-file version, because the two change for unrelated reasons.

.. CG-EXPLANATION-END id=const:RECOVERY_FORMAT_VERSION

``const RECOVERY_FILE_CAP_BYTES``
---------------------------------

.. CG-BLOCK id=const:RECOVERY_FILE_CAP_BYTES lines=153-157

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 153-157
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_FILE_CAP_BYTES

**What this does.** Sets the largest a recovery file is allowed to be — 16 mebibytes (about 16 million bytes) — a ceiling applied on **both** the read and the write path.

**Why it is here.** A real recovery payload is session state, only tens of kilobytes, so this cap sits far above anything legitimate and far below the limit used for full ``.strix`` bundles. It stops a corrupt or maliciously-grown file from being pulled whole into the main process's memory, which would freeze the app. It is deliberately **one** number, not one for reads and one for writes: an earlier version capped only reads, so an oversized file wrote happily and then became silently unrecoverable at the next launch — the write path has to refuse exactly what the read path will refuse.

.. CG-EXPLANATION-END id=const:RECOVERY_FILE_CAP_BYTES

``const PROJECT_NAME_MAX_LEN``
------------------------------

.. CG-BLOCK id=const:PROJECT_NAME_MAX_LEN lines=158-158

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 158-158
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_NAME_MAX_LEN

**What this does.** Caps the stored project name at 200 characters.

**Why it is here.** A recovery file's fields could be hand-edited, and a name of, say, 100 MB must never reach the start-screen banner that displays it; capping the length defends that render. It mirrors the matching cap used for the recent-projects list.

.. CG-EXPLANATION-END id=const:PROJECT_NAME_MAX_LEN

``const ISO_TIMESTAMP_MAX_LEN``
-------------------------------

.. CG-BLOCK id=const:ISO_TIMESTAMP_MAX_LEN lines=159-159

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 159-159
   :lineno-match:

.. CG-EXPLANATION-START id=const:ISO_TIMESTAMP_MAX_LEN

**What this does.** Caps the stored write-time timestamp at 64 characters. A *timestamp* here is the moment the file was written, recorded as a standard date-and-time text.

**Why it is here.** Same defensive reason as the name cap — a hand-edited or corrupt file must not carry an absurdly long timestamp string into the app; a real timestamp is well under this length.

.. CG-EXPLANATION-END id=const:ISO_TIMESTAMP_MAX_LEN

``const APP_VERSION_MAX_LEN``
-----------------------------

.. CG-BLOCK id=const:APP_VERSION_MAX_LEN lines=160-166

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 160-166
   :lineno-match:

.. CG-EXPLANATION-START id=const:APP_VERSION_MAX_LEN

**What this does.** Caps the stored app-version string (the version of StrixGeo that wrote the file) at 64 characters.

**Why it is here.** The same length defence as the other two caps, applied to the last free-text field the envelope carries.

.. CG-EXPLANATION-END id=const:APP_VERSION_MAX_LEN

``const UUID_PATTERN``
----------------------

.. CG-BLOCK id=const:UUID_PATTERN lines=167-172

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 167-172
   :lineno-match:

.. CG-EXPLANATION-START id=const:UUID_PATTERN

**What this does.** Defines the exact shape a project id must match — the canonical 8-4-4-4-12 block of hexadecimal digits of a *UUID* (a universally-unique identifier) — anchored so there is nothing before or after it: no surrounding spaces, no braces, no trailing file extension.

**Why it is here.** This one pattern is the entire safety gate for filenames. Anchoring it at both ends is precisely what makes dangerous inputs like ``../../../etc/passwd``, ``a/../b`` and ``<uuid>.recovery.json`` all fail the check, so a path-escaping segment can never reach the disk. It accepts either upper- or lower-case, and any UUID version, because the id comes from the database, not from this file.

.. CG-EXPLANATION-END id=const:UUID_PATTERN

``interface RecoveryStoreConfig``
---------------------------------

.. CG-BLOCK id=interface:RecoveryStoreConfig lines=173-197

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 173-197
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryStoreConfig

**What this does.** Describes the settings handed to this file once at startup: ``userDataDir`` (the absolute path of the app's private per-user folder), ``appVersion`` (the running app's version, stamped into every file) and an optional ``fileCapBytes`` to override the size limit. An *interface* is simply a written description of the fields a value must carry.

**Why it is here.** This file deliberately must not ``import`` Electron itself, because the test suite runs these helpers in a plain browser-like environment where an Electron import would fail to load. So the two facts it needs from Electron — the folder path and the app version — are injected instead. The optional cap override exists so a test can exercise the size limit without having to write a real 16 MB file.

.. CG-EXPLANATION-END id=interface:RecoveryStoreConfig

``function effectiveCapBytes``
------------------------------

.. CG-BLOCK id=function:effectiveCapBytes lines=198-206

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 198-206
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveCapBytes

**What this does.** Returns the size limit currently in force: the caller's override when one was given, otherwise the built-in 16 MiB default.

**Why it is here.** The number is worked out in this one place because writing, reading and listing must all enforce the *same* limit — three copies of the same "use the override, else the default" expression could drift apart in a later edit, and a write limit above the read limit is exactly the "wrote fine, unrecoverable next launch" trap the single limit exists to prevent.

.. CG-EXPLANATION-END id=function:effectiveCapBytes

``interface RecoveryDescriptor``
--------------------------------

.. CG-BLOCK id=interface:RecoveryDescriptor lines=207-231

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 207-231
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryDescriptor

**What this does.** Describes the small summary the start screen needs to offer recovery — a *descriptor* — deliberately **without** the payload itself. It carries the project id, a snapshot of the project name, the file's absolute path, the write timestamp, the app version that wrote it, the file's size in bytes, and a ``declined`` true/false flag.

**Why it is here.** The start screen only needs enough to draw a "restore your unsaved work?" banner; the actual saved work can be large and is fetched only once the user chooses Restore, so it is left out here. The ``declined`` flag lets the banner word the offer honestly — telling the user they chose not to restore this last time, rather than presenting a previously-declined copy as if it were fresh crash debris.

.. CG-EXPLANATION-END id=interface:RecoveryDescriptor

``interface RecoveryWriteOptions``
----------------------------------

.. CG-BLOCK id=interface:RecoveryWriteOptions lines=232-241

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 232-241
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryWriteOptions

**What this does.** Describes the optional extra a caller may attach to a write — today just ``projectName``, the name snapshot for the banner, which defaults to an empty string when not given.

**Why it is here.** Keeping the write's optional metadata in its own named shape leaves room to add more fields later without changing every caller, and makes clear that the project name is a nicety for display, not something the recovery mechanism itself depends on.

.. CG-EXPLANATION-END id=interface:RecoveryWriteOptions

``interface RecoveryEnvelope``
------------------------------

.. CG-BLOCK id=interface:RecoveryEnvelope lines=242-251

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 242-251
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryEnvelope

**What this does.** Describes the actual on-disk wrapper — the *envelope* — around the saved work: ``kind`` and ``format_version`` (the marker and version), ``project_id``, ``project_name``, ``written_at``, ``app_version``, and ``payload`` (the opaque saved state). Its field names are written in snake_case (words joined by underscores).

**Why it is here.** The field names use snake_case to match the convention for JSON written to disk in the ``.strix`` bundle, while the TypeScript-facing ``RecoveryDescriptor`` uses the camelCase the rest of the app's messaging uses — the two shapes are kept separate on purpose. The ``payload`` is *opaque*: this file wraps and unwraps it faithfully but never looks inside it; the renderer phase owns what goes in there.

.. CG-EXPLANATION-END id=interface:RecoveryEnvelope

``let config``
--------------

.. CG-BLOCK id=let:config lines=252-261

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 252-261
   :lineno-match:

.. CG-EXPLANATION-START id=let:config

**What this does.** The single module-wide holder for the injected settings, starting empty (``null``) until startup fills it in.

**Why it is here.** The settings live in one place so every function reads the same folder path, app version and size limit; it starts empty so that any attempt to use the store before it was configured fails with a clear error instead of quietly reading a wrong path.

.. CG-EXPLANATION-END id=let:config

``function configureRecoveryStore``
-----------------------------------

.. CG-BLOCK id=function:configureRecoveryStore lines=262-269

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 262-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:configureRecoveryStore

**What this does.** Installs the runtime settings — called once from ``index.ts`` after Electron is ready, with the real userData folder and app version. Calling it again simply replaces the settings.

**Why it is here.** This is the injection point that keeps the file free of any Electron import (so the tests can run it). Allowing a second call is deliberate: the tests rely on it to swap in a smaller size limit.

.. CG-EXPLANATION-END id=function:configureRecoveryStore

``function resetRecoveryStoreForTests``
---------------------------------------

.. CG-BLOCK id=function:resetRecoveryStoreForTests lines=270-274

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 270-274
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetRecoveryStoreForTests

**What this does.** Clears the installed settings, putting the module back to its unconfigured state.

**Why it is here.** A test-only seam — production code configures the store once at startup and never unconfigures. It lets each test start from a clean slate.

.. CG-EXPLANATION-END id=function:resetRecoveryStoreForTests

``function requireConfig``
--------------------------

.. CG-BLOCK id=function:requireConfig lines=275-295

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 275-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:requireConfig

**What this does.** Returns the installed settings, or throws a clearly-worded error if the store was never configured.

**Why it is here.** Every path this file builds needs the settings; failing loudly with a message that names the fix ("call ``configureRecoveryStore`` first") turns a programming mistake into an obvious, diagnosable error rather than a mysterious crash deep inside a file operation.

.. CG-EXPLANATION-END id=function:requireConfig

``function isValidProjectId``
-----------------------------

.. CG-BLOCK id=function:isValidProjectId lines=296-300

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 296-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:isValidProjectId

**What this does.** A yes/no check: is this value a well-formed UUID, and therefore safe to use as a filename stem? It confirms the value is a text string and matches the strict UUID pattern.

**Why it is here.** This single check is the whole input-validation surface of the file. Because every path is built from a value that passed here, a path-escaping segment, a separator, a drive letter or a trailing extension can never reach the file system. Its argument is typed as "unknown" because the value arrives from the renderer over *IPC* (inter-process communication — the messaging channel by which the web page asks the main process to do something), where any runtime type is possible whatever the code claims.

.. CG-EXPLANATION-END id=function:isValidProjectId

``function assertValidProjectId``
---------------------------------

.. CG-BLOCK id=function:assertValidProjectId lines=301-330

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 301-330
   :lineno-match:

.. CG-EXPLANATION-START id=function:assertValidProjectId

**What this does.** Demands a valid project id: if the value is not a well-formed UUID it throws a uniform "refused" error, showing at most a shortened form of the bad value.

**Why it is here.** The id is **refused, never cleaned up** — sanitising a bad id would invite the "which of the six ways of normalising it wins?" class of bug, so a malformed id is simply rejected. Only a truncated form of the offending value goes into the message, so a crafted id cannot inject a huge string into the log line.

.. CG-EXPLANATION-END id=function:assertValidProjectId

``function canonicalProjectId``
-------------------------------

.. CG-BLOCK id=function:canonicalProjectId lines=331-352

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 331-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:canonicalProjectId

**What this does.** Validates the id and returns it in its **one** canonical spelling — lowercase.

**Why it is here.** The UUID pattern accepts either case because different PostgreSQL clients render a ``uuid`` differently, but accepting both without settling on one is a trap. The id is both the filename stem and the value the envelope check later compares. On Windows's file system a file written under an upper-case id and read back under the lower-case one is the *same* file, yet the strict text comparison would then disagree — recovery would return "nothing to restore" while the user's work sat on disk. Folding to lowercase at this single doorway means the rest of the file only ever sees one spelling; lowercase is chosen because it is the canonical UUID form and what Postgres itself emits.

.. CG-EXPLANATION-END id=function:canonicalProjectId

``function validateWriteOptions``
---------------------------------

.. CG-BLOCK id=function:validateWriteOptions lines=353-372

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 353-372
   :lineno-match:

.. CG-EXPLANATION-START id=function:validateWriteOptions

**What this does.** Checks the caller-supplied write options and returns them narrowed to the known shape. It treats a missing or empty value as "no options", refuses anything that is not a plain object (naming an array explicitly in the message), and refuses a ``projectName`` that is present but not a text string.

**Why it is here.** The messaging channel will happily deliver, say, ``{ projectName: 12345 }`` — the type annotation on the handler is erased at runtime. Left unchecked, a non-string would either crash mid-write or slip into a field the envelope check later refuses, producing an unreadable recovery file. So this refuses like a malformed id rather than quietly coercing the value, which would hide the renderer's bug behind a plausible-looking but wrong banner.

.. CG-EXPLANATION-END id=function:validateWriteOptions

``function recoveryDir``
------------------------

.. CG-BLOCK id=function:recoveryDir lines=373-388

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 373-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:recoveryDir

**What this does.** Returns the absolute path of the recovery folder — the userData folder joined with the ``recovery`` sub-folder name.

**Why it is here.** One small helper so the folder path is composed in a single place, inheriting the "store must be configured" check for free.

.. CG-EXPLANATION-END id=function:recoveryDir

``function recoveryFilePath``
-----------------------------

.. CG-BLOCK id=function:recoveryFilePath lines=389-404

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 389-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:recoveryFilePath

**What this does.** Returns the absolute path of one project's ordinary (*primary*) recovery file: the recovery folder, plus the project's canonical-lowercase id, plus the ``.recovery.json`` ending.

**Why it is here.** This is the **one** place a primary path is composed, so write, read and delete all route through it — the filename convention cannot be spelled four different ways, and every caller inherits the id validation and lower-casing automatically.

.. CG-EXPLANATION-END id=function:recoveryFilePath

``function declinedRecoveryFilePath``
-------------------------------------

.. CG-BLOCK id=function:declinedRecoveryFilePath lines=405-419

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 405-419
   :lineno-match:

.. CG-EXPLANATION-START id=function:declinedRecoveryFilePath

**What this does.** Returns the absolute path of one project's **declined** recovery file — the same single-composer as the primary path, only the ending differs (``.recovery.declined.json``).

**Why it is here.** Same discipline (and therefore the same id validation) as ``recoveryFilePath``; one composer per slot is what keeps the naming consistent and the validation impossible to skip.

.. CG-EXPLANATION-END id=function:declinedRecoveryFilePath

``function corruptRecoveryFilePath``
------------------------------------

.. CG-BLOCK id=function:corruptRecoveryFilePath lines=420-436

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 420-436
   :lineno-match:

.. CG-EXPLANATION-START id=function:corruptRecoveryFilePath

**What this does.** Returns the absolute path of one project's **quarantined** recovery file (``.recovery.corrupt.json``), again through the one-composer discipline.

**Why it is here.** Same reason as the other two composers — one place, one spelling, the id validation for free — for the slot an unreadable primary is moved aside into.

.. CG-EXPLANATION-END id=function:corruptRecoveryFilePath

``function validateEnvelope``
-----------------------------

.. CG-BLOCK id=function:validateEnvelope lines=437-465

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 437-465
   :lineno-match:

.. CG-EXPLANATION-START id=function:validateEnvelope

**What this does.** Checks a parsed file's contents and returns a trustworthy envelope, or ``null`` meaning "skip this file". It rejects anything that is not a plain object, a wrong marker, a version this build does not speak, a project id that disagrees (compared case-folded) with the filename it was found under, over-long name / timestamp / version fields, and a missing ``payload`` key.

**Why it is here.** This is the gate that keeps garbage out of a recovery offer. Rejecting a wrong version is the "stale file from an older app version" defence; comparing the id case-folded means an id that differs only in upper/lower case is treated as the same file, not a renamed one, so real work is never hidden by a spelling difference; and the field-length checks stop a hand-edited file from carrying a pathological value into the app.

.. CG-EXPLANATION-END id=function:validateEnvelope

``interface ResolvedSlot``
--------------------------

.. CG-BLOCK id=interface:ResolvedSlot lines=466-493

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 466-493
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResolvedSlot

**What this does.** Describes one recovery file that has been picked, loaded and validated: its absolute path, whether it came from the declined slot, its validated envelope, and its on-disk size.

**Why it is here.** A small internal shape that bundles together everything a reader learns when it resolves which of a project's two slots to use, so that answer can be passed around as one value.

.. CG-EXPLANATION-END id=interface:ResolvedSlot

``function quarantinePrimary``
------------------------------

.. CG-BLOCK id=function:quarantinePrimary lines=494-536

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 494-536
   :lineno-match:

.. CG-EXPLANATION-START id=function:quarantinePrimary

**What this does.** Moves an unreadable primary file out of the way — renaming it to the quarantine ending — so it stops shadowing any declined copy behind it, and logs a WARNING naming the file and the reason. It never throws.

**Why it is here.** It deliberately overwrites any older quarantine file, because this is a diagnostic and not an archive — keeping every corrupt file would grow the folder without bound exactly when something is repeatedly writing garbage. It never throws because failing to tidy up must never become a failure to start the app: a quarantine that fails leaves the caller precisely where it would have been anyway (no offer for this project). The WARNING is loud on purpose — the file's name plus the reason is the whole diagnosis, and losing it to a quiet log level would leave only "recovery silently offered nothing".

.. CG-EXPLANATION-END id=function:quarantinePrimary

``function resolveSlot``
------------------------

.. CG-BLOCK id=function:resolveSlot lines=537-578

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 537-578
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveSlot

**What this does.** Picks which of a project's two slots a reader should use and loads it, or returns ``null`` when there is nothing readable. It tries the primary first; a readable primary wins. If the primary exists but will not load (garbled, foreign, stale, or over the size limit), it quarantines that primary and falls through to the declined slot.

**Why it is here.** A readable primary wins whenever both slots exist because a primary present alongside a declined one means the session that declined went on to make new work and then died without a clean exit — that work is strictly newer than the declined copy, so offering the declined one would hand back the older of the two. But that reasoning only holds while the primary really is *state*: garbage carries nothing to prefer, and left to "win" it would hide a good declined copy at every launch forever. So an unreadable primary is quarantined and the resolve continues to the declined slot — which is no silent substitution, because there was no newer work to substitute for. An over-cap **declined** file, having nothing behind it to fall back to, stays a loud failure rather than a skip.

.. CG-EXPLANATION-END id=function:resolveSlot

``function loadEnvelope``
-------------------------

.. CG-BLOCK id=function:loadEnvelope lines=579-632

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 579-632
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadEnvelope

**What this does.** The one routine that reads and checks a single recovery file, whichever slot it sits in: it measures the file first (a cheap size check) and refuses — throws — anything over the size limit, then parses the JSON text (returning ``null`` on unparseable text), then runs the envelope validation.

**Why it is here.** Spelling the size limit, the parse and the validation once means the declined slot can never drift into weaker checks than the primary. Measuring the size before reading avoids allocating memory for a huge file. Callers differ only in what they do with the over-cap throw: the by-name read propagates it (the user asked for this exact file), while the folder listing catches it and skips the entry.

.. CG-EXPLANATION-END id=function:loadEnvelope

``function writeRecovery``
--------------------------

.. CG-BLOCK id=function:writeRecovery lines=633-718

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 633-718
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeRecovery

**What this does.** Saves one project's recovery payload, atomically. It validates the id and options first, builds the envelope (marker, version, id, name, current timestamp, app version, and the payload), converts it to JSON, refuses it if that is not serialisable or if its byte size exceeds the limit, creates the recovery folder on the first ever write, and writes the **primary** file through the atomic writer. It returns a descriptor of what it wrote.

**Why it is here.** It writes the primary slot only, never the declined one — that is the very property that makes "Open without restoring" survivable, because the autosave runs continuously against the primary slot, so a declined copy is out of its reach by construction rather than by a check that could be forgotten. Validation happens before any folder is created, so a refused write leaves no trace on disk and never disturbs an existing recovery file. The payload must be plain JSON values only: a ``Set`` or a ``Map`` survives the messaging bridge intact but ``JSON.stringify`` here would silently turn it into an empty object, so it would restore empty exactly when the user needed it — a hard contract, so the renderer must convert those to arrays or plain objects first. The size limit is checked in bytes (multi-byte characters counted properly) before writing, so an over-cap payload leaves the previous, still-restorable file untouched.

.. CG-EXPLANATION-END id=function:writeRecovery

``function listRecovery``
-------------------------

.. CG-BLOCK id=function:listRecovery lines=719-802

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 719-802
   :lineno-match:

.. CG-EXPLANATION-START id=function:listRecovery

**What this does.** Describes every valid recovery file on disk, newest first, without ever returning a payload. It lists the recovery folder, and for each name that ends in a primary or declined suffix and whose stem is a valid UUID, it resolves that project's slot (so it describes the file a Restore would actually load), collecting one descriptor per project. Corrupt, foreign, stale, oversized, or oddly-named files are skipped, not thrown on.

**Why it is here.** The start screen needs only enough to draw a banner and the payloads can be large, so the payload is left out. One bad file must never stop the user from seeing the others, so every per-file error is caught and skipped (unlike the by-name read, a throw here must not take the whole start screen down). It collapses a project's two slots into a single offer by de-duplicating on project id — listing both would put two entries for one project on the start screen, only one of which Restore would load — and sorts newest-first so a single-entry banner shows the freshest work.

.. CG-EXPLANATION-END id=function:listRecovery

``function readRecovery``
-------------------------

.. CG-BLOCK id=function:readRecovery lines=803-831

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 803-831
   :lineno-match:

.. CG-EXPLANATION-START id=function:readRecovery

**What this does.** Returns one project's saved payload — for when the user chooses Restore. It resolves the project's slot (the primary file if present, otherwise the declined copy) and returns the payload, or ``null`` when there is no recovery file in either slot or the file is unusable.

**Why it is here.** This is the "give me the work back" call. Both slots go through the same validation and the same size limit. An unusable **primary** is quarantined on the way past, so the declined copy behind it — if any — is what comes back. An over-cap **declined** file is a loud throw rather than a quiet "nothing", because nothing sits behind the declined slot, so silently returning "nothing to restore" would hide a real problem.

.. CG-EXPLANATION-END id=function:readRecovery

``function declineRecovery``
----------------------------

.. CG-BLOCK id=function:declineRecovery lines=832-859

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 832-859
   :lineno-match:

.. CG-EXPLANATION-START id=function:declineRecovery

**What this does.** Moves one project's primary recovery file into the declined slot — called when the user picks "Open without restoring". It renames the primary file to the declined name and reports whether a file was actually there to move.

**Why it is here.** The rename is what keeps the copy alive. The autosave is about to start writing the primary slot for the freshly-opened session, and the next decided exit deletes that primary file; moved out of the scheduler's way, the declined copy survives until the user explicitly discards it, so a restart re-offers the same unsaved work (owner decision, 3 August 2026). An older declined copy is overwritten — newest decline wins, because two declines without a Discard in between mean the second carries the later session state. A missing source is the ordinary "this session never had anything at risk" case and simply returns false.

.. CG-EXPLANATION-END id=function:declineRecovery

``function deleteRecovery``
---------------------------

.. CG-BLOCK id=function:deleteRecovery lines=860-889

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 860-889
   :lineno-match:

.. CG-EXPLANATION-START id=function:deleteRecovery

**What this does.** Deletes **both** of a project's slots (and any quarantine file) — called once the session the files protected has been saved or explicitly discarded. It removes the primary and the declined file without short-circuiting, then removes any quarantine file, and reports whether at least one real recovery file was removed.

**Why it is here.** Clearing both is what makes the prompt's **Discard** actually mean discard. If it cleared only the primary, a project the user had once declined would keep re-offering that stale copy at every launch, and the Discard button — the one control the user has over it — would look broken. It does not short-circuit, so the declined copy still goes even when the primary was already gone (the ordinary decline-then-discard order). The quarantine file's removal does not count toward the returned "removed something" answer, because nothing reads it and the caller's log line is about the user's work.

.. CG-EXPLANATION-END id=function:deleteRecovery

``function deleteDeclinedRecovery``
-----------------------------------

.. CG-BLOCK id=function:deleteDeclinedRecovery lines=890-912

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 890-912
   :lineno-match:

.. CG-EXPLANATION-START id=function:deleteDeclinedRecovery

**What this does.** Deletes only a project's **declined** copy, leaving the primary slot untouched, and reports whether a declined copy was there.

**Why it is here.** This third delete exists for one path: restoring a copy that came *out* of the declined slot. A restore leaves the work at risk again, so the restored content is written to the primary slot first and the decline is ended second. Without this call the declined file would sit behind the new primary, every clean exit would clear only the primary, and the same work would be offered again at every launch — forever, with no way for the user to say no that sticks.

.. CG-EXPLANATION-END id=function:deleteDeclinedRecovery

``function deletePrimaryRecovery``
----------------------------------

.. CG-BLOCK id=function:deletePrimaryRecovery lines=913-924

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 913-924
   :lineno-match:

.. CG-EXPLANATION-START id=function:deletePrimaryRecovery

**What this does.** Deletes only a project's **primary** file, leaving any declined copy alone, and reports whether a primary file was removed.

**Why it is here.** This is the clear that every path *except* the prompt's Discard wants — a save, a discard-and-close, a clean close, a quit, and the autosave's dirty-to-clean transition all mean "*this session's* work now has a durable home". They say nothing about a copy the user declined in an earlier session, which by owner decision survives until Discard; using the both-slots delete here would take that declined copy with it and reinstate exactly the silent loss the declined slot was added to prevent. A declined copy left in place does not count as a removal, so the caller's log line cannot claim to have cleared something it did not.

.. CG-EXPLANATION-END id=function:deletePrimaryRecovery

``function unlinkIfPresent``
----------------------------

.. CG-BLOCK id=function:unlinkIfPresent lines=925-933

.. literalinclude:: ../../../desktop/src/main/recoveryStore.ts
   :language: typescript
   :lines: 925-933
   :lineno-match:

.. CG-EXPLANATION-START id=function:unlinkIfPresent

**What this does.** Deletes one file, treating "it was already gone" as a normal non-event: it returns true when the file was removed, false when it did not exist, and re-throws any other error.

**Why it is here.** The shared low-level helper behind all three deletes. A missing file is the common, expected case (clearing recovery on a clean shutdown where none was ever written), so it must not be an error — but a genuinely locked file or a permissions problem is real and is surfaced rather than swallowed. (``ENOENT`` is the operating system's "no such file" code.)

.. CG-EXPLANATION-END id=function:unlinkIfPresent

