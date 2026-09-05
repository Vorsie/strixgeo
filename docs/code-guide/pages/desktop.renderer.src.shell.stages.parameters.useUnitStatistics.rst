desktop.renderer.src.shell.stages.parameters.useUnitStatistics
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/useUnitStatistics.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/useUnitStatistics.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitStatistics.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the custom hook that fetches and computes one unit's distribution statistics. The comment notes that the arithmetic lives one level down in ``unitStatistics.ts`` and this hook owns only the fetching and the caching. The imports pull in React's hooks, the API client, the logger and the pure statistics functions. A custom hook is a ``use…`` function of the app's own that packages reusable stateful logic so several components can share it.

**Why it is here.** It was pulled out of ``ParametersInspector`` because that pane was already at the 500-line god-component gate (debt #201), and 'which holes does this unit stand on, are their series here yet, what is the spread' is a coherent piece with its own lifecycle.

.. CG-EXPLANATION-END id=module-header

``interface UseUnitStatisticsResult``
-------------------------------------

.. CG-BLOCK id=interface:UseUnitStatisticsResult lines=24-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitStatistics.ts
   :language: typescript
   :lines: 24-75
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseUnitStatisticsResult

**What this does.** The shape the hook hands back: the pooled statistics, a loading flag, an error string or null, a count of the unit's CPTs whose series still have not arrived, the sorted deduplicated list of CPT ids the pool stands on, and a retry function. The lines that follow document the hook itself.

**Why it is here.** The pending count exists so the panel can say the picture is incomplete rather than let a partial box read as the whole unit — the batch endpoint drops ids it has no series for instead of failing, so 'some holes never arrive' is a normal outcome, not an error. The pooled-id list is what the population header counts sections through: a section contributes when one of these holes is its member.

.. CG-EXPLANATION-END id=interface:UseUnitStatisticsResult

``function useUnitStatistics``
------------------------------

.. CG-BLOCK id=function:useUnitStatistics lines=76-186

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitStatistics.ts
   :language: typescript
   :lines: 76-186
   :lineno-match:

.. CG-EXPLANATION-START id=function:useUnitStatistics

**What this does.** The hook body. It narrows the scope's bands to their CPT-anchored, member-filtered subset, derives the sorted unique CPT ids and a stable string key from them, and keeps the fetched-series map, a loading flag, an error and a retry nonce in state. An effect fires whenever the id key, the project or the retry nonce changes: it consults the shared plot cache first, fetches only the missing series in one batch round-trip, and stores the result — cancelling cleanly if the inputs change mid-flight. It then assembles a per-CPT series map (cache first, freshly fetched second), computes the statistics from it, and returns them with the loading, error and incompleteness state.

**Why it is here.** It uses React hooks — ``useMemo`` to cache derived values, ``useState`` to remember values across redraws, ``useRef`` to hold the live plot cache without making it a dependency, and ``useEffect`` to run the fetch after render with a cleanup that cancels a stale request. The shared cache is read first so a hole the engineer already opened is never re-fetched. The fetch keys on the stable joined string, not the array itself, so a band edit that reshuffles the array without changing WHICH holes it names does not refire the request; holding the cache in a ref rather than a dependency keeps an unrelated CPT fetch from causing pure churn. One ``plot-batch`` round-trip serves the whole unit because a unit can span dozens of holes and a per-hole loop is exactly what the engineer should not wait through. The one lint suppression carries its written reason, per the house rule.

.. CG-EXPLANATION-END id=function:useUnitStatistics

