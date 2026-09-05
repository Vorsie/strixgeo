desktop.renderer.src.hooks.useGeotechLithoStaleness
===================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useGeotechLithoStaleness.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useGeotechLithoStaleness.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeotechLithoStaleness.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation and its imports: four React hooks (``useCallback``, ``useEffect``, ``useMemo``, ``useState``), the API client, the stale-column type, and the logger.

**Why it is here.** This hook answers one question: which geotech columns are standing on litho layers that have since been edited (#266)? The docstring explains the stakes — packing bands are derived from the litho stack beneath them, so once a litho contact is dragged, every band in that column describes ground that is no longer there, silently, all the way into a client-facing export. The engine stamps each column with the litho it built the bands from and this hook asks which stamps no longer hold. The answer is worked out fresh on the engine on every read, so there is nothing here to clear or acknowledge — re-pressing a named column re-stamps it and the next read comes back quiet. It is its own hook rather than three more fields on the already-oversized ``useGeologicalModel`` (debt #201).

.. CG-EXPLANATION-END id=module-header

``interface UseGeotechLithoStalenessResult``
--------------------------------------------

.. CG-BLOCK id=interface:UseGeotechLithoStalenessResult lines=30-68

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeotechLithoStaleness.ts
   :language: typescript
   :lines: 30-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechLithoStalenessResult

**What this does.** Describes the answer: the stale columns (sorted by label), the set of their investigation ids, the stale count, the count of banded columns with no provenance record, a loading flag, and a refresh function.

**Why it is here.** The docstrings draw a careful line: an unstamped column is NOT stale, because unknown provenance is not evidence the ground moved — it is exposed separately so a future export guard can tell “verified current” from “cannot say”. The loading flag keeps the toolbar chip steady rather than flickering during a read.

.. CG-EXPLANATION-END id=interface:UseGeotechLithoStalenessResult

``function useGeotechLithoStaleness``
-------------------------------------

.. CG-BLOCK id=function:useGeotechLithoStaleness lines=69-144

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeotechLithoStaleness.ts
   :language: typescript
   :lines: 69-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechLithoStaleness

**What this does.** The hook itself. It keeps the stale columns, the unstamped count, a loading flag, and a refetch counter as state. An effect re-runs when the project, the model, the refetch counter, or an external refresh trigger changes: with no project or model it clears the results; otherwise it asks the engine for the staleness, warns when columns are stale, stores the results, and on failure logs and stays quiet. A cancel flag ignores an answer that arrives after the inputs changed. It derives the id set with ``useMemo`` and exposes a ``refresh`` that bumps the counter. It returns the six fields.

**Why it is here.** The docstring records why the ``refreshOn`` trigger is load-bearing: staleness only changes when litho or bands change, so without a re-read keyed to those writes the indicator would keep showing the answer from before the edit — the exact bug this hook exists to fix — and it participates by identity only, never read. A failed read deliberately clears rather than inventing a warning, because an amber indicator the engineer cannot clear is worse than none. The geotech model id is required (not the litho parent), because the engine route guards on kind and rejects anything else. The staleness is read from the engine over the API (CLAUDE.md), which is also why nothing needs to be invalidated locally — the engine recomputes it every time.

.. CG-EXPLANATION-END id=function:useGeotechLithoStaleness

