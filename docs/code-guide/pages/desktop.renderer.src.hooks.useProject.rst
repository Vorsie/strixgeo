desktop.renderer.src.hooks.useProject
=====================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useProject.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useProject.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-96

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 1-96
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The long file comment and the imports (five React hooks, the API client, the projection-cache clear, several project and project-file types and helpers, an API-status guard, the logger, a slow-restore hint, the translation helper, and stratigraphy-lumping helpers). The comment lays out the *two-stage save* model this hook implements.

**Why it is here.** Two-stage save means two copies live side by side: ``project`` (the ``live`` copy the on-screen editor changes) and ``saved`` (the last loaded-or-saved snapshot). The project is *dirty* whenever the two differ, and only an explicit File to Save commits to the database and rewrites the ``.gmproj`` file. Imported data (CPT, borehole, lab) deliberately stays OUT of this model — it commits the instant it is imported, because it is explicit data ingestion, not a field tweak — and stratigraphy lumping follows the same two-stage model as metadata. On launch nothing is loaded; the welcome screen drives the first interaction. One import comment records that the API-status guard is imported from its own defining module rather than the shared barrel, because tests routinely replace the barrel and a replaced barrel would break the runtime check while the types still compiled.

.. CG-EXPLANATION-END id=module-header

``type RevertToLastSavedResult``
--------------------------------

.. CG-BLOCK id=type:RevertToLastSavedResult lines=97-102

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 97-102
   :lineno-match:

.. CG-EXPLANATION-START id=type:RevertToLastSavedResult

**What this does.** Names the four possible outcomes of reverting a project to its last-saved file: ``reverted``, ``no-snapshot``, ``refused-not-latest-save`` and ``failed``.

**Why it is here.** A bare ``false`` used to carry all three failure shapes at once, and the close flow read every one of them as ``never-saved project`` and fell through to a database DELETE of the session's newly-created rows — destroying work the file never held (audit 2026-08-02). Only ``no-snapshot`` licenses deleting; the other two failures must change nothing and tell the engineer.

.. CG-EXPLANATION-END id=type:RevertToLastSavedResult

``interface UseProjectState``
-----------------------------

.. CG-BLOCK id=interface:UseProjectState lines=103-158

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 103-158
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseProjectState

**What this does.** The hook's state shape: the live ``project``, the ``saved`` snapshot, the ``dirty`` flag, the ``.gmproj`` file path, the current and saved lumping snapshots, the monotonic lumping revision, and four manifest sets (the ids of the CPTs, boreholes, formations and cross-sections this project references).

**Why it is here.** It documents each piece. The manifest sets are the in-memory record of what the saved-on-disk file references — seeded on open, appended on import, trimmed on discard — and are deliberately NOT persisted, so a hard kill loses any unsaved imports, which is the intended behaviour. The lumping revision is a monotonic counter written to BOTH the database and the crash-recovery file, and recovery reconciliation compares those numbers, never wall-clock times (docs/design/autosave-recovery.md).

.. CG-EXPLANATION-END id=interface:UseProjectState

``type ManifestKind``
---------------------

.. CG-BLOCK id=type:ManifestKind lines=159-167

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 159-167
   :lineno-match:

.. CG-EXPLANATION-START id=type:ManifestKind

**What this does.** Names the four kinds of entity the manifest tracks: cpt, borehole, formation and section.

**Why it is here.** All four bundle-persistent top-level arrays follow the same lifecycle — seed from the file on open, append on creation, drop on discard, trim before the file is written — so they share one label.

.. CG-EXPLANATION-END id=type:ManifestKind

``interface ProjectOpenUnreadable``
-----------------------------------

.. CG-BLOCK id=interface:ProjectOpenUnreadable lines=168-173

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 168-173
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectOpenUnreadable

**What this does.** The shape returned when a ``.strix`` file is damaged, truncated, or from a newer build: an ``unreadable`` outcome plus a specific reason.

**Why it is here.** It is kept distinct from a bare ``null`` (a generic parse or database failure) so the open flow can show the specific, honest message — the RAM-corruption-mid-save case this machine has actually seen needs a loud, specific banner, not the generic ``may be corrupt, or the API is not reachable``.

.. CG-EXPLANATION-END id=interface:ProjectOpenUnreadable

``function isProjectOpenUnreadable``
------------------------------------

