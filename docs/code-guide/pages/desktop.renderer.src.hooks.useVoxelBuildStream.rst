desktop.renderer.src.hooks.useVoxelBuildStream
==============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useVoxelBuildStream.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useVoxelBuildStream.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and its imports: three React hooks (``useCallback``, ``useRef``, ``useState``), the build-response type, the two error-to-message helpers, the build-request type, the logger, and a shared grid-too-large message helper.

**Why it is here.** This hook runs the 3-D voxel build as a background job and reports its progress, so the Build button can show a phase bar and a Cancel button (debt #282). It uses the same two-step server-sent-events flow introduced on the ``desktop.renderer.src.hooks.useDovImportStream`` page — a POST spawns the job and returns a job id at once, then a GET streams the build's progress. The CPU-heavy phases run inside the engine under its per-process lock, so the window stays responsive and the build can be cancelled. The docstring records the key cancel design: pressing Cancel POSTs a stop request but deliberately KEEPS the stream open, so the engine's own terminal “cancelled” message still flows down and drives the final state.

.. CG-EXPLANATION-END id=module-header

``type VoxelBuildPhase``
------------------------

.. CG-BLOCK id=type:VoxelBuildPhase lines=42-45

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 42-45
   :lineno-match:

.. CG-EXPLANATION-START id=type:VoxelBuildPhase

**What this does.** Lists the four CPU phases the build reports, in order: label, reconcile, extract, persist.

**Why it is here.** Fixing the phase names lets the progress bar know which phases can occur, the same reason as the import phases on the ``desktop.renderer.src.hooks.useDovImportStream`` page.

.. CG-EXPLANATION-END id=type:VoxelBuildPhase

``const VOXEL_BUILD_PHASE_ORDER``
---------------------------------

.. CG-BLOCK id=const:VOXEL_BUILD_PHASE_ORDER lines=46-52

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 46-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:VOXEL_BUILD_PHASE_ORDER

**What this does.** The four phases listed in run order.

**Why it is here.** The step indicator uses this order to advance only forwards even if the engine fires a phase out of sequence — the same monotonic-advance pattern as the DOV import.

.. CG-EXPLANATION-END id=const:VOXEL_BUILD_PHASE_ORDER

``interface VoxelBuildProgressTick``
------------------------------------

.. CG-BLOCK id=interface:VoxelBuildProgressTick lines=53-58

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 53-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VoxelBuildProgressTick

**What this does.** One progress update: the phase, the number done, and the total.

**Why it is here.** The shape of a running-progress message, so the bar can show the phase and a done-of-total count.

.. CG-EXPLANATION-END id=interface:VoxelBuildProgressTick

``type VoxelBuildState``
------------------------

.. CG-BLOCK id=type:VoxelBuildState lines=59-73

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 59-73
   :lineno-match:

.. CG-EXPLANATION-START id=type:VoxelBuildState

**What this does.** The build lifecycle as one value that is exactly one of five tagged shapes: idle; running (the latest tick, the highest phase reached, and whether Cancel was pressed); done (carrying the build result); cancelled; or error (a message).

**Why it is here.** The same tagged-union pattern as the import state on the ``desktop.renderer.src.hooks.useDovImportStream`` page, with cancelled split out as its own outcome because a user cancel is not a failure — the model was left untouched — and the done shape carries the exact response the synchronous build returned, so the caller refreshes identically.

.. CG-EXPLANATION-END id=type:VoxelBuildState

``interface StartVoxelBuildOptions``
------------------------------------

.. CG-BLOCK id=interface:StartVoxelBuildOptions lines=74-79

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 74-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StartVoxelBuildOptions

**What this does.** The inputs to start a build: the project id, the model id, and the build request.

**Why it is here.** Bundling the three inputs gives ``start`` one tidy argument.

.. CG-EXPLANATION-END id=interface:StartVoxelBuildOptions

``interface UseVoxelBuildStreamResult``
---------------------------------------

.. CG-BLOCK id=interface:UseVoxelBuildStreamResult lines=80-90

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 80-90
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseVoxelBuildStreamResult

**What this does.** What the hook returns: the current ``state`` and three functions — ``start`` (spawn and stream), ``cancel`` (ask the build to stop while keeping the stream open), and ``reset`` (return to idle).

**Why it is here.** Naming the return shape gives the Build button the live state plus the three actions, with cancel and reset kept separate because they mean different things — stop this build versus clear the finished result.

.. CG-EXPLANATION-END id=interface:UseVoxelBuildStreamResult

``const BUILD_CANCELLED_CODE``
------------------------------

.. CG-BLOCK id=const:BUILD_CANCELLED_CODE lines=91-94

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 91-94
   :lineno-match:

.. CG-EXPLANATION-START id=const:BUILD_CANCELLED_CODE

**What this does.** The exact error code the engine sends to mean “the user cancelled”, not “it broke”.

**Why it is here.** Naming it once lets the read loop tell a deliberate cancel apart from a real failure and route it to the cancelled state instead of the error state.

.. CG-EXPLANATION-END id=const:BUILD_CANCELLED_CODE

``const API_BASE``
------------------

.. CG-BLOCK id=const:API_BASE lines=95-105

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 95-105
   :lineno-match:

.. CG-EXPLANATION-START id=const:API_BASE

**What this does.** The engine's fixed local web address on this machine.

**Why it is here.** The comment notes it is the same address the DOV import hook uses; both replicate it because the API client's internal base address is not exported for direct reuse.

.. CG-EXPLANATION-END id=const:API_BASE

``function useVoxelBuildStream``
--------------------------------

.. CG-BLOCK id=function:useVoxelBuildStream lines=106-297

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useVoxelBuildStream.ts
   :language: typescript
   :lines: 106-297
   :lineno-match:

.. CG-EXPLANATION-START id=function:useVoxelBuildStream

**What this does.** The hook itself. It keeps the lifecycle state and holds three refs — the abort handle, the current job id, and the project/model scope. ``reset`` aborts any open stream and clears everything back to idle. ``cancel`` optimistically flips the running state to “cancelling”, then POSTs the stop request while leaving the stream open. ``start`` aborts any in-flight build, records the scope, sets the state to running, POSTs to spawn the job, opens the streaming GET, and reads its server-sent-event frames the same way the DOV import does: a “done” frame stores the result and finishes; an “error” frame becomes the cancelled state when it carries the cancel code, otherwise a readable error; and a progress frame updates the latest tick and highest phase. A stream that closes with no terminal frame is treated as an error, and a deliberate abort returns quietly. The hook returns the state and the three functions.

**Why it is here.** The job id and scope live in refs (values that survive redraws without causing one) so the cancel path can reach the running job without re-identifying the callbacks. A failed cancel POST is non-fatal on purpose — the build keeps running and the user can press Cancel again — which is why keeping the stream open matters: the engine's cooperative stop still produces the terminal cancelled frame that drives the final transition. A grid-too-large refusal is formatted with the SAME helper the synchronous build uses, so the user sees identical, actionable wording (retry spacing plus “model unchanged”) on both paths (debt #282). Every request is to the local engine over the API (CLAUDE.md). The frame-parsing, buffering and abort-versus-failure handling all follow the pattern documented on the ``desktop.renderer.src.hooks.useDovImportStream`` page.

.. CG-EXPLANATION-END id=function:useVoxelBuildStream

