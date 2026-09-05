desktop.renderer.src.utils.recoverySnapshot
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/recoverySnapshot.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/recoverySnapshot.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the reader and writer for the crash-recovery file. It is the only place that knows how the six fragile session items are packed into the recovery file and unpacked out of it again. The imports bring in the project and suggestion types, the ghost-workspace types, a logger, the lumping types and its parser, and the shared metadata-field list.

**Why it is here.** The comment records the design (docs/design/autosave-recovery.md §2): a crash in Strix destroys no interpretation, because every gesture is an awaited engine call and the database outlives the window — it only destroys a small session delta of six items. Two constraints shape the packing. First, the recovery store accepts only plain JSON, and a Set or a Map silently turns into an empty object, so the ghost workspace (mostly Sets and Maps) would come back empty yet look restored; every such collection is therefore converted by hand. Second, the file comes back off disk, possibly written by a different build, so the reader treats it as untrusted: it checks field by field, returns nothing on any mismatch, and never throws — a bad recovery file must not take down the start screen.

.. CG-EXPLANATION-END id=module-header

``const RECOVERY_SNAPSHOT_VERSION``
-----------------------------------

.. CG-BLOCK id=const:RECOVERY_SNAPSHOT_VERSION lines=45-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_SNAPSHOT_VERSION

**What this does.** The version number of the recovery payload's shape: 1.

**Why it is here.** The comment records it is deliberately kept separate from the recovery file's envelope version and from the project-file version, because the three number the shape of three different things and change for different reasons.

.. CG-EXPLANATION-END id=const:RECOVERY_SNAPSHOT_VERSION

``interface SerialisedAnchorGhost``
-----------------------------------

.. CG-BLOCK id=interface:SerialisedAnchorGhost lines=48-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 48-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SerialisedAnchorGhost

**What this does.** The plain-JSON shape of one investigation's ghost workspace: its kind, the suggestions, the surface elevation, the accepted and rejected indices as lists, the edits as pairs, and an optional map of contact ids as pairs.

**Why it is here.** The comment records why the accepted and rejected sets and the edits map are stored as lists and pairs rather than as Sets and Maps: a Set or a Map would serialise to an empty object and the data would be lost.

.. CG-EXPLANATION-END id=interface:SerialisedAnchorGhost

``interface RecoverySnapshotV1``
--------------------------------

.. CG-BLOCK id=interface:RecoverySnapshotV1 lines=63-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 63-95
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoverySnapshotV1

**What this does.** The shape of all six at-risk items as they sit in the recovery file: the file path, the lumping map with its revision, the ghost workspaces by anchor, the metadata changes, the four manifest sets, the five session-import sets, and one boolean for whether the session made any unsaved change.

**Why it is here.** The comment records what each item protects — for example, the manifest sets record structure the last save does not carry, and the final boolean, if lost, would let a later Discard destroy real work.

.. CG-EXPLANATION-END id=interface:RecoverySnapshotV1

``interface RecoverySnapshotInputs``
------------------------------------

.. CG-BLOCK id=interface:RecoverySnapshotInputs lines=96-127

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 96-127
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoverySnapshotInputs

**What this does.** The shape of everything the encoder needs, taken straight off the live hooks: the file path, the live and last-saved project, the lumping map and its revision, the ghost workspaces, and the four manifest and five session-import id sets, plus the unsaved-change flag.

**Why it is here.** It gathers in one place all the live values the snapshot is built from, so the encoder has a single declared input.

.. CG-EXPLANATION-END id=interface:RecoverySnapshotInputs

``function stripInternalMarkers``
---------------------------------

.. CG-BLOCK id=function:stripInternalMarkers lines=128-138

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 128-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:stripInternalMarkers

**What this does.** Removes one internal marker from a layer edit and returns the rest.

**Why it is here.** The comment records that this marker is set only for the length of a single shared-boundary drag and is never persisted to the server; writing it into a recovery file would restore a session into the middle of a gesture that is long finished.

.. CG-EXPLANATION-END id=function:stripInternalMarkers

``function serialiseGhost``
---------------------------

.. CG-BLOCK id=function:serialiseGhost lines=139-163

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 139-163
   :lineno-match:

.. CG-EXPLANATION-START id=function:serialiseGhost

**What this does.** Flattens one investigation's live ghost workspace into the plain-JSON shape, turning every Set into a list and every Map into pairs, and stripping the internal marker from each edit.

**Why it is here.** It is the encode half of the ghost round-trip, doing the by-hand conversion the plain-JSON contract demands.

.. CG-EXPLANATION-END id=function:serialiseGhost

