desktop.renderer.src.hooks.useRecoveryOffer
===========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useRecoveryOffer.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useRecoveryOffer.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryOffer.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports: four React hooks, the logger, two recovery-snapshot helpers (parse a stored payload; check whether it carries a database delta), and the snapshot type.

**Why it is here.** This hook detects a crash and offers to restore the unsaved work, in one place rather than in each open path. The comment records why it lives at the project level, keyed on the open project's id: crash detection has no heartbeat — a clean exit deletes the recovery file, so a file present when a project opens means the previous session crashed (docs/design/autosave-recovery.md). Putting the check in each of the four open paths would be four places to forget it. The hard rule is that a malformed payload must offer NOTHING: recovery protects an open project and may never break one, so every failure mode here — missing file, unparseable payload, an inter-process error — degrades to “no offer” plus a log line, never a thrown error.

.. CG-EXPLANATION-END id=module-header

``interface RecoveryOffer``
---------------------------

.. CG-BLOCK id=interface:RecoveryOffer lines=23-34

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryOffer.ts
   :language: typescript
   :lines: 23-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveryOffer

**What this does.** Describes a pending restore offer: the project id and name, the validated snapshot the prompt itemises and restore applies, and when the file was written for the age line.

**Why it is here.** Naming the offer shape gives the prompt exactly what it needs to describe the crashed work and, on Restore, apply it.

.. CG-EXPLANATION-END id=interface:RecoveryOffer

``interface UseRecoveryOfferOptions``
-------------------------------------

.. CG-BLOCK id=interface:UseRecoveryOfferOptions lines=35-76

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryOffer.ts
   :language: typescript
   :lines: 35-76
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseRecoveryOfferOptions

**What this does.** Describes the inputs: the open project's id and name, an ``onRestore`` callback, and three optional discard hooks — one to destroy residue that lives outside the backup, one that runs before a discard and can abort it, and one that runs after a successful discard.

**Why it is here.** The docstrings record owner rulings from 2026-08-03 about what “Delete backup” must mean: no traces, so the residue hook destroys the one item (the staged lumping map) that also lives outside the backup; and the crashed session never happened, so the before-discard hook reverts the database to the last save and can refuse — in which case the backup must survive, because it is then the only record of the session the user tried to erase. The revert is skipped when the snapshot records no database delta, because it would be a slow no-op (owner defect 2026-08-12).

.. CG-EXPLANATION-END id=interface:UseRecoveryOfferOptions

``interface UseRecoveryOfferResult``
------------------------------------

.. CG-BLOCK id=interface:UseRecoveryOfferResult lines=77-99

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryOffer.ts
   :language: typescript
   :lines: 77-99
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseRecoveryOfferResult

**What this does.** The offer plus the three answers the design allows: restore (apply and keep a copy, promoted to the primary slot), dismiss (open without restoring, keeping the copy in a declined slot for next time), and discard (delete the file — irreversible).

**Why it is here.** The three answers map to the design's three outcomes. Dismiss preserves the declined copy so a restart offers the same work again, while discard is the only one that destroys the backup — which is why it is the irreversible answer the prompt confirms (docs/ux.md).

.. CG-EXPLANATION-END id=interface:UseRecoveryOfferResult

``function useRecoveryOffer``
-----------------------------

.. CG-BLOCK id=function:useRecoveryOffer lines=100-404

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryOffer.ts
   :language: typescript
   :lines: 100-404
   :lineno-match:

.. CG-EXPLANATION-START id=function:useRecoveryOffer

**What this does.** The hook itself. It keeps the current offer as state and an answered-set in a ref, and mirrors the restore callback and project name into refs. An effect runs when a project opens: it reads the recovery file, and if one exists and its payload parses, it builds the offer (with the written-at time); any failure clears to no offer. ``restoreOffer`` applies the snapshot and promotes the kept copy into the primary slot so the restored state is protected again. ``dismissOffer`` preserves the copy in the declined slot. ``discardOffer`` runs the optional before-discard revert (unless there is no database delta), deletes the file, destroys the residue, and reloads the project. A claim-answer guard makes sure each project's offer is answered exactly once. It returns the offer and the three answers.

**Why it is here.** Reading through refs keeps the answer callbacks stable so they do not re-identify on every render. The claim-answer guard exists because the same offer could otherwise be answered twice. The whole design rests on docs/design/autosave-recovery.md: a crash loses no committed interpretation because the database outlives the window, so this offer is only about the small unsaved delta held in the recovery file — which is why a parse failure can safely degrade to no offer, and why the two non-destructive answers keep the file while only discard removes it. Every file operation is an inter-process call to the main process, and every failure is logged and swallowed rather than allowed to break the open.

.. CG-EXPLANATION-END id=function:useRecoveryOffer

