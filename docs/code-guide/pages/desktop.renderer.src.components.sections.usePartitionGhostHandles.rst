desktop.renderer.src.components.sections.usePartitionGhostHandles
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook that runs the ghost-handle probe off the paint path and caches the result per topology, so it never freezes the section on a pan or zoom. A memo is a cached result that is only recomputed when its inputs change.

**Why it is here.** The docstring records the bug it replaces. The earlier version ran the 2.6-second probe inside a plain memo keyed on an object that rebuilt on every pan and zoom, so the app rubberbanded, with the browser logging a message handler that took over five seconds repeating. There are two fixes: a content key that ignores pan and zoom, and chunked work spread across idle time off the paint path.

.. CG-EXPLANATION-END id=module-header

``const PROBE_CHUNK``
---------------------

.. CG-BLOCK id=const:PROBE_CHUNK lines=47-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 47-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROBE_CHUNK

**What this does.** How many regions to probe per idle slice, two, when the browser gives no deadline.

**Why it is here.** The fallback timer path has no budget to size against, so it falls back to this fixed small slice.

.. CG-EXPLANATION-END id=const:PROBE_CHUNK

``const PROBE_BUDGET_FLOOR_MS``
-------------------------------

.. CG-BLOCK id=const:PROBE_BUDGET_FLOOR_MS lines=56-71

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 56-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:PROBE_BUDGET_FLOOR_MS

**What this does.** Stop taking another probe once the idle budget is down to four milliseconds.

**Why it is here.** A fixed slice of two ignored the deadline entirely: one probe is roughly eighteen to forty-seven milliseconds inside a budget that is never more than fifty, so a slice ran far over and dropped several frames. Sizing the slice by what is actually left gives a cheap section many probes per slice and an expensive one just a single probe, which is the most it can afford.

.. CG-EXPLANATION-END id=const:PROBE_BUDGET_FLOOR_MS

``function topologyKey``
------------------------

.. CG-BLOCK id=function:topologyKey lines=72-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 72-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:topologyKey

**What this does.** Builds a stable text key over only the pan-and-zoom-independent inputs: each column's investigation id, surface elevation and full unit stack, the approved edges with their sides, and the along-metres.

**Why it is here.** A pan or zoom changes only each column's screen X, never a unit, an edge, or an along value, so the key stays the same and the cached dead set is reused; the probe re-runs only on a real model, section, or correlation change.

.. CG-EXPLANATION-END id=function:topologyKey

``type IdleBudget``
-------------------

.. CG-BLOCK id=type:IdleBudget lines=97-103

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 97-103
   :lineno-match:

.. CG-EXPLANATION-START id=type:IdleBudget

**What this does.** The tiny shape the probe reads from a browser idle deadline: how much of this idle period is left.

**Why it is here.** It lets a slice size itself to the budget rather than to a fixed count.

.. CG-EXPLANATION-END id=type:IdleBudget

``function scheduleIdle``
-------------------------

.. CG-BLOCK id=function:scheduleIdle lines=104-133

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 104-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:scheduleIdle

**What this does.** Schedules a callback to run during the browser's idle time, falling back to a zero-delay timer where the idle-callback API is missing.

**Why it is here.** The fallback passes no deadline, which keeps the old fixed-slice behaviour there; the real idle path hands the deadline through so a slice can size itself to the budget.

.. CG-EXPLANATION-END id=function:scheduleIdle

``function usePartitionGhostHandles``
-------------------------------------

.. CG-BLOCK id=function:usePartitionGhostHandles lines=134-217

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePartitionGhostHandles.ts
   :language: typescript
   :lines: 134-217
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePartitionGhostHandles

**What this does.** Computes the current topology key, and when it changes it resets the dead set to empty and walks the shapeable regions a few per idle callback, accumulating the dead handles into state; a pan or zoom keeps the key so the resolved set is returned immediately with no recompute.

**Why it is here.** Resetting to empty means every handle renders for the first beat rather than causing a 2.6-second freeze, and the ghosts drop as the probe finishes. Each region's verdict is independent, so the chunk order cannot change the final set, which is byte-identical to the old synchronous result. The final memo exposes the dead set only once it matches the current key, so a stale in-flight topology never suppresses the wrong handles.

.. CG-EXPLANATION-END id=function:usePartitionGhostHandles