``function buildRecoverySnapshot``
----------------------------------

.. CG-BLOCK id=function:buildRecoverySnapshot lines=164-204

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 164-204
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildRecoverySnapshot

**What this does.** Packs the six at-risk items into the recovery payload: it copies the file path and unsaved-change flag, bundles the lumping map with its revision, flattens each ghost workspace, works out the metadata changes against the last-saved project, and turns every id set into a list.

**Why it is here.** The docstring records that the result is a plain-JSON snapshot ready to hand to the main process's write-recovery call.

.. CG-EXPLANATION-END id=function:buildRecoverySnapshot

``function ghostsFromSnapshot``
-------------------------------

.. CG-BLOCK id=function:ghostsFromSnapshot lines=205-232

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 205-232
   :lineno-match:

.. CG-EXPLANATION-START id=function:ghostsFromSnapshot

**What this does.** Rebuilds the live ghost workspaces from a parsed snapshot, turning the lists back into Sets and the pairs back into Maps.

**Why it is here.** The comment records that it is the exact mirror of the flatten step, kept in this same file so the pack and unpack halves can never drift apart in two different places.

.. CG-EXPLANATION-END id=function:ghostsFromSnapshot

``function asRecord``
---------------------

.. CG-BLOCK id=function:asRecord lines=233-238

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 233-238
   :lineno-match:

.. CG-EXPLANATION-START id=function:asRecord

**What this does.** Checks that an unknown value is a plain JSON object — not a list and not empty — and hands it back typed as one, or returns nothing.

**Why it is here.** It is the first guard of the untrusted-read half; everything below reads fields off a value only after this confirms it is really an object.

.. CG-EXPLANATION-END id=function:asRecord

``function asStringList``
-------------------------

.. CG-BLOCK id=function:asStringList lines=239-245

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 239-245
   :lineno-match:

.. CG-EXPLANATION-START id=function:asStringList

**What this does.** Checks that an unknown value is a list whose every entry is text, returning a copy or nothing.

**Why it is here.** It is a reusable validator for the many id lists the recovery file carries.

.. CG-EXPLANATION-END id=function:asStringList

``function asNumberList``
-------------------------

.. CG-BLOCK id=function:asNumberList lines=246-252

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 246-252
   :lineno-match:

.. CG-EXPLANATION-START id=function:asNumberList

**What this does.** Checks that an unknown value is a list whose every entry is a finite number, returning a copy or nothing.

**Why it is here.** It is a reusable validator for the accepted and rejected index lists.

.. CG-EXPLANATION-END id=function:asNumberList

``function asNumberKeyedEntries``
---------------------------------

.. CG-BLOCK id=function:asNumberKeyedEntries lines=253-271

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 253-271
   :lineno-match:

.. CG-EXPLANATION-START id=function:asNumberKeyedEntries

**What this does.** Checks that an unknown value is a list of two-item pairs whose first item is a finite number, returning the pairs or nothing.

**Why it is here.** It is the shape a serialised Map arrives in, so this validates a stored Map before it is rebuilt.

.. CG-EXPLANATION-END id=function:asNumberKeyedEntries

``function parseEdit``
----------------------

.. CG-BLOCK id=function:parseEdit lines=272-315

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 272-315
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseEdit

**What this does.** Checks one layer edit from disk: every field is optional, so each present field must be the right type, and the internal marker is dropped on read too. The block ends with the documentation for the geometry check below.

**Why it is here.** The comment records that validation is "present means right type" because every field is optional on the live type, and that the internal marker is stripped on read as well as write because a file from an older build may still carry it.

.. CG-EXPLANATION-END id=function:parseEdit

``function suggestionGeometryIsUsable``
---------------------------------------

.. CG-BLOCK id=function:suggestionGeometryIsUsable lines=316-338

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 316-338
   :lineno-match:

.. CG-EXPLANATION-START id=function:suggestionGeometryIsUsable

**What this does.** Reports whether one suggestion row is safe to hand to the ghost overlay, by checking it carries two finite depths. The block ends with the documentation for the ghost parser below.

**Why it is here.** The comment records that the rest of the suggestion is passed through unchecked on purpose, but the two depths are geometry the overlay divides by to place a band, so a corrupt depth would arrive as a NaN rectangle rather than a caught error; checking them here keeps the codec's refuse-don't-repair stance.

.. CG-EXPLANATION-END id=function:suggestionGeometryIsUsable

``function parseGhost``
-----------------------

.. CG-BLOCK id=function:parseGhost lines=339-394

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 339-394
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseGhost

