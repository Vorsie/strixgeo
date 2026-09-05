desktop.renderer.src.hooks.useRecoveryRestore
=============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useRecoveryRestore.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useRecoveryRestore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryRestore.ts
   :language: typescript
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports: three React hooks, some TypeScript setter types, the project-update type, the logger, the lumping type, a lumping reconciler, a ghost decoder, the snapshot type, and two local types.

**Why it is here.** This hook is the restore half of crash recovery — what happens when the user answers “Restore unsaved work”; its companions decide what is written and when (the ``desktop.renderer.src.hooks.useRecoveryAutosave`` page). The comment records the design's rules from docs/design/autosave-recovery.md §2: five of the six at-risk items have no database home so restoring them is a straight assignment, but two of those have a non-obvious shape — the four manifest sets are UNIONED onto the file-seeded floor (the localStorage mirror is lossy, so the snapshot's copy is the complete one and must be added on top), while the five session-import sets are REPLACED (they were snapshotted at the same instant and must stay consistent, and merging could let a stale entry survive). The sixth item, the lumping map, is the only double-written one and so the only one that reconciles. The focused anchor is deliberately out of scope — it is a UI mode, not data a crash destroys.

.. CG-EXPLANATION-END id=module-header

``interface RecoveryRestoreDeps``
---------------------------------

.. CG-BLOCK id=interface:RecoveryRestoreDeps lines=48-73

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryRestore.ts
   :language: typescript
   :lines: 48-73
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryRestoreDeps

**What this does.** Describes everything the restore writes into: a setter for the ghost workspace, a metadata-draft applier, the union primitive for the manifests, five session-import setters, the dirty-bit setter, the current lumping map and its revision, and a stage-lumping function.

**Why it is here.** Naming each write target makes the six at-risk items explicit and pairs each with the exact primitive the design requires — a union for the manifests, a replace for the session imports, a reconcile for the lumping.

.. CG-EXPLANATION-END id=interface:RecoveryRestoreDeps

``interface UseRecoveryRestoreResult``
--------------------------------------

.. CG-BLOCK id=interface:UseRecoveryRestoreResult lines=74-93

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryRestore.ts
   :language: typescript
   :lines: 74-93
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseRecoveryRestoreResult

**What this does.** The one function the prompt calls on Restore: ``restoreFromSnapshot``, which applies a validated snapshot to the open project.

**Why it is here.** The docstring records that it resolves once the lumping reconciliation — the only step that can touch the network — has settled, while all the in-memory writes land at once before that.

.. CG-EXPLANATION-END id=interface:UseRecoveryRestoreResult

``function useRecoveryRestore``
-------------------------------

.. CG-BLOCK id=function:useRecoveryRestore lines=94-173

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryRestore.ts
   :language: typescript
   :lines: 94-173
   :lineno-match:

.. CG-EXPLANATION-START id=function:useRecoveryRestore

**What this does.** The hook itself. It mirrors its dependencies into a ref, then defines ``restoreFromSnapshot``: it decodes and installs the ghost workspace, applies the metadata draft (skipped when empty), unions the four manifests onto the current floor, replaces the five session-import sets, writes the dirty bit unconditionally, and finally reconciles the lumping map — replaying the file's version when its revision wins, preferring the database when the revisions tie but the contents differ (logged as a bug), and doing nothing when no reconciliation is needed. It returns that one function.

**Why it is here.** Reading the dependencies through a ref keeps the returned callback's identity stable, because the recovery prompt holds it across the whole offer and re-creating it on every unrelated render would churn the dialog's props for nothing. The rules encode the design precisely (docs/design/autosave-recovery.md): manifests unioned, session imports replaced, and the dirty bit written even when false — because inferring it would be a second source of truth for the one bit that stops a later Discard from wiping pre-crash work. The lumping reconcile lets the revision win, never the clock, and an equal-revision-different-content case is treated as a bug rather than an ordinary conflict, because no ordinary sequence of events produces it.

.. CG-EXPLANATION-END id=function:useRecoveryRestore

