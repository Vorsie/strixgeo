desktop.renderer.src.utils.projectFile
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/projectFile.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/projectFile.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file builds, saves, reads back and checks the JSON payload that makes up a project file on disk — JSON being the plain text format the app and the engine exchange data in. The opening comment draws the file's layout at format_version 3: the project's own details, the full data tree (every CPT and borehole with its readings), and every engineering decision (geology, sections, correlations, bodies, absences, tombstones, and the rest). The only import is the bundle and project response types the payload mirrors.

**Why it is here.** The comment records the file's role: it is the user's anchor, so opening it must always succeed and bring everything back even after the database is wiped, and every per-project decision lives here and never in the browser's local store (memory: project decisions in the bundle). It warns that adding a collection is safe (additive) but needs four matching edits here plus one in the restore path, and that the builder is a hand-written allow-list that silently drops any key it does not name — which is how one collection went missing for three days in August. It also records that the file on disk is now wrapped in a separate binary container in the main process; ``format_version`` here describes only the JSON inside that wrapper and moves independently of the wrapper's own version (memory: .strix format version decoupled from the bundle).

.. CG-EXPLANATION-END id=module-header

``const PROJECT_FILE_FORMAT_VERSION``
-------------------------------------

.. CG-BLOCK id=const:PROJECT_FILE_FORMAT_VERSION lines=53-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 53-59
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_FILE_FORMAT_VERSION

**What this does.** The current project-file version number: 3.

**Why it is here.** The comment records that this number is bumped only when the file's shape changes in a way older builds cannot read; adding new optional collections does not bump it.

.. CG-EXPLANATION-END id=const:PROJECT_FILE_FORMAT_VERSION

``const BUNDLE_NEWER_FORMAT_CODE``
----------------------------------

.. CG-BLOCK id=const:BUNDLE_NEWER_FORMAT_CODE lines=60-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 60-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:BUNDLE_NEWER_FORMAT_CODE

**What this does.** A fixed code string, ``'bundle-newer-format'``, marking a file whose inner version is newer than this build understands. The block ends with the documentation for the read-failure shape below.

**Why it is here.** The comment records that the open flow branches on this code to show a "saved by a newer build" message instead of the generic "may be corrupt" one (production-readiness audit L4) — a clear, honest reason rather than a scary one.

.. CG-EXPLANATION-END id=const:BUNDLE_NEWER_FORMAT_CODE

``interface StrixReadFailureReason``
------------------------------------

.. CG-BLOCK id=interface:StrixReadFailureReason lines=72-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 72-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StrixReadFailureReason

**What this does.** A declared shape for why a project file could not be read: a stable ``code`` and a user-honest ``message``.

**Why it is here.** The comment records that this is the renderer-side mirror of the same shape in the main process, duplicated across that boundary on purpose because neither side imports the other; the code is the stable label to branch on and the message is the text to show the engineer.

.. CG-EXPLANATION-END id=interface:StrixReadFailureReason

``type ProjectFileReadResult``
------------------------------

.. CG-BLOCK id=type:ProjectFileReadResult lines=78-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 78-91
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectFileReadResult

**What this does.** The two possible outcomes of reading a project file across the process boundary: either success carrying the JSON text, or failure carrying a reason. The block ends with the documentation for the lumping shape below.

**Why it is here.** It forces the caller to handle both outcomes explicitly rather than guessing whether a read worked, which is why success and failure each carry their own payload.

.. CG-EXPLANATION-END id=type:ProjectFileReadResult

``interface StratigraphyLumping``
---------------------------------

.. CG-BLOCK id=interface:StratigraphyLumping lines=92-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 92-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StratigraphyLumping

**What this does.** The shape of the manual lumping snapshot stored in the bundle: a schema version, the time it was applied, and the map from each candidate name to the formation it was lumped into. The block ends with the comment introducing the v3 file shape below.

**Why it is here.** The comment records that this mirrors the backend model and is metadata only: on restore the map is stored as-is and NEVER re-applied, because the formations and contacts already in the bundle are the applied result; the dialog only uses it to pre-fill the next time Fill-from-boreholes is opened.

