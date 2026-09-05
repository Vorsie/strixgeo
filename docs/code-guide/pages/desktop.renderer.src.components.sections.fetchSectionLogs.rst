desktop.renderer.src.components.sections.fetchSectionLogs
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/fetchSectionLogs.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/fetchSectionLogs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/fetchSectionLogs.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it makes the CPT-plot and borehole-detail fetches the section panel makes when it opens, lifted out of the panel's data hook so the cross-section PDF sheet builder makes the exact same round-trips. A fetch here is an asynchronous request to the backend — it returns a Promise, a placeholder for a value that arrives later. It imports the API client and the response types.

**Why it is here.** The comment records this is an extract-on-the-second-copy: the sheet builder is the second caller of the same fetches. The fetches are split per kind so the data hook keeps its two independent effects byte-identical while the sheet builder takes the combined fetch in one await.

.. CG-EXPLANATION-END id=module-header

``const SECTION_LAB_INCLUDE``
-----------------------------

.. CG-BLOCK id=const:SECTION_LAB_INCLUDE lines=15-17

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/fetchSectionLogs.ts
   :language: typescript
   :lines: 15-17
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTION_LAB_INCLUDE

**What this does.** The three lab families the section's sample markers preview — grain size, organic, and scalar.

**Why it is here.** The comment records this as the #39 sample-marker preview set.

.. CG-EXPLANATION-END id=const:SECTION_LAB_INCLUDE

``function fetchCptPlots``
--------------------------

.. CG-BLOCK id=function:fetchCptPlots lines=18-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/fetchSectionLogs.ts
   :language: typescript
   :lines: 18-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetchCptPlots

**What this does.** Makes one plot-batch round-trip and returns a map from CPT id to its plot; an empty id list returns an empty map without a round-trip.

**Why it is here.** It is the single round-trip the two callers share for CPT plots.

.. CG-EXPLANATION-END id=function:fetchCptPlots

``function fetchBoreholeDetails``
---------------------------------

.. CG-BLOCK id=function:fetchBoreholeDetails lines=30-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/fetchSectionLogs.ts
   :language: typescript
   :lines: 30-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetchBoreholeDetails

**What this does.** Makes one detail-batch round-trip and returns a map from borehole id to its detail tree, requesting the three lab families; an empty id list returns an empty map without a round-trip.

**Why it is here.** It is the matching single round-trip for borehole details.

.. CG-EXPLANATION-END id=function:fetchBoreholeDetails

``function fetchSectionLogs``
-----------------------------

.. CG-BLOCK id=function:fetchSectionLogs lines=55-68

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/fetchSectionLogs.ts
   :language: typescript
   :lines: 55-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetchSectionLogs

**What this does.** Runs both column-log batches in parallel and returns the two maps keyed by investigation id.

**Why it is here.** It is the combined call the sheet builder takes in one await, so the sheet and the section panel make identical requests.

.. CG-EXPLANATION-END id=function:fetchSectionLogs

