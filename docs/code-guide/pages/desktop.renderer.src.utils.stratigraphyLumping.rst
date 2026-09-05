desktop.renderer.src.utils.stratigraphyLumping
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/stratigraphyLumping.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/stratigraphyLumping.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Reads the stratigraphy-lumping map (the engineer's grouping of stratigraphy names into shared aliases) back out of its database home. The comment records that the map lives in three columns on the project — a staged copy, a saved copy, and a monotonic revision counter — and then documents the parse-result type below.

**Why it is here.** The comment records the design (docs/design/autosave-recovery.md): the server's read path is deliberately pass-through and never validates those raw JSON blobs, because a single project with a malformed blob would otherwise crash the whole project list and take down the start screen; so validation lands here, on the renderer's read. Everything in the module is pure — no API calls, no React, no logging — and the caller decides what to log and what to do with a rejection.

.. CG-EXPLANATION-END id=module-header

``type LumpingParseResult``
---------------------------

.. CG-BLOCK id=type:LumpingParseResult lines=18-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 18-32
   :lineno-match:

.. CG-EXPLANATION-START id=type:LumpingParseResult

**What this does.** The outcome of narrowing one opaque database blob into a lumping snapshot — either ``ok: true`` with the snapshot (or nothing), or ``ok: false`` with a human-readable reason. It is followed by the parse function's docstring.

**Why it is here.** The docstring records that a missing value is a legitimate result meaning "this project has no lumping map", which is distinct from a snapshot whose map is empty (the engineer ran Fill and grouped nothing), so success carries a possibly-empty snapshot rather than throwing.

.. CG-EXPLANATION-END id=type:LumpingParseResult

``function parseStratigraphyLumping``
-------------------------------------

.. CG-BLOCK id=function:parseStratigraphyLumping lines=33-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 33-85
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseStratigraphyLumping

**What this does.** Validates an opaque value into a lumping snapshot. A missing value succeeds with no map; a non-object or an array fails; then it checks the schema version is 1, the applied-at timestamp is a string, the map is an object, and every map entry is a string — failing with a specific reason for each — and on success returns the narrowed snapshot. It then documents ``lumpingsEqual`` below.

**Why it is here.** The comment records that because the server never validates these blobs, this is the one gate; each failure carries a specific reason the caller can log, so a bad blob is diagnosable rather than a silent crash.

.. CG-EXPLANATION-END id=function:parseStratigraphyLumping

``function lumpingsEqual``
--------------------------

.. CG-BLOCK id=function:lumpingsEqual lines=86-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 86-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:lumpingsEqual

**What this does.** Tests whether two snapshots carry the same map. Two missing snapshots are equal; a missing one and a real one are not; otherwise the two maps are compared key by key rather than by reference. It then documents the lumping-columns interface below.

**Why it is here.** The docstring records why the schema version and the applied-at timestamp are deliberately excluded: the timestamp changes on every Apply even when the map does not, and the engineering decision IS the map contents, so an identical map means the engineer made no new decision and the project must not go dirty. It lives here because it is the shared definition of "the lumping map is dirty", which the dirty flag and the recovery scheduler must both agree on.

.. CG-EXPLANATION-END id=function:lumpingsEqual

``interface LumpingColumns``
----------------------------

.. CG-BLOCK id=interface:LumpingColumns lines=102-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 102-108
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LumpingColumns

**What this does.** The three lumping columns exactly as they arrive on a project read — staged, saved, and the revision number. It is followed by the docstring for the resolved-open shape below.

**Why it is here.** Names precisely the fields the open resolver reads off a freshly-read project.

.. CG-EXPLANATION-END id=interface:LumpingColumns

``interface ResolvedOpenLumping``
---------------------------------

.. CG-BLOCK id=interface:ResolvedOpenLumping lines=109-140

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 109-140
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResolvedOpenLumping

**What this does.** What the two in-memory lumping slots should hold right after a project is opened: the current (staged, possibly unsaved) map, the saved map, the revision counter, which copy won (for the log line), and a warning when the database copy had to be rejected. It is followed by the resolver's docstring.

**Why it is here.** Bundles everything the caller needs to seed its state and log the outcome in one return value.

.. CG-EXPLANATION-END id=interface:ResolvedOpenLumping

``function resolveOpenLumping``
-------------------------------

.. CG-BLOCK id=function:resolveOpenLumping lines=141-184

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 141-184
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveOpenLumping

**What this does.** Decides what the two slots hold on open. A missing revision means no revision-aware client has ever staged this project, so the file on disk stays authoritative and both slots seed from it. Otherwise it parses the staged and saved blobs; if either is unusable it falls back to the file but keeps the stored revision; otherwise the database copy wins. It then documents ``nextLumpingRevision``.

**Why it is here.** The comment records why the database wins whenever it carries a revision: the staged slot is written the instant the engineer hits Apply, so it survives a crash the project file — only rewritten on File → Save — cannot, and re-seeding the current slot from staged reopens a crashed-mid-edit project dirty, still carrying the applied map. That re-seeded dirty state is the crash-safety feature. Keeping the revision even when a blob is unusable stops the next Apply staging a revision the server already stores, which the monotonic guard would reject.

.. CG-EXPLANATION-END id=function:resolveOpenLumping

``function nextLumpingRevision``
--------------------------------

.. CG-BLOCK id=function:nextLumpingRevision lines=185-191

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 185-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:nextLumpingRevision

**What this does.** Returns the revision the next stage should claim — the current one plus one, or 1 when nothing has been staged yet. It is followed by the comment introducing the stale-stage pattern below.

**Why it is here.** The docstring records that the counter is monotonic and never reused: the server rejects anything lower than what it already stores, so a first stage on a never-staged project starts at 1.

.. CG-EXPLANATION-END id=function:nextLumpingRevision

``const STALE_STAGE_PATTERN``
-----------------------------

.. CG-BLOCK id=const:STALE_STAGE_PATTERN lines=192-207

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 192-207
   :lineno-match:

.. CG-EXPLANATION-START id=const:STALE_STAGE_PATTERN

**What this does.** A pattern that matches the "< stored N" part of the server's stale-stage rejection message, followed by the docstring for the recovery function below.

**Why it is here.** The comment records that the rejection sentence ("Stale lumping stage: revision 3 < stored 9") is the only place the server exposes its stored counter on a rejection.

.. CG-EXPLANATION-END id=const:STALE_STAGE_PATTERN

``function storedRevisionFromStaleError``
-----------------------------------------

.. CG-BLOCK id=function:storedRevisionFromStaleError lines=208-213

.. literalinclude:: ../../../desktop/src/renderer/src/utils/stratigraphyLumping.ts
   :language: typescript
   :lines: 208-213
   :lineno-match:

.. CG-EXPLANATION-START id=function:storedRevisionFromStaleError

**What this does.** Pulls the server's stored revision out of a stale-stage rejection message, returning nothing when the message is not a recognisable rejection.

**Why it is here.** The comment records why the message is parsed: a rejection means this session's counter has fallen behind the server's and every later stage would collide the same way; the API's error channel carries only a detail string, so the choice is this match or an extra project fetch per rejection, and a failed match simply leaves the counter alone.

.. CG-EXPLANATION-END id=function:storedRevisionFromStaleError