.. CG-EXPLANATION-END id=interface:StratigraphyLumping

``interface ProjectFileV3``
---------------------------

.. CG-BLOCK id=interface:ProjectFileV3 lines=103-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 103-172
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectFileV3

**What this does.** The declared shape of a version-3 project file: the format tag, the project block, and each collection — CPTs, boreholes, geological formations and models, cross-sections, investigation reviews, correlation edges, bodies, formation absences, body boundary shapes and nodes, body geometry facts, tie tombstones, body separations and unions, and the optional lumping snapshot. Every nested row is left opaque (a bag of unknown fields).

**Why it is here.** The comment records that the shape mirrors the backend bundle response one-for-one and the renderer only round-trips the rows, never inspecting individual columns. Many collections are marked "absent in older files, normalised to an empty list on parse" because they are additive. Several — body geometry facts, tie tombstones, separations and unions — are flagged as EVIDENCE, not a rebuildable cache: a file saved without them silently reopens with those merges, deletions and splits undone, so they must always be written (owner rulings recorded in the comments).

.. CG-EXPLANATION-END id=interface:ProjectFileV3

``type ProjectFile``
--------------------

.. CG-BLOCK id=type:ProjectFile lines=173-178

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 173-178
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectFile

**What this does.** A name, ``ProjectFile``, that stands for the version-3 shape. The block ends with the comment introducing the builder below.

**Why it is here.** It gives the rest of the app one plain name to use, so if a future version is ever added only this alias changes.

.. CG-EXPLANATION-END id=type:ProjectFile

``function buildProjectFile``
-----------------------------

.. CG-BLOCK id=function:buildProjectFile lines=179-212

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 179-212
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildProjectFile

**What this does.** Builds a version-3 payload from the live bundle the engine returned: it copies the project and every collection across, defaulting any missing collection to an empty list, and folds in the stratigraphy-lumping snapshot passed by the caller.

**Why it is here.** The comment records that the bundle already carries everything in the exact shape the restore endpoint accepts, so it is stored verbatim with the format tag. The lumping map is passed as a separate argument rather than read from the bundle because the engine's bundle response has no knowledge of it — it lives on the app side after the Fill-from-boreholes confirm — so passing it explicitly lets it be written into the file atomically at save time.

.. CG-EXPLANATION-END id=function:buildProjectFile

``function serialiseProjectFile``
---------------------------------

.. CG-BLOCK id=function:serialiseProjectFile lines=213-220

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 213-220
   :lineno-match:

.. CG-EXPLANATION-START id=function:serialiseProjectFile

**What this does.** Turns the payload into pretty-printed JSON text with two-space indenting and a trailing newline.

**Why it is here.** The comment records the choice to keep the file human-inspectable and clean to compare in version control; big projects make big files, but the team values being able to read and diff them.

.. CG-EXPLANATION-END id=function:serialiseProjectFile

``function parseProjectFile``
-----------------------------

.. CG-BLOCK id=function:parseProjectFile lines=221-278

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 221-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseProjectFile

**What this does.** Reads a text string back into a version-3 payload, or returns nothing when the text is not valid JSON, is the wrong shape, or is an older-than-3 file. Before returning, it backfills every additive collection that is missing with an empty list and sets an absent lumping snapshot to nothing.

**Why it is here.** The comment records why the backfill matters: older files saved before a field existed would otherwise carry a missing value there and crash the code downstream that walks the list. Absence is normalised rather than rejected because these fields are additive, and backwards-compatibility is suspended pre-ship so additive changes are always safe.

.. CG-EXPLANATION-END id=function:parseProjectFile

``function newerBundleFormatVersion``
-------------------------------------

.. CG-BLOCK id=function:newerBundleFormatVersion lines=279-295

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 279-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:newerBundleFormatVersion

**What this does.** Looks at a rejected file's raw text and returns its version number only when it is an object whose version is a real number greater than this build's supported version; otherwise it returns nothing.