.. CG-BLOCK id=function:isProjectOpenUnreadable lines=174-188

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 174-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:isProjectOpenUnreadable

**What this does.** A *type guard*: checks whether an open result is the unreadable-file failure and tells the type-checker so.

**Why it is here.** Lets the caller branch on that specific failure with the type system's help, rather than inspecting the shape by hand at each call site.

.. CG-EXPLANATION-END id=function:isProjectOpenUnreadable

``type PickAndOpenResult``
--------------------------

.. CG-BLOCK id=type:PickAndOpenResult lines=189-193

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 189-193
   :lineno-match:

.. CG-EXPLANATION-START id=type:PickAndOpenResult

**What this does.** The three outcomes of a picker-driven open: ``opened`` (with the project and its path), ``cancelled``, or ``failed`` (with an optional message).

**Why it is here.** It separates a real failure from a simply-cancelled file dialog, so the caller shows an error banner only when the failure is real.

.. CG-EXPLANATION-END id=type:PickAndOpenResult

``interface UseProjectActions``
-------------------------------

.. CG-BLOCK id=interface:UseProjectActions lines=194-324

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 194-324
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseProjectActions

**What this does.** The long list of actions the hook exposes: create, open and pick-and-open a project; add to and remove from the manifest; apply a metadata draft; patch the view state; save; ask whether the last save reached the file; revert to the last saved file; reset staged lumping; save-as; ask whether recovery may clear; discard edits; archive; close; and stage lumping.

**Why it is here.** It names the whole action surface with the constraint each one carries. For example: ``saveProject`` reports success only when the project reached BOTH durable homes (database and file), so a failed write keeps it dirty rather than clearing the markers over a stale file; ``applyViewStatePatch`` updates both the live project and the saved copy so a view-state change does NOT flip the dirty flag (it is reversible screen chrome on its own auto-persist track); ``stageLumping`` writes the project's staged column, not the file, so lumping obeys the two-stage model; and ``revertToLastSaved`` is the replace-restore behind the ``Don't Save`` branch, where only a ``no-snapshot`` outcome permits deleting the session's creates.

.. CG-EXPLANATION-END id=interface:UseProjectActions

``type UseProject``
-------------------

.. CG-BLOCK id=type:UseProject lines=325-341

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 325-341
   :lineno-match:

.. CG-EXPLANATION-START id=type:UseProject

**What this does.** The full hook return: the state shape and the action shape combined into one type.

**Why it is here.** One type callers read to get everything the project hook provides — state and actions in a single object.

.. CG-EXPLANATION-END id=type:UseProject

``function projectsEqual``
--------------------------

.. CG-BLOCK id=function:projectsEqual lines=342-360

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 342-360
   :lineno-match:

.. CG-EXPLANATION-START id=function:projectsEqual

**What this does.** Compares two projects for the dirty check: the same object, or the same id with equal metadata fields. Database timestamps do not take part.

**Why it is here.** The list of fields that count lives in a shared util because crash recovery needs the same fields to carry the metadata draft. A drift-warning comment lists the three places that still enumerate those fields by hand and must be kept in step when a field is added.

.. CG-EXPLANATION-END id=function:projectsEqual

``function fullPatchFrom``
--------------------------

.. CG-BLOCK id=function:fullPatchFrom lines=361-399

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 361-399
   :lineno-match:

.. CG-EXPLANATION-START id=function:fullPatchFrom

**What this does.** Builds a complete patch from the live project — every field the editor can change — for the Save call.

**Why it is here.** It is easiest to re-send everything, and safe to do so because the backend ignores values that did not change. The return type is tied to the shared field list, so adding a field there without adding it here is a compile error — exactly what the old prose drift-warning could only ask for.

.. CG-EXPLANATION-END id=function:fullPatchFrom

``function restorePayloadFrom``
-------------------------------

.. CG-BLOCK id=function:restorePayloadFrom lines=400-430

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 400-430
   :lineno-match:

.. CG-EXPLANATION-START id=function:restorePayloadFrom

**What this does.** Builds the restore payload from a parsed ``.strix`` — the single place that lists every collection the file carries.

**Why it is here.** Both restore call sites go through here because they used to list the collections by hand and drifted: the recovery path listed seven arrays while the revert listed twelve, so a file opened after a database wipe came back with no bodies, no correlation edges, no formation absences and no body boundaries. A collection added to the file format is now added here once.

.. CG-EXPLANATION-END id=function:restorePayloadFrom

