desktop.renderer.src.utils.recoveryReconcile
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/recoveryReconcile.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/recoveryReconcile.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryReconcile.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file decides what a restore does with one piece of a recovery file — the manual lumping map — which is the only item that could have been written in two places at once. The imports bring in the lumping type and an equality test for two maps.

**Why it is here.** The comment records the reasoning: the other five at-risk items have no home in the database, so the recovery file is their only copy and restoring them is a plain assignment. The lumping map is different — it lives both in the project's staged slot and in the recovery file, so two writers need one rule. That rule is by REVISION number, never the wall clock (docs/design/autosave-recovery.md §3), because a clock comparison fails three ways: the project's updated-time moves for unrelated reasons, the recovery file legitimately lags by up to 15 seconds, and a clock shift (daylight saving, a time sync, a resumed virtual machine) would silently flip the comparison. It is pure — the caller decides what to log and what to do.

.. CG-EXPLANATION-END id=module-header

``interface LumpingSide``
-------------------------

.. CG-BLOCK id=interface:LumpingSide lines=23-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryReconcile.ts
   :language: typescript
   :lines: 23-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LumpingSide

**What this does.** A declared shape for one copy of the lumping map plus the counter that dates it: the map itself (which may be empty) and a revision number (which may be missing).

**Why it is here.** The comment records what a missing revision means — no revision-aware build has ever staged this project — and that such a side must lose to any real revision and tie only with another missing one.

.. CG-EXPLANATION-END id=interface:LumpingSide

``type LumpingReconciliation``
------------------------------

.. CG-BLOCK id=type:LumpingReconciliation lines=35-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryReconcile.ts
   :language: typescript
   :lines: 35-65
   :lineno-match:

.. CG-EXPLANATION-START id=type:LumpingReconciliation

**What this does.** The set of things a restore can decide to do: skip (the two copies agree), replay-file (re-stage the file's map at its own revision), or prefer-database (leave everything alone), the last carrying a flag for the buggy case. The block ends with the documentation for the ranking helper below.

**Why it is here.** The comment records each outcome: skip is the common case; replay-file handles a staged save that never landed, re-staging at the file's own revision rather than a fresh bump; prefer-database is when the database is authoritative; and the conflict flag marks the equal-revision-but-different-content row, which is a bug the caller logs at error level rather than an ordinary "the database is simply newer".

.. CG-EXPLANATION-END id=type:LumpingReconciliation

``function rank``
-----------------

.. CG-BLOCK id=function:rank lines=66-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryReconcile.ts
   :language: typescript
   :lines: 66-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:rank

**What this does.** Turns a revision into a comparable number, mapping a missing revision to negative infinity. The block ends with the documentation for the main decision function below.

**Why it is here.** The comment records why negative infinity rather than -1 or 0: a never-staged side has to lose to every real revision including a hypothetical zero, and two missing revisions have to compare equal so the tie falls through to the content check instead of reaching for a clock.

.. CG-EXPLANATION-END id=function:rank

``function reconcileLumping``
-----------------------------

.. CG-BLOCK id=function:reconcileLumping lines=79-113

.. literalinclude:: ../../../desktop/src/renderer/src/utils/recoveryReconcile.ts
   :language: typescript
   :lines: 79-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:reconcileLumping

**What this does.** The decision itself. It ranks both revisions: if the file's is higher it replays the file's map; if the database's is higher it prefers the database; if they are equal and the maps match it skips; and if they are equal but the maps differ it prefers the database and flags a conflict.

**Why it is here.** The docstring records that the "active" side is what the app holds after opening already resolved the database's staged slot against the project file, and that every outcome carries a human-readable reason for the log so the restore's choice is traceable.

.. CG-EXPLANATION-END id=function:reconcileLumping

