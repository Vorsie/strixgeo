desktop.renderer.src.components.sections.geotechPreviewTestFixtures
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it holds the fixture builders for the geotech borehole packing-preview tests. A fixture is a hand-built stand-in for real data that a test feeds to the code under test. It imports the preview and layer types and the ``PlacedColumn`` shape.

**Why it is here.** The comment records the builders were extracted from a test file when it crossed the 500-line guardrail (debt #201), and that they live here so the overlay test and the toolbar-legend test describe the same world, and so the displaced-column shape has one definition — a fixture whose true and drawn positions agree silently would stop pinning the post-nudge geometry rule.

.. CG-EXPLANATION-END id=module-header

``const levelToScreen``
-----------------------

.. CG-BLOCK id=const:levelToScreen lines=13-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts
   :language: typescript
   :lines: 13-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:levelToScreen

**What this does.** An identity elevation-to-screen mapping where 1 metre equals 1 pixel, so depths read directly off the rendered output in tests.

**Why it is here.** The comment records it keeps the test arithmetic trivial, so a value read off the DOM maps straight back to a depth.

.. CG-EXPLANATION-END id=const:levelToScreen

``function boreholeColumn``
---------------------------

.. CG-BLOCK id=function:boreholeColumn lines=38-88

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts
   :language: typescript
   :lines: 38-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:boreholeColumn

**What this does.** Builds a placed borehole column fixture from an id, an along-section distance, a collar elevation, and an optional drawn position; the drawn position defaults to the along distance.

**Why it is here.** The docstring records that passing a drawn position different from the along distance produces a displaced column, which is the only shape that can catch an overlay reading the true or projected position instead of the drawn one — the section-view spacing modifier trap.

.. CG-EXPLANATION-END id=function:boreholeColumn

``function cptColumn``
----------------------

.. CG-BLOCK id=function:cptColumn lines=89-130

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts
   :language: typescript
   :lines: 89-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:cptColumn

**What this does.** Builds a placed CPT column fixture from an id and an along-section distance.

**Why it is here.** The docstring records a CPT is never ghosted, since only boreholes are left undivided, so its fixture needs no displaced variant.

.. CG-EXPLANATION-END id=function:cptColumn

``function previewColumn``
--------------------------

.. CG-BLOCK id=function:previewColumn lines=131-177

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts
   :language: typescript
   :lines: 131-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:previewColumn

**What this does.** Builds one borehole's planned bands as the preview endpoint reports them, defaulting the source and confidence to the CPT-interpolated, high-confidence case.

**Why it is here.** A fixture payload matching the preview response shape.

.. CG-EXPLANATION-END id=function:previewColumn

``function committedBand``
--------------------------

.. CG-BLOCK id=function:committedBand lines=178-192

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechPreviewTestFixtures.ts
   :language: typescript
   :lines: 178-192
   :lineno-match:

.. CG-EXPLANATION-START id=function:committedBand

**What this does.** Builds a committed geotech band fixture — the row that makes a borehole count as already divided.

**Why it is here.** A fixture row for the already-divided case.

.. CG-EXPLANATION-END id=function:committedBand

