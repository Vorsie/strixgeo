desktop.renderer.src.hooks.useBodyRecompute
===========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useBodyRecompute.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useBodyRecompute.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports. The comment lays out what this file does and the exact rules it obeys; then it pulls in three React hooks — ``useCallback``, ``useEffect`` and ``useRef`` — plus the app's API client, a small helper that pulls the message out of a failed request, the shared logger, and the type that describes a recompute request. A hook is a helper whose name starts with ``use…`` that lets a piece of on-screen interface remember values between redraws and run side tasks; ``useRef`` holds a value that survives a redraw without causing one, ``useEffect`` runs a side task after a redraw, and ``useCallback`` caches a function so it stays the same object from one redraw to the next.

**Why it is here.** This file runs the background recompute of *body identity* — the app's decision about which pieces of the model belong to the same geological body (``docs/design/body-model.md``). The comment records the shape of the routine: every edit that can move a body's geometry (a tie edit, a geotech verb, a layer accept, a boundary save) asks for a recompute of that model, the request is sent to the engine only after a short quiet period, and a hard time-ceiling makes sure a long, unbroken editing burst still saves the result. The four rules in the comment — build the data at send time not at request time, keep only one request per model in flight, throw away answers that a newer edit has made stale, and log background failures to the console while only the manual button shows an error message — are what the code below enforces. The recompute is a request to the Python engine, never a direct write to the database: the frontend always goes through the API (CLAUDE.md).

.. CG-EXPLANATION-END id=module-header

``const BODY_RECOMPUTE_DEBOUNCE_MS``
------------------------------------

.. CG-BLOCK id=const:BODY_RECOMPUTE_DEBOUNCE_MS lines=28-30

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 28-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:BODY_RECOMPUTE_DEBOUNCE_MS

**What this does.** A fixed number, 2,500 milliseconds (two and a half seconds): the quiet period the scheduler waits after the last edit before it sends the recompute.

**Why it is here.** This is a *debounce* — a deliberate delay that folds a rapid burst of edits into a single action once the user pauses. Recomputing after every small change would flood the engine, so the recompute holds off until editing settles for two and a half seconds.

.. CG-EXPLANATION-END id=const:BODY_RECOMPUTE_DEBOUNCE_MS

``const BODY_RECOMPUTE_MAX_LATENCY_MS``
---------------------------------------

.. CG-BLOCK id=const:BODY_RECOMPUTE_MAX_LATENCY_MS lines=31-33

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 31-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:BODY_RECOMPUTE_MAX_LATENCY_MS

**What this does.** A fixed number, 15,000 milliseconds (fifteen seconds): the longest the recompute may be postponed while the user keeps editing without ever pausing.

**Why it is here.** The comment calls this the hard staleness ceiling. The debounce above restarts on every edit, so a user who never stops would postpone the recompute forever; this ceiling forces it to fire at least once every fifteen seconds, so a sustained editing burst still persists the body identity.

.. CG-EXPLANATION-END id=const:BODY_RECOMPUTE_MAX_LATENCY_MS

``interface UseBodyRecomputeOptions``
-------------------------------------

.. CG-BLOCK id=interface:UseBodyRecomputeOptions lines=34-54

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 34-54
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseBodyRecomputeOptions

