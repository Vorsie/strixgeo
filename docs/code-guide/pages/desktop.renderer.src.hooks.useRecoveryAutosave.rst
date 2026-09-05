desktop.renderer.src.hooks.useRecoveryAutosave
==============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useRecoveryAutosave.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useRecoveryAutosave.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports: three React hooks (``useCallback``, ``useEffect``, ``useRef``), the logger, the snapshot builder and its input type, and two equality helpers (for project metadata and for the stratigraphy-lumping map).

**Why it is here.** This hook decides WHEN the session's unsaved delta is written to a crash-recovery file on disk; its companion builds WHAT is written. The comment records the rules from docs/design/autosave-recovery.md: it uses both a debounce and a hard cap (a pure timer would rewrite an unchanged file forever; a pure debounce could be starved by continuous editing); a clean exit DELETES the file, because a file present at launch is the only crash signal — there is no heartbeat; the clear must cancel the pending timers first, or a late write would resurrect the file and cause a false recovery offer; and the whole scheduler is suspended while a recovery prompt is up, because the files on disk then belong to the crashed session, not this one. It is fire-and-forget: a write must never block a gesture, and a failed write is logged and dropped because the next change reschedules.

.. CG-EXPLANATION-END id=module-header

``const RECOVERY_DEBOUNCE_MS``
------------------------------

.. CG-BLOCK id=const:RECOVERY_DEBOUNCE_MS lines=49-51

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 49-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_DEBOUNCE_MS

**What this does.** A fixed 2,000 milliseconds (two seconds): the quiet period after the last change before the delta is written.

**Why it is here.** The same debounce idea as the body-recompute scheduler on the ``desktop.renderer.src.hooks.useBodyRecompute`` page — a rapid burst of edits collapses into one write once the user pauses.

.. CG-EXPLANATION-END id=const:RECOVERY_DEBOUNCE_MS

``const RECOVERY_MAX_LATENCY_MS``
---------------------------------

.. CG-BLOCK id=const:RECOVERY_MAX_LATENCY_MS lines=52-61

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 52-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:RECOVERY_MAX_LATENCY_MS

**What this does.** A fixed 15,000 milliseconds (fifteen seconds): the longest a write may be postponed while the user never pauses.

**Why it is here.** The docstring records that this cap bounds the worst-case data loss at fifteen seconds, so continuous editing cannot starve the write forever — the same debounce-plus-cap pair as the body-recompute scheduler.

.. CG-EXPLANATION-END id=const:RECOVERY_MAX_LATENCY_MS

``interface UseRecoveryAutosaveOptions``
----------------------------------------

.. CG-BLOCK id=interface:UseRecoveryAutosaveOptions lines=62-106

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 62-106
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseRecoveryAutosaveOptions

**What this does.** Describes everything the scheduler watches: the snapshot's own input set plus the last-saved lumping map, an optional ``canClearOnClean`` gate, and an optional ``suspended`` flag.

**Why it is here.** The docstrings record two subtle gates. ``canClearOnClean`` exists because the save path resets the session sets and the mutations flag even when the ``.strix`` file write itself failed, so without this gate the scheduler would delete the very recovery file the lifecycle deliberately kept; the caller passes the same file-write signal the lifecycle uses. ``suspended`` holds every write and clear while a recovery prompt is unanswered, because two races otherwise follow — a debounced write could overwrite the crashed copy with this session's thinner delta, or a decided exit could delete a crash copy the user never answered for.

.. CG-EXPLANATION-END id=interface:UseRecoveryAutosaveOptions

``interface UseRecoveryAutosaveResult``
---------------------------------------

.. CG-BLOCK id=interface:UseRecoveryAutosaveResult lines=107-130

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 107-130
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseRecoveryAutosaveResult

**What this does.** The one function the hook hands to the lifecycle: ``clearRecoveryNow``, which cancels every pending write and deletes this session's recovery file.

**Why it is here.** The docstring records that it is called on each decided exit — save, discard, clean close — because the file's existence is the crash signal, and it clears only the primary slot: a copy the user declined in an earlier session is not this session's to throw away (owner decision 2026-08-03).

.. CG-EXPLANATION-END id=interface:UseRecoveryAutosaveResult

``function hasStateAtRisk``
---------------------------

.. CG-BLOCK id=function:hasStateAtRisk lines=131-158

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 131-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:hasStateAtRisk

**What this does.** A helper that returns true when a crash right now would lose something: dirty project metadata, a changed lumping map, unsaved mutations, any open suggestion ghosts, or any not-yet-saved imported CPTs, boreholes, formations, sections or contacts.

**Why it is here.** The docstring records why it mirrors the app's own dirty sources rather than reusing the single ``projectDirty`` flag: the ghost workspace is at risk without being “dirty” in the save sense, because it never reaches the engine until Accept — so a crash would lose it even though nothing is unsaved on the server. It uses the same equality helpers the dirty flag uses so the comparison semantics cannot drift.

.. CG-EXPLANATION-END id=function:hasStateAtRisk

``function useRecoveryAutosave``
--------------------------------

.. CG-BLOCK id=function:useRecoveryAutosave lines=159-331

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useRecoveryAutosave.ts
   :language: typescript
   :lines: 159-331
   :lineno-match:

.. CG-EXPLANATION-START id=function:useRecoveryAutosave

**What this does.** The hook itself. It computes whether the session is at risk, mirrors the current values into a ref (so a timer armed earlier writes the CURRENT state, not the state captured when it was armed), and keeps the two timers plus a was-at-risk marker in refs. ``writeNow`` builds the snapshot and writes it to the main-process recovery store. An effect runs the schedule: while suspended it does nothing; when the session goes clean it cancels the timers and deletes the primary recovery file (gated on ``canClearOnClean``); when at risk it arms the debounce timer and, once per burst, the cap timer. ``clearRecoveryNow`` cancels the timers and deletes the primary file. It returns that one function.

**Why it is here.** This is the debounce-plus-cap pattern from the ``desktop.renderer.src.hooks.useBodyRecompute`` page applied to crash recovery: the current values are read through a ref at fire time, and the cap is armed once per burst and deliberately not reset by later changes, or it would turn back into a debounce. The whole design rests on the recovery contract in docs/design/autosave-recovery.md: a crash loses no committed interpretation because the database outlives the window and every gesture is already saved server-side — only a small unsaved session delta is at risk, and that delta is what this file writes to the ``.strix`` recovery store and deletes on a clean exit. The ``eslint-disable react-hooks/exhaustive-deps`` note explains why the watched values are not in the effect's trigger list: they are read through the ref inside the timer callbacks, so listing them would re-arm the debounce on every keystroke and defeat it.

.. CG-EXPLANATION-END id=function:useRecoveryAutosave

