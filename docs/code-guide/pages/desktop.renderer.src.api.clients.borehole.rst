desktop.renderer.src.api.clients.borehole
=========================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/borehole.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/borehole.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the borehole client — the typed calls for the ``/borehole/*`` endpoints (list, detail, batch-detail, elevation edit, DOV import) with all their data shapes co-located.

**Why it is here.** Each subject keeps its own client; this one owns everything borehole and lab. Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page.

.. CG-EXPLANATION-END id=module-header

``type BoreholeAxis``
---------------------

.. CG-BLOCK id=type:BoreholeAxis lines=22-24

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 22-24
   :lineno-match:

.. CG-EXPLANATION-START id=type:BoreholeAxis

**What this does.** Names the two fields a user can filter boreholes by: drilling method or borehole type.

**Why it is here.** The docstring says it is lifted to a shared type so the map's layer control and the sidebar agree on which axis is active.

.. CG-EXPLANATION-END id=type:BoreholeAxis

``interface BoreholeListItem``
------------------------------

.. CG-BLOCK id=interface:BoreholeListItem lines=25-46

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 25-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeListItem

**What this does.** Describes one summary row in the borehole list: identity, location, coordinate system, elevation and its source, drilling method and type, total depth, start date, and the segment and field-log counts.

**Why it is here.** The "or null" fields are optional by design (additive-only API). The comment notes the elevation source is a raw provenance token mirrored from the backend so the sidebar badge stays in sync — store raw, translate at the boundary.

.. CG-EXPLANATION-END id=interface:BoreholeListItem

``interface AdmixtureResponse``
-------------------------------

.. CG-BLOCK id=interface:AdmixtureResponse lines=47-53

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 47-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AdmixtureResponse

**What this does.** Describes one admixture inside an observation layer: its soil code, how much, and whether it is only local.

**Why it is here.** The soil code is a raw upstream token carried through unchanged, translated only when shown; the shape mirrors the backend schema.

.. CG-EXPLANATION-END id=interface:AdmixtureResponse

``interface ObservationLayerResponse``
--------------------------------------

.. CG-BLOCK id=interface:ObservationLayerResponse lines=54-65

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 54-65
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ObservationLayerResponse

**What this does.** Describes one lithology interval in a visual borehole log: its top and base, colour, main soil codes, description, order index, and its admixtures.

**Why it is here.** It mirrors the backend schema so the borehole log draws exactly what the parser recorded; the soil codes stay raw for translation at the boundary.

.. CG-EXPLANATION-END id=interface:ObservationLayerResponse

``interface ObservationResponse``
---------------------------------

.. CG-BLOCK id=interface:ObservationResponse lines=66-77

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 66-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ObservationResponse

**What this does.** Describes one visual-log observation and its layers: type, author, date, reliability and score fields, and the list of intervals.

**Why it is here.** The reliability and score tokens are raw pass-through from DOV/GEF; grouping the layers under their observation matches how the log is drawn.

.. CG-EXPLANATION-END id=interface:ObservationResponse

``interface DrillSegmentResponse``
----------------------------------

.. CG-BLOCK id=interface:DrillSegmentResponse lines=78-85

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 78-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DrillSegmentResponse

**What this does.** Describes one drilling segment: its top, base and method.

**Why it is here.** Mirrors the backend schema; the method token stays raw for later translation.

.. CG-EXPLANATION-END id=interface:DrillSegmentResponse

``interface FieldLogIntervalResponse``
--------------------------------------

.. CG-BLOCK id=interface:FieldLogIntervalResponse lines=86-94

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 86-94
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FieldLogIntervalResponse

**What this does.** Describes one field-log interval — a water table, a casing note and the like: top, base, a kind, and an optional value.

**Why it is here.** Mirrors the backend schema so field observations render on the log; the value is nullable by design.

.. CG-EXPLANATION-END id=interface:FieldLogIntervalResponse

``interface GrainSizeResponse``
-------------------------------

.. CG-BLOCK id=interface:GrainSizeResponse lines=95-105

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 95-105
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GrainSizeResponse

**What this does.** Describes a grain-size distribution curve for one sample: the paired diameters and percent-larger arrays, the method, the test date, and whether lime or organics were removed.

**Why it is here.** The paired arrays are the curve as measured; the nullable flags are additive-by-design metadata.

.. CG-EXPLANATION-END id=interface:GrainSizeResponse

``interface AtterbergLimitsResponse``
-------------------------------------

.. CG-BLOCK id=interface:AtterbergLimitsResponse lines=106-115

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 106-115
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AtterbergLimitsResponse

**What this does.** Describes an Atterberg-limits result: liquid limit, plastic limit, a non-plastic flag, method and date.

**Why it is here.** The nullable values mirror a result that may record only some fields — additive-only shape.

.. CG-EXPLANATION-END id=interface:AtterbergLimitsResponse

``interface CaCO3ContentResponse``
----------------------------------

.. CG-BLOCK id=interface:CaCO3ContentResponse lines=116-123

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 116-123
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CaCO3ContentResponse

**What this does.** Describes a calcium-carbonate content test: the percentage, method and date.

**Why it is here.** Mirrors the backend schema; the percentage is nullable when not measured.

.. CG-EXPLANATION-END id=interface:CaCO3ContentResponse

``interface OrganicContentResponse``
------------------------------------

.. CG-BLOCK id=interface:OrganicContentResponse lines=124-132

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 124-132
   :lineno-match:

.. CG-EXPLANATION-START id=interface:OrganicContentResponse

**What this does.** Describes an organic-content test: carbon percent, matter percent, method and date.

**Why it is here.** Mirrors the backend schema; both percentages are nullable by design.

.. CG-EXPLANATION-END id=interface:OrganicContentResponse

``interface WaterContentResponse``
----------------------------------

.. CG-BLOCK id=interface:WaterContentResponse lines=133-146

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 133-146
   :lineno-match:

.. CG-EXPLANATION-START id=interface:WaterContentResponse

**What this does.** Describes a gravimetric water-content test: the percentage, method and date.

**Why it is here.** Mirrors the backend schema; the percentage is nullable when absent.

.. CG-EXPLANATION-END id=interface:WaterContentResponse

``interface ScalarLabTestResponse``
-----------------------------------

.. CG-BLOCK id=interface:ScalarLabTestResponse lines=147-159

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 147-159
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ScalarLabTestResponse

**What this does.** Describes the catch-all lab result for tests outside the five typed families: a parameter group and name, a numeric or a text value, unit, method, date and a detection condition.

**Why it is here.** The docstring records it as the catch-all family (grain density, ASTM class, descriptive calcareous content): numeric results land in the numeric field, non-numeric ones like the ASTM code "CL" in the text field — the ScalarLabTest catch-all lets a new scalar test be added without a new shape.

.. CG-EXPLANATION-END id=interface:ScalarLabTestResponse

``interface SampleResponse``
----------------------------

.. CG-BLOCK id=interface:SampleResponse lines=160-184

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 160-184
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SampleResponse

**What this does.** Describes a sample and every lab family attached to it: its depth range, description, sampling metadata, its geotech body and NAD class with the source of that assignment, and the six lists of lab tests.

**Why it is here.** The comments note the geotech fields are null until the borehole is subdivided or when it has no CPT within the body corridor — a provenance-stamped characterisation output, not a design parameter. Grouping the lab families under the sample matches how the detail panel reads them.

.. CG-EXPLANATION-END id=interface:SampleResponse

``interface BoreholeDetailResponse``
------------------------------------

.. CG-BLOCK id=interface:BoreholeDetailResponse lines=185-218

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 185-218
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoreholeDetailResponse

**What this does.** Describes the full borehole detail: identity and location, elevation and source, drilling and purpose metadata, total depth and water table, the counts, and the drill segments, field-log intervals, observations and samples.

**Why it is here.** It is the whole record the detail panel and the borehole log draw from; the nullable fields are additive-by-design and the provenance token is threaded to the elevation editor as raw text.

.. CG-EXPLANATION-END id=interface:BoreholeDetailResponse

``interface ElevationPatchBody``
--------------------------------

.. CG-BLOCK id=interface:ElevationPatchBody lines=219-228

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 219-228
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ElevationPatchBody

**What this does.** Describes the body sent when editing a borehole's surface elevation: the elevation value (or null to clear it) and an optional coordinate-system code.

**Why it is here.** The comment records that the backend accepts the same shape for CPT and borehole, that null returns the row to the "needs Z" state, and that the coordinate code is omitted today because the desktop shows no picker — the backend defaults to mTAW for DOV-Belgium data.

.. CG-EXPLANATION-END id=interface:ElevationPatchBody

``const boreholeClient``
------------------------

.. CG-BLOCK id=const:boreholeClient lines=229-281

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/borehole.ts
   :language: typescript
   :lines: 229-281
   :lineno-match:

.. CG-EXPLANATION-START id=const:boreholeClient

**What this does.** The object of typed calls for the ``/borehole/*`` endpoints: list the project's boreholes, fetch one borehole's full detail, fetch many at once, or edit an elevation. The batch call can be told which lab families to load.

**Why it is here.** Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page. The comments carry the discipline: a project id is required on every by-id call so a guessed id cannot leak a borehole from another project (the scope guard), and the batch fetch folds a dense corridor's per-borehole reads into one round-trip, letting a section view skip the six lab-family loads it does not draw.

.. CG-EXPLANATION-END id=const:boreholeClient

