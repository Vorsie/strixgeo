desktop.renderer.src.hooks.useDovImportStream
=============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useDovImportStream.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useDovImportStream.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and its imports. It brings in three React hooks — ``useCallback``, ``useRef``, ``useState`` — plus two helpers that turn an engine error code or detail into a readable message, and the logger.

**Why it is here.** This hook runs a DOV import and reports its progress live. It uses *server-sent events* (SSE): a single long-lived HTTP connection over which the engine keeps pushing small messages as the work proceeds — here, one per phase of the import — until it sends a final “done” or “error” message and closes. The docstring lays out the four stages the hook moves through: idle (no connection), running (the stream is open and carrying the latest phase), done (the terminal done message arrived with a result), and error (a failure or the terminal error message ended it). A caller uses ``start`` to begin an import and ``reset`` to return to idle so the dialog can be shown again.

.. CG-EXPLANATION-END id=module-header

``interface PendingPin``
------------------------

.. CG-BLOCK id=interface:PendingPin lines=43-50

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 43-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PendingPin

**What this does.** One provisional map marker sent in the “pins” message: its DOV key, its name, and its position as an X and Y in Belgian Lambert 72.

**Why it is here.** The docstring notes the coordinates are in Belgian Lambert 72 (EPSG:31370 — a projection names a specific coordinate system; EPSG:31370 is the Belgian one) and the map converts them to world latitude/longitude before drawing. These pins let the map show every discovered location right after the search, before any file has been downloaded.

.. CG-EXPLANATION-END id=interface:PendingPin

``type ImportPhase``
--------------------

.. CG-BLOCK id=type:ImportPhase lines=51-60

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 51-60
   :lineno-match:

.. CG-EXPLANATION-START id=type:ImportPhase

**What this does.** Lists the named phases the import moves through, from discovering records in DOV, through downloading and de-duplicating, to saving, attaching interpretations and samples, and committing.

**Why it is here.** A union type fixes the allowed phase names, so a stray or misspelled phase is caught before the app runs and the progress bar always knows which phases can occur.

.. CG-EXPLANATION-END id=type:ImportPhase

``const PHASE_LABELS``
----------------------

.. CG-BLOCK id=const:PHASE_LABELS lines=61-72

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 61-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:PHASE_LABELS

**What this does.** A lookup from each phase name to the human-readable sentence shown on the progress bar, such as “Downloading XMLs…” for the download phase.

**Why it is here.** Keeping the display wording in one table separates the internal phase names the engine sends from the text the user reads, so either can change without disturbing the other.

.. CG-EXPLANATION-END id=const:PHASE_LABELS

``const PHASE_ORDER``
---------------------

.. CG-BLOCK id=const:PHASE_ORDER lines=73-82

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 73-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:PHASE_ORDER

**What this does.** The phases listed in the order they normally run.

**Why it is here.** The comment records the point: the step indicator uses this order to decide which phase counts as “current”, so it advances steadily even when the engine happens to fire phases out of a strict sequence.

.. CG-EXPLANATION-END id=const:PHASE_ORDER

``interface ProgressTick``
--------------------------

.. CG-BLOCK id=interface:ProgressTick lines=83-88

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 83-88
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProgressTick

**What this does.** One progress update: which phase, how many items are done, and the total.

**Why it is here.** This is the shape of a running-progress message, so the progress bar can show both the phase and a done-of-total count.

.. CG-EXPLANATION-END id=interface:ProgressTick

``interface CptImportDonePayload``
----------------------------------

.. CG-BLOCK id=interface:CptImportDonePayload lines=89-95

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 89-95
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CptImportDonePayload

**What this does.** The result of a finished CPT import: how many were imported, how many were duplicates, how many failed, and the ids of the imported CPTs.

**Why it is here.** Naming the finished shape lets the dialog report a clear summary once the import completes.

.. CG-EXPLANATION-END id=interface:CptImportDonePayload

``interface BoreholeImportDonePayload``
---------------------------------------

.. CG-BLOCK id=interface:BoreholeImportDonePayload lines=96-129

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 96-129
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeImportDonePayload

**What this does.** The richer result of a finished borehole import: the imported / duplicate / failed counts and ids, plus attached-and-failed counts for interpretations, samples, and each kind of lab measurement.