**What this does.** Checks one investigation's serialised ghost workspace: the kind, the suggestions (shallowly, only their geometry), the surface elevation, the accepted and rejected lists and edits (strictly), and the optional contact-id map.

**Why it is here.** The comment records why the suggestions are checked only shallowly: they are the one part the design calls re-derivable (re-running the segmenter reproduces them), and fully re-checking a twelve-field data shape here would be a second copy the compiler could not keep in step. The two depths are the exception, and the parts that cannot be reproduced — the accepted and rejected indices, the edits, the accept bookkeeping — are checked strictly.

.. CG-EXPLANATION-END id=function:parseGhost

``function parseMetadataDraftPatch``
------------------------------------

.. CG-BLOCK id=function:parseMetadataDraftPatch lines=395-430

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 395-430
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseMetadataDraftPatch

**What this does.** Checks the metadata-changes part: a field this build does not know is skipped with a warning, while a known field of the wrong type is a fatal rejection.

**Why it is here.** The comment records the split: a recovery file from an older build carrying an unknown field should still return the other five at-risk items (version drift), but a known field of the wrong type is corruption, not drift.

.. CG-EXPLANATION-END id=function:parseMetadataDraftPatch

``function parseIdGroup``
-------------------------

.. CG-BLOCK id=function:parseIdGroup lines=431-445

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 431-445
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseIdGroup

**What this does.** Checks a group of id lists against an expected set of keys, returning the group or nothing. It uses a *generic type* so one function serves both the manifest group and the session-import group.

**Why it is here.** It is the shared validator for the two id-set groups, so their checking lives in one place rather than being written twice.

.. CG-EXPLANATION-END id=function:parseIdGroup

``const MANIFEST_KEYS``
-----------------------

.. CG-BLOCK id=const:MANIFEST_KEYS lines=446-446

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 446-446
   :lineno-match:

.. CG-EXPLANATION-START id=const:MANIFEST_KEYS

**What this does.** The four manifest keys: CPT, borehole, formation and section.

**Why it is here.** It fixes the exact set of keys the manifest group is checked against.

.. CG-EXPLANATION-END id=const:MANIFEST_KEYS

``const SESSION_IMPORT_KEYS``
-----------------------------

.. CG-BLOCK id=const:SESSION_IMPORT_KEYS lines=447-474

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 447-474
   :lineno-match:

.. CG-EXPLANATION-START id=const:SESSION_IMPORT_KEYS

**What this does.** The five session-import keys: CPT, borehole, formation, section and contact. The block ends with the documentation for the database-delta check below.

**Why it is here.** It fixes the exact set of keys the session-import group is checked against.

.. CG-EXPLANATION-END id=const:SESSION_IMPORT_KEYS

``function snapshotHasDbDelta``
-------------------------------

.. CG-BLOCK id=function:snapshotHasDbDelta lines=475-506

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 475-506
   :lineno-match:

.. CG-EXPLANATION-START id=function:snapshotHasDbDelta

**What this does.** Reports whether a snapshot records any work the crashed session left in the database. It answers false only when the unsaved-change flag is exactly false and every manifest and session-import list is empty; anything else — including a missing field — answers true.

**Why it is here.** The comment records that this powers the Discard fast path (owner defect 2026-08-12, "Delete backup holds the app busy for too long"): discarding normally re-reads the whole project file and replace-restores the entire tree, tens of seconds of blocked dialog, so when the snapshot proves the session never touched the database both steps are skipped. Session-created rows and non-empty manifests count as a change because the replace-restore is what removes them. The defensive default is deliberate: a snapshot missing any field counts as having a change, so the safe-but-slow revert is never skipped on absence of evidence.

.. CG-EXPLANATION-END id=function:snapshotHasDbDelta

``function parseRecoverySnapshot``
----------------------------------

.. CG-BLOCK id=function:parseRecoverySnapshot lines=507-567

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoverySnapshot.ts
   :language: typescript
   :lines: 507-567
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseRecoverySnapshot

**What this does.** Checks a whole recovery payload read back off disk. It walks every field — version, file path, lumping and its revision, each ghost, the metadata changes, the manifest and session-import groups, and the unsaved-change flag — refusing with a logged reason on the first mismatch, and rebuilds a clean object from the checked pieces.

**Why it is here.** The docstring records that it never throws — a corrupt or foreign file must degrade to "no recovery offer", not a broken start screen — and that every rejection logs its reason so a user-reported "it didn't offer to restore" is diagnosable from the console. It rebuilds the object rather than passing the input through so that no unchecked extra key can ride along into the restore path.

.. CG-EXPLANATION-END id=function:parseRecoverySnapshot

