desktop.renderer.src.shell.stages.sections.useGeotechTieStatus
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook that tracks how much packing correlation is still outstanding — the pending, accepted and flagged tie counts, and a per-section breakdown of pending ties.

**Why it is here.** The four-step pipeline gates step 4 (Divide boreholes) on step 3: dividing off unreviewed proposals throws away the evidence an accepted tie would have supplied. A button that fails when pressed teaches nothing; a button disabled with '12 packing ties are still proposed' teaches the workflow. It reports 'not loaded' rather than a confident zero, because 'nothing pending' and 'we have not asked' must never look the same to a gate.

.. CG-EXPLANATION-END id=module-header

``interface GeotechTieStatus``
------------------------------

.. CG-BLOCK id=interface:GeotechTieStatus lines=24-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts
   :language: typescript
   :lines: 24-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechTieStatus

**What this does.** The counts the toolbar gates and labels on: pending, accepted, and flagged tie counts, an optional per-section pending breakdown, and a ``loaded`` flag saying whether these came from the server.

**Why it is here.** The per-section breakdown is optional (undefined when the server sent none) — a distinct state from 'every section is clear'. The ``loaded`` flag exists so a gate never reads the zeros underneath an unanswered request as 'nothing pending'.

.. CG-EXPLANATION-END id=interface:GeotechTieStatus

``const NOT_ASKED``
-------------------

.. CG-BLOCK id=const:NOT_ASKED lines=49-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts
   :language: typescript
   :lines: 49-57
   :lineno-match:

.. CG-EXPLANATION-START id=const:NOT_ASKED

**What this does.** The idle value: all counts zero, no breakdown, and ``loaded`` false.

**Why it is here.** This is the state before any request, during the first request, and after a failed one — deliberately marked not-loaded so a gate cannot mistake it for a clean model.

.. CG-EXPLANATION-END id=const:NOT_ASKED

``interface UseGeotechTieStatusResult``
---------------------------------------

.. CG-BLOCK id=interface:UseGeotechTieStatusResult lines=58-86

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts
   :language: typescript
   :lines: 58-86
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechTieStatusResult

**What this does.** What the hook returns: the latest status and a ``refresh`` function to re-fetch.

**Why it is here.** ``refresh`` is called after every verb that can create or consume a tie, which is what keeps the chip and the step-4 gate honest.

.. CG-EXPLANATION-END id=interface:UseGeotechTieStatusResult

``function useGeotechTieStatus``
--------------------------------

.. CG-BLOCK id=function:useGeotechTieStatus lines=87-138

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechTieStatus.ts
   :language: typescript
   :lines: 87-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechTieStatus

**What this does.** Fetches the tie-status endpoint for the active geotech model, ignores a late answer from a model the engineer has left (guarded by a ref recording which model was asked), and re-fetches whenever the caller's re-count trigger changes. On failure it reports the error but leaves the counts UNLOADED.

**Why it is here.** The endpoint takes the geotechnical model id, so the hook is inert until step 1 has created one. The re-count trigger is the geotech layer array — every per-tie accept or delete path refetches it, so its changed identity is the shared signal that re-counts here without cross-tree plumbing. Leaving the counts unloaded on failure makes the gate fall back to 'we do not know' rather than 'nothing is pending'.

.. CG-EXPLANATION-END id=function:useGeotechTieStatus