**Why it is here.** The docstring flags one field especially: ``interpretations_wfs_gaps`` counts boreholes that DOV's index says HAVE descriptions which the per-stream layer then returned nothing for — not a failure but a case the engineer must see, because “Import complete” would otherwise read as “DOV has none” (audit 2026-08-02). It is optional so a result from an older engine that predates the field still parses — the additive-only rule (docs/api.md).

.. CG-EXPLANATION-END id=interface:BoreholeImportDonePayload

``type ImportDonePayload``
--------------------------

.. CG-BLOCK id=type:ImportDonePayload lines=130-131

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 130-131
   :lineno-match:

.. CG-EXPLANATION-START id=type:ImportDonePayload

**What this does.** Says a finished result is either the CPT shape or the borehole shape.

**Why it is here.** Combining the two done-shapes under one name lets the running state hold whichever kind of result the import produced.

.. CG-EXPLANATION-END id=type:ImportDonePayload

``type DovImportState``
-----------------------

.. CG-BLOCK id=type:DovImportState lines=132-160

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 132-160
   :lineno-match:

.. CG-EXPLANATION-START id=type:DovImportState

**What this does.** The whole import lifecycle as one value that is exactly one of four shapes, each tagged by a ``status`` field: idle; running (carrying the kind, the latest tick, the highest phase reached, and any pending pins); done (carrying the result); or error (carrying a message).

**Why it is here.** This is a tagged union — a value that is one of several shapes distinguished by a marker field — so the screen can switch on ``status`` and every shape carries exactly the data that stage needs and nothing else. The comments record that the highest-phase index makes the step indicator advance only forwards, and that the pending pins are cleared on “done” because the real investigation list refresh then repopulates the map.

.. CG-EXPLANATION-END id=type:DovImportState

``interface StartOptions``
--------------------------

.. CG-BLOCK id=interface:StartOptions lines=161-166

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 161-166
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StartOptions

**What this does.** The inputs to start an import: the kind (CPT or borehole), the map rectangle to search, and the project id.

**Why it is here.** Bundling the three inputs the caller supplies gives ``start`` one tidy argument.

.. CG-EXPLANATION-END id=interface:StartOptions

``interface UseDovImportStreamResult``
--------------------------------------

.. CG-BLOCK id=interface:UseDovImportStreamResult lines=167-183

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 167-183
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseDovImportStreamResult

**What this does.** What the hook hands back: the current ``state``, a ``start`` function, and a ``reset`` function.

**Why it is here.** Naming the return shape gives the dialog the live state to render and the two actions to drive the import.

.. CG-EXPLANATION-END id=interface:UseDovImportStreamResult

``function useDovImportStream``
-------------------------------

.. CG-BLOCK id=function:useDovImportStream lines=184-379

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useDovImportStream.ts
   :language: typescript
   :lines: 184-379
   :lineno-match:

.. CG-EXPLANATION-START id=function:useDovImportStream

**What this does.** The hook itself. It keeps the lifecycle state and holds an abort controller (a handle used to cancel an open connection) in a ref. ``reset`` aborts any open stream and returns to idle. ``start`` aborts any in-flight import, makes a fresh abort handle, sets the state to running, and then runs an asynchronous routine: it first POSTs to spawn a background import job (which replies at once with a job id), then opens the streaming GET connection for that job id, and reads the incoming bytes frame by frame. It reassembles server-sent-event frames across chunk boundaries, strips the ``data:`` prefix from each, and reads the JSON inside: a “done” frame stores the result and finishes; an “error” frame stores a readable message and finishes; a “pins” frame fills in the provisional map markers; and a progress frame updates the latest tick and the highest phase reached. If the stream closes without a terminal frame it is treated as an error, and a deliberate cancel returns quietly to idle rather than showing an error. The hook returns the state and the two functions.

**Why it is here.** The abort handle is kept in a ref (a value that survives redraws without causing one) so the cancel path always reaches the current connection without listing it as a trigger. The two-step spawn-then-connect design lets the POST return immediately with a job id while the engine works in the background and pushes progress over the GET stream. Frames must be reassembled because the bytes arrive in arbitrary chunks that can split a frame; an unparseable frame is logged and skipped rather than crashing the read. A deliberate cancel is told apart from a real failure by the abort marker, so starting a new import or resetting does not flash an error. The whole exchange is with the local engine over the API, the same rule as every other request (CLAUDE.md); the base address is the desktop's fixed local engine address.

.. CG-EXPLANATION-END id=function:useDovImportStream