**Why it is here.** The comment records that it was split out from the parser so the open flow can tell a "saved by a newer build" file apart from plain corruption without parsing twice; it is kept free of any display text so the caller can translate the result (production-readiness audit L4).

.. CG-EXPLANATION-END id=function:newerBundleFormatVersion

``function isProjectFileV3``
----------------------------

.. CG-BLOCK id=function:isProjectFileV3 lines=296-337

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 296-337
   :lineno-match:

.. CG-EXPLANATION-START id=function:isProjectFileV3

**What this does.** The shape check behind the parser: it confirms the version is 3, the project block is a real object (not an array), the required collections are all arrays, and each additive collection is either missing or an array, with the lumping field missing, empty, or a valid snapshot.

**Why it is here.** The comment records the sharp edge it guards: because an array counts as an object to the language, an array-shaped project block would slip past a naive check and only fail much later, so it is rejected here explicitly; the additive fields are tolerated when absent for older files.

.. CG-EXPLANATION-END id=function:isProjectFileV3

``function projectIdFromFile``
------------------------------

.. CG-BLOCK id=function:projectIdFromFile lines=338-348

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 338-348
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectIdFromFile

**What this does.** Pulls the project id out of the file's project block, and raises an error if it is missing or not text.

**Why it is here.** The comment records that the id is the file's anchor — every other field is either negotiable on restore or transient — so a file without a usable id is a hard error rather than something to paper over.

.. CG-EXPLANATION-END id=function:projectIdFromFile

``function projectResponseFromFile``
------------------------------------

.. CG-BLOCK id=function:projectResponseFromFile lines=349-362

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 349-362
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectResponseFromFile

**What this does.** Hands back the file's project block typed as a partial project response. The block ends with the comment introducing the file-extension constants below.

**Why it is here.** The comment records that this lets the metadata editor feed a project-response-like object straight to the welcome screen and sidebar without making a fresh engine call.

.. CG-EXPLANATION-END id=function:projectResponseFromFile

``const PROJECT_FILE_EXTENSION``
--------------------------------

.. CG-BLOCK id=const:PROJECT_FILE_EXTENSION lines=363-363

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 363-363
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROJECT_FILE_EXTENSION

**What this does.** The file extension new saves use: ``strix`` (lower-case, no leading dot).

**Why it is here.** The comment records that Electron's file-filter field expects this bare shape, and that every Save and Save-As writes ``.strix`` going forward.

.. CG-EXPLANATION-END id=const:PROJECT_FILE_EXTENSION

``const LEGACY_PROJECT_FILE_EXTENSION``
---------------------------------------

.. CG-BLOCK id=const:LEGACY_PROJECT_FILE_EXTENSION lines=364-368

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 364-368
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEGACY_PROJECT_FILE_EXTENSION

**What this does.** The old extension, ``gmproj``, still accepted when opening a file. The block ends with the comment introducing the default-filename helper below.

**Why it is here.** The comment records that ``.gmproj`` was the project's internal codename before the public rebrand; existing ``.gmproj`` files are still accepted on open so users keep working, even though new saves use ``.strix``.

.. CG-EXPLANATION-END id=const:LEGACY_PROJECT_FILE_EXTENSION

``function defaultProjectFileName``
-----------------------------------

.. CG-BLOCK id=function:defaultProjectFileName lines=369-372

.. literalinclude:: ../../../desktop/src/renderer/src/utils/projectFile.ts
   :language: typescript
   :lines: 369-372
   :lineno-match:

.. CG-EXPLANATION-START id=function:defaultProjectFileName

**What this does.** Suggests a filename for a new save by replacing any characters Windows forbids in a filename with underscores, trimming it, falling back to ``project`` if nothing is left, and adding the ``.strix`` extension.

**Why it is here.** The comment records this keeps the project name from breaking the operating system's file picker, which forbids characters such as the colon, slash and question mark.

.. CG-EXPLANATION-END id=function:defaultProjectFileName

