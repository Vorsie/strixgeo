desktop.renderer.src.shell.stages.sections.useGeotechBoreholePreview
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts
   :language: typescript
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook that fetches the 'Divide boreholes' dry run — the plan a borehole would get — and feeds the ghost bands drawn on the geotech axis.

**Why it is here.** 'Subdivide all bodies' writes CPT bands only and defers every borehole-mediated edge to 'Divide boreholes', so a borehole column stays blank until that verb runs — and running it rebuilds every borehole band. The engineer was being asked to commit blind (owner dogfeed 2026-08-04); this hook asks the server what the verb would do, using the same planner the verb runs. A failed preview is surfaced loudly, because a silently-empty column reads as 'this borehole gets nothing' — a claim about geology this hook cannot make. The one silent case is 'Subdivide has not run yet', matched on a machine-readable code.

.. CG-EXPLANATION-END id=module-header

``const NO_GEOTECH_MODEL_CODE``
-------------------------------

.. CG-BLOCK id=const:NO_GEOTECH_MODEL_CODE lines=54-56

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts
   :language: typescript
   :lines: 54-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_GEOTECH_MODEL_CODE

**What this does.** The server code meaning 'the geotech model does not exist yet'.

**Why it is here.** Matched verbatim against the backend constant so the hook can tell 'Subdivide has not run' apart from a real failure and stay silent for it.

.. CG-EXPLANATION-END id=const:NO_GEOTECH_MODEL_CODE

``interface GeotechBoreholePreview``
------------------------------------

.. CG-BLOCK id=interface:GeotechBoreholePreview lines=57-70

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts
   :language: typescript
   :lines: 57-70
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBoreholePreview

**What this does.** What the hook hands back: the per-borehole planned bands, a loading flag, a human error (or null), and the counts of accepted borehole ties a commit would carry versus lose.

**Why it is here.** The engineer needs to see, before committing, both what the boreholes would get and which of their existing correlations the divide could not carry across.

.. CG-EXPLANATION-END id=interface:GeotechBoreholePreview

``interface GeotechBoreholePreviewArgs``
----------------------------------------

.. CG-BLOCK id=interface:GeotechBoreholePreviewArgs lines=71-93

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts
   :language: typescript
   :lines: 71-93
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBoreholePreviewArgs

**What this does.** What the hook needs to decide whether and what to fetch: the project id, the LITHO model id (the endpoint takes the litho parent), whether a geotech model exists, whether the geotech axis is showing, a scalar refresh key, and the geo-litho snap tolerance.

**Why it is here.** The refresh key must be a scalar that moves ONCE per falsifying mutation, not the committed layer array: the bus clears that array to empty before every refetch, so keying on its identity ran the whole planner — TIN interpolation included — twice per mutation. The snap tolerance is a key too, because the planner divides the picks by geology with it.

.. CG-EXPLANATION-END id=interface:GeotechBoreholePreviewArgs

``const EMPTY``
---------------

.. CG-BLOCK id=const:EMPTY lines=94-114

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts
   :language: typescript
   :lines: 94-114
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY

**What this does.** The idle value the hook reports — no columns, not loading, no error, zero tie counts.

**Why it is here.** Also what a disabled hook reports, so a canvas off the geotech axis (or before a model exists) sees a clean empty rather than stale ghosts.

.. CG-EXPLANATION-END id=const:EMPTY

``function useGeotechBoreholePreview``
--------------------------------------

.. CG-BLOCK id=function:useGeotechBoreholePreview lines=115-180

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useGeotechBoreholePreview.ts
   :language: typescript
   :lines: 115-180
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechBoreholePreview

**What this does.** When active (geotech axis, a geotech model, project and litho model present) it fetches the preview, logs the counts, and stores the result; a cancelled request is ignored. On the one 'no geotech model yet' code it goes quietly idle; every other failure sets a human error the caller toasts.

**Why it is here.** The active gate keeps the endpoint from being hit before Subdivide has run (it 404s by design there). The cancel guard stops a late answer from overwriting a newer state. The silent-only-for-one-code rule is why the error path checks the structured code, not just the 404 status — a broken model reference also 404s, and swallowing that would leave an empty column that looks like an answer.

.. CG-EXPLANATION-END id=function:useGeotechBoreholePreview

