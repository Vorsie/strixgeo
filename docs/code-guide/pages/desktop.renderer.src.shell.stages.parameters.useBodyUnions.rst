desktop.renderer.src.shell.stages.parameters.useBodyUnions
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/useBodyUnions.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/useBodyUnions.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useBodyUnions.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for a custom hook that fetches one geotech model's manual body unions — the "Join with…" pairs — from the engine, and imports React's effect and state hooks, the API client and the logger.

**Why it is here.** A custom hook is a ``use…`` function of the app's own that packages reusable stateful logic so several components share it. The comment records this was extracted on the SECOND copy of an identical fetch (the project rule: extract on the second copy) — it first lived inline in the geotechnical inspector, and the Parameters stage now needs the same list in two places (the unit list's "(group N)" tags and the statistics canvas's group pooling). A missing or failed list degrades to "no groups" rather than blocking the pane, so it logs a warning naming what was not found instead of raising a toast — the same contract the roster hook keeps.

.. CG-EXPLANATION-END id=module-header

``const EMPTY``
---------------

.. CG-BLOCK id=const:EMPTY lines=18-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useBodyUnions.ts
   :language: typescript
   :lines: 18-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY

**What this does.** A single shared empty list of body unions.

**Why it is here.** One frozen empty value is reused for every no-data case (nothing to fetch, a failed fetch), so the hook always hands back the same object rather than making a fresh empty array each render — which keeps anything that watches the result for changes from seeing a false change.

.. CG-EXPLANATION-END id=const:EMPTY

``function useBodyUnions``
--------------------------

.. CG-BLOCK id=function:useBodyUnions lines=40-72

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useBodyUnions.ts
   :language: typescript
   :lines: 40-72
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBodyUnions

**What this does.** The hook itself. Given a project id, a geotech model id, and a refetch key, it holds the union list in state, and after each render its effect fetches the model's unions from the engine — clearing to empty when either id is missing. It cancels a stale in-flight fetch when its inputs change, and on failure logs a warning and falls back to empty. It returns the current list.

**Why it is here.** An effect runs after the screen is drawn and its cleanup runs before the next run, which is how the ``cancelled`` flag discards a response that arrived after the engineer moved on. The refetch key is the geotech body-recompute nonce (a number that bumps on each recompute): a recompute can re-resolve which body an anchor belongs to and thus change a group's membership, so the list must re-fetch when it changes. Unions live on the geotech model only, so a null model id fetches nothing.

.. CG-EXPLANATION-END id=function:useBodyUnions

