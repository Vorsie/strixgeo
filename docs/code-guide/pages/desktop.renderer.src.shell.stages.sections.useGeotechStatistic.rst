desktop.renderer.src.shell.stages.sections.useGeotechStatistic
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechStatistic.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechStatistic.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechStatistic.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the state machine behind the geotech 'qc: <statistic>' picker — median, harmonic, and so on. It owns the two renderer-held pieces of statistic state (the server's answer held locally as a bridge, and the pre-model pending choice), their reconciliation, and the setter.

**Why it is here.** Extracted verbatim from ``SectionsToolbar`` (debt #201). The derived label and staleness flag come out of the hook so the toolbar reads them without carrying the machinery.

.. CG-EXPLANATION-END id=module-header

``interface UseGeotechStatisticDeps``
-------------------------------------

.. CG-BLOCK id=interface:UseGeotechStatisticDeps lines=18-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechStatistic.ts
   :language: typescript
   :lines: 18-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechStatisticDeps

**What this does.** What the hook needs: the project (holding the id the statistic write posts to), the active geotech model, and the mark-dirty and toast actions.

**Why it is here.** These are the inputs the setter fires against; bundling them keeps the dependency list explicit.

.. CG-EXPLANATION-END id=interface:UseGeotechStatisticDeps

``interface UseGeotechStatisticResult``
---------------------------------------

.. CG-BLOCK id=interface:UseGeotechStatisticResult lines=30-56

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechStatistic.ts
   :language: typescript
   :lines: 30-56
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechStatisticResult

**What this does.** What it returns: the statistic the next subdivide will classify with (or the one the bands on screen were built with), a stale flag, the pre-model pending choice, and the setter.

**Why it is here.** The toolbar renders the label and stale tag straight from these; the pending choice is handed to the first subdivide.

.. CG-EXPLANATION-END id=interface:UseGeotechStatisticResult

``function useGeotechStatistic``
--------------------------------

.. CG-BLOCK id=function:useGeotechStatistic lines=57-157

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechStatistic.ts
   :language: typescript
   :lines: 57-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechStatistic

**What this does.** Holds the server's statistic answer locally as a bridge and the pre-model pending choice separately, derives the displayed statistic (the pending choice before any model exists, otherwise the model's own value), derives whether the bands are stale (classified-with differs from chosen), and reconciles both pieces of local state to nothing once the refreshed model row agrees. The setter parks the choice before a model exists (no write) or posts it once one does.

**Why it is here.** The pre-model choice cannot be written anywhere — the column it lives in belongs to a row step 1 has not created yet — so it is held here and handed to the first subdivide, then dropped the moment a model exists so the label always reads what got built, not what was asked for. The local server answer is a BRIDGE not a cache: it covers the gap between the write and the next model refresh, then gets out of the way, because holding it past that point would pin the 're-run under X' tag on forever and invite a verb that wipes and rebuilds every band.

.. CG-EXPLANATION-END id=function:useGeotechStatistic

