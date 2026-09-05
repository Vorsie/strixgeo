desktop.renderer.src.hooks.useLithoSolids
=========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useLithoSolids.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useLithoSolids.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSolids.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports: four React hooks, the API client, three data types (the solid response, the build request, the gapless report), the logger, the translation helper, a shared applier for a build result, a build-failure message helper, and the streaming-build hook.

**Why it is here.** This hook owns the built 3-D body solids for the active litho model — the list itself, the Build trigger, and per-body colour editing — so the toolbar, the canvas and the inspector all read the same state without passing it down through props. The comment records one deliberate change from the earlier canvas version: solids are fetched whenever a litho model is active, NOT only in the solid 3-D view, so the toolbar stale badge and the inspector legend reflect reality no matter which 3-D view is showing; the read is cheap. The build-failure copy lives in its own module (on the ``desktop.renderer.src.hooks.buildFailureMessage`` page) so the streaming build path can share the grid-too-large formatter without an import cycle (debt #282).

.. CG-EXPLANATION-END id=module-header

``interface UseLithoSolidsResult``
----------------------------------

.. CG-BLOCK id=interface:UseLithoSolidsResult lines=34-155

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSolids.ts
   :language: typescript
   :lines: 34-155
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoSolidsResult

**What this does.** Describes everything the hook hands back: the solids list; loading and building flags; a flag for whether any solid has triangles and one for whether any is stale; two build functions (an immediate one and a streaming background-job one); a cancel for the streaming build and its live state; a per-body colour setter; a hide-markers flag and its toggle; and the gapless build report.

**Why it is here.** The docstrings record several decisions. The build POSTs the frontend's validated section partitions to the voxel build, assembled by the canvas and supplied as an async builder that returns null when there is nothing to build — there is no fallback build path, so a missing builder is a no-op with a “nothing to build” toast. The colour setter is optimistic (applied at once) with a debounced write to the engine 200 ms later. The gapless report is the seven-clause guarantee for the last build, and null is shown as “no verdict”, never as a pass — because the whole point of the gate is that an unmeasured guarantee is not a kept one.

.. CG-EXPLANATION-END id=interface:UseLithoSolidsResult

``function useLithoSolids``
---------------------------

.. CG-BLOCK id=function:useLithoSolids lines=156-432

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSolids.ts
   :language: typescript
   :lines: 156-432
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoSolids

**What this does.** The hook itself. It declares its state — the hide-markers flag, the solids list, loading, building, a refetch counter, and the gapless report — and starts the streaming-build hook from the ``desktop.renderer.src.hooks.useVoxelBuildStream`` page. An effect fetches the solids whenever the project, the model, the refetch counter, or an external refresh trigger changes. ``buildLithoSolids`` runs an immediate build: it asks the supplied builder for the payload, POSTs it to the engine, and applies the result through a shared applier that updates the solids, the gapless report and the toast. ``startLithoBuild`` does the same assembly but hands the request to the streaming build, and an effect applies the streamed outcome (done, cancelled, or error) identically. ``setBodyColor`` updates a body's colour on screen at once and writes it to the engine after a short debounce. It derives the has-solids and has-stale flags and returns everything.

**Why it is here.** The comment on the very first line records a rules-of-hooks and Temporal-Dead-Zone concern: the hide-markers state is declared BEFORE the effects and refs so the hook order is identical on every render path, including early returns in the consumers that wrap this hook — reading a binding before its declaration, or calling a hook below a return, crashes only at run time (CLAUDE.md). Two shadow refs mirror the live build state and the building flag so the build triggers can guard “already running” without listing that state in their trigger lists, which would re-identify the callbacks on every progress tick. The ``refreshOn`` trigger is load-bearing for the same reason as on the ``desktop.renderer.src.hooks.useGeotechLithoStaleness`` page: the engine stamps solids stale when their layers change, but the amber Build badge only sees it after a re-fetch, so a version counter that bumps on those writes ambers the badge without waiting for the next build. Every build, colour write and fetch goes through the API (CLAUDE.md); the colour debounce timer is cancelled on unmount so a late callback cannot fire against a gone hook.

.. CG-EXPLANATION-END id=function:useLithoSolids