``const SAVE_ANCHOR_KEY``
-------------------------

.. CG-BLOCK id=const:SAVE_ANCHOR_KEY lines=431-447

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 431-447
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAVE_ANCHOR_KEY

**What this does.** The key under which the save anchor lives inside a project's view state: ``save_anchor``.

**Why it is here.** The anchor has to sit on the project row and inside the ``.strix`` at the same time, and the view state is the only durable project-scoped bag that already round-trips through both — so it needs no migration and no new column.

.. CG-EXPLANATION-END id=const:SAVE_ANCHOR_KEY

``function saveAnchorOf``
-------------------------

.. CG-BLOCK id=function:saveAnchorOf lines=448-454

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 448-454
   :lineno-match:

.. CG-EXPLANATION-START id=function:saveAnchorOf

**What this does.** Reads the save-anchor token out of a view-state bag, returning null when the slot is absent or holds something other than text.

**Why it is here.** One guarded read shared by the API row and the file, since both are treated as opaque here.

.. CG-EXPLANATION-END id=function:saveAnchorOf

``function saveAnchorOfFile``
-----------------------------

.. CG-BLOCK id=function:saveAnchorOfFile lines=455-471

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 455-471
   :lineno-match:

.. CG-EXPLANATION-START id=function:saveAnchorOfFile

**What this does.** Reads the save anchor from a parsed ``.strix`` file's embedded project block.

**Why it is here.** A thin wrapper so the file case reuses the same guarded read as the project row.

.. CG-EXPLANATION-END id=function:saveAnchorOfFile

``function mintSaveAnchor``
---------------------------

.. CG-BLOCK id=function:mintSaveAnchor lines=472-479

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 472-479
   :lineno-match:

.. CG-EXPLANATION-START id=function:mintSaveAnchor

**What this does.** Makes a fresh save-anchor token: a timestamp followed by a short random suffix.

**Why it is here.** It is time-ordered so the value is readable in a log or in the JSON, and random-suffixed so two saves in the same millisecond — or a save on a clock that stepped backwards — still produce different tokens. Only equality is ever tested; the ordering is a debugging convenience.

.. CG-EXPLANATION-END id=function:mintSaveAnchor

``function idsFromBundle``
--------------------------

.. CG-BLOCK id=function:idsFromBundle lines=480-485

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 480-485
   :lineno-match:

.. CG-EXPLANATION-START id=function:idsFromBundle

**What this does.** Pulls the text ``id`` out of each bundle row, dropping any row whose id is not text.

**Why it is here.** Defensive: the file format guarantees a text id, but the renderer treats bundle rows as opaque records, so the type system cannot rely on it here.

.. CG-EXPLANATION-END id=function:idsFromBundle

``function useProject``
-----------------------

.. CG-BLOCK id=function:useProject lines=486-1620

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useProject.ts
   :language: typescript
   :lines: 486-1620
   :lineno-match:

.. CG-EXPLANATION-START id=function:useProject

**What this does.** The hook itself. It keeps the live project, the saved snapshot and the file path in *state*; a *ref* holding the latest toast; the four manifest sets; the current and saved lumping plus the revision (kept in both state and a ref); and refs tracking whether the last save wrote the file and whether any save was attempted this session. An *effect* clears the projection caches whenever the active project id changes. The remainder defines the actions from the actions interface — open, save, restore, stage, close and the rest — each doing its API calls, file reads and writes, and manifest and lumping bookkeeping, and it derives the dirty flag by comparison rather than a manual flag.

**Why it is here.** The toast is held in a ref so the callbacks keep a stable identity — ``openProjectFile`` re-registers a File-menu listener whenever its identity changes, and the toast is a fresh closure on every redraw. The projection caches are cleared on a project change because they grow with every coordinate a project touches and this hook is the single owner of the project lifecycle (clearing is safe because projection is pure and simply recomputes). The manifest sets are in-memory only so a hard kill loses unsaved imports by design. The lumping revision lives in both state (to redraw the recovery writer) and a ref (so ``stageLumping`` reads a fresh number and can never replay a revision the server already stored, which would earn a conflict error). The dirty flag is derived by comparing the live project against ``saved`` and the current lumping against ``savedLumping``, so the title asterisk and the unsaved-changes guard stay in step with the save/discard model without any manual true/false juggling.

.. CG-EXPLANATION-END id=function:useProject