**What this does.** Describes the inputs the scheduler needs: ``projectId`` (the open project's id, or null when no project is open); ``buildPayload``, a function that assembles the data to send for one model; ``dataLoaded``, a flag saying whether the model's inputs have finished loading; and ``toast``, the function that shows a small corner message. An interface is a note listing which fields a value carries, checked before the app runs and then gone.

**Why it is here.** The docstrings record two guards that shape the whole hook. First, ``buildPayload`` returning ``null`` means “nothing to send”, and that fire is skipped silently — the engine rejects an empty payload with an error, so the frontend never sends one. Second, while ``dataLoaded`` is false, building a payload from half-loaded state would describe a partial model, so no recompute is scheduled at all. ``projectId`` can be null because the hook stays mounted even when no project is open.

.. CG-EXPLANATION-END id=interface:UseBodyRecomputeOptions

``interface UseBodyRecomputeResult``
------------------------------------

.. CG-BLOCK id=interface:UseBodyRecomputeResult lines=55-62

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 55-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseBodyRecomputeResult

**What this does.** The two functions the hook hands back: ``scheduleRecompute``, the debounced entry point an edit calls; and ``recomputeNow``, an immediate fire used by the manual toolbar button.

**Why it is here.** Naming the return shape shows callers the two ways to trigger a recompute — the automatic, debounced one after edits, and the manual, immediate one on a button press.

.. CG-EXPLANATION-END id=interface:UseBodyRecomputeResult

``interface ModelTimers``
-------------------------

.. CG-BLOCK id=interface:ModelTimers lines=63-84

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 63-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ModelTimers

**What this does.** A small pair of timers kept for one model: ``debounce`` for the quiet-period delay and ``cap`` for the hard ceiling. Each is either a live timer or null when not armed.

**Why it is here.** Recomputes are tracked separately for each model, so every model needs its own debounce timer and its own ceiling timer; grouping the two in one small record keeps them together and easy to clear as a pair.

.. CG-EXPLANATION-END id=interface:ModelTimers

``function useBodyRecompute``
-----------------------------

.. CG-BLOCK id=function:useBodyRecompute lines=85-243

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBodyRecompute.ts
   :language: typescript
   :lines: 85-243
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBodyRecompute

**What this does.** The hook itself. It keeps several *refs* (a ref holds a value that survives redraws without causing one): ``optsRef`` mirrors the latest inputs, refreshed after every redraw by a small effect (code that runs after a redraw), so a timer armed seconds ago reads the CURRENT values when it fires; ``timersRef`` holds the per-model timer pairs; ``genRef`` holds a counter bumped on every request; ``inFlightRef`` tracks which models have a request in progress; ``pendingRefireRef`` tracks models that need one more run once the current one finishes; and ``mountedRef`` records whether the hook is still on screen. ``cancelTimers`` (a cached function) clears one model's timers. ``fire`` does the actual send: it cancels the timers, stops if the hook has left the screen, and if a request is already running for that model it just marks one re-fire as pending and returns; otherwise it checks a project is open and the inputs are loaded, asks ``buildPayload`` for the data, skips silently if that is null, then sends the request to the engine's recompute-bodies endpoint. When the answer returns it compares the counter: if a newer edit landed while the request was running, the answer describes a stale model and is thrown away; otherwise it logs the outcome and, when bodies actually merged, split or were renamed, shows a success message. A manual press always shows a message, even when nothing changed; failures log to the console, and a manual press also shows an error message. ``scheduleRecompute`` bumps the counter, arms the debounce timer, and arms the ceiling timer once per burst. ``recomputeNow`` bumps the counter and fires at once. A final effect clears every pending timer when the hook leaves the screen. The hook returns the two functions.

**Why it is here.** Every hook (``useRef``, ``useCallback``, ``useEffect``) is called at the top and in the same order on every redraw — React's *rules of hooks* forbid a hook below an early ``return``. Reading the inputs through ``optsRef`` at fire time is the central trick: a timer set two seconds ago must post the model as it is NOW, not as it was when scheduled. ``genRef`` is the supersede marker — comparing the counter before and after the request lets a stale answer be discarded, the success message included, because reporting “5 bodies merged” for a model the user has since changed would mislead. Keeping only one request per model in flight, with at most one queued re-fire behind it, stops the engine being hammered and keeps answers in order (the comment: mutations during a flight coalesce into that single re-fire). The ceiling timer is deliberately NOT restarted by later edits — a comment notes that restarting it would turn it back into a debounce and defeat the ceiling. The empty-payload error branch is treated as a bug signal: the null-assembly guard should have skipped that fire, so reaching it means the frontend and the engine disagree — logged as an error, never shown to the user. The manual-always-toasts behaviour is an owner ruling (2026-08-31, “yes always toast, when i click something”) while the background debounce stays change-gated to avoid alarm fatigue. The unmount cleanup cancels the timers, and ``mountedRef`` gates the pending re-fire so a request that resolves after the hook is gone does no harm.

.. CG-EXPLANATION-END id=function:useBodyRecompute

