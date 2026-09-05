desktop.renderer.src.test.fixtures.borehole
===========================================

.. CG-PAGE source=desktop/src/renderer/src/test/fixtures/borehole.ts complete=true

*Source file:* ``desktop/src/renderer/src/test/fixtures/borehole.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/test/fixtures/borehole.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports and the opening comment. It imports three response shapes from the API client (the borehole detail, an observation, and a sample). The comment describes the fixture: a made-up but representative DOV borehole for tests on the BoreholeLog view — 3 drill segments, 2 field-log streams, 1 main lithology observation with 3 layers, and 2 samples (one carrying a grain-size distribution plus Atterberg limits, one carrying a scalar lab test). It notes the numbers are arbitrary but internally consistent (depths within the total depth, contiguous layers, samples inside their parent depth range).

**Why it is here.** So the automated tests run offline and deterministically. A *test fixture* is a fixed, made-up piece of data a test runs against so its result is repeatable. Using a hand-built borehole means the BoreholeLog tests never depend on the live DOV service or a real database; borrowing the real API response shapes keeps the fixture honest against what the app actually receives.

.. CG-EXPLANATION-END id=module-header

``function makeFixtureBorehole``
--------------------------------

.. CG-BLOCK id=function:makeFixtureBorehole lines=14-180

.. literalinclude:: ../../../desktop/src/renderer/src/test/fixtures/borehole.ts
   :language: typescript
   :lines: 14-180
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeFixtureBorehole

**What this does.** Builds and returns the whole fixture borehole. It assembles three contiguous lithology layers (fine sand with a trace of clay, plastic clay, and gravel — the gravel layer deliberately given a null colour and null description to exercise the empty cases), wraps them in a coded-lithology observation whose type is chosen to match what BoreholeLog treats as lithology (so soil-code badges and admixture chips render, not the plain-text fallback), and two samples: sample A with a grain-size distribution and an Atterberg-limits test, sample B with a single scalar lab test (an ASTM soil-group code). It then returns the full borehole record — identity, location in Belgian Lambert 72 (EPSG 31370) with an elevation, drilling metadata, water table, three drill segments, four field-log intervals (colour and moisture streams), the observation, and the two samples.

**Why it is here.** The comments record the two deliberate choices. The observation type is set to match BoreholeLog's lithology types so the badge-and-chip rendering path is exercised rather than the text-card fallback. The field-log ``kind`` values are the English tokens the FieldLogTrack expects, because the Dutch DOV source tokens are translated upstream of the API response — translate-at-the-presentation-boundary — while the raw Dutch soil and admixture tokens (``ZF``, ``KL``, ``ZG``, ``sporadisch``, ``roerend``) are kept as the domain stores them. EPSG 31370 is Belgian Lambert 72, the project's working coordinate system. Two differently-shaped samples give the tests both a rich ``has lab tests`` case and a simpler one to render.

.. CG-EXPLANATION-END id=function:makeFixtureBorehole

``function makeFixtureBoreholeWithAdmixtures``
----------------------------------------------

.. CG-BLOCK id=function:makeFixtureBoreholeWithAdmixtures lines=181-198

.. literalinclude:: ../../../desktop/src/renderer/src/test/fixtures/borehole.ts
   :language: typescript
   :lines: 181-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeFixtureBoreholeWithAdmixtures

**What this does.** Builds a fixture whose first layer's admixtures list is replaced by whatever list the test passes in, leaving everything else the same.

**Why it is here.** The docstring says it lets a test target the admixture-rendering surface without rebuilding the rest of the borehole.

.. CG-EXPLANATION-END id=function:makeFixtureBoreholeWithAdmixtures

``function makeFixtureBoreholeWithEmptySample``
-----------------------------------------------

.. CG-BLOCK id=function:makeFixtureBoreholeWithEmptySample lines=199-215

.. literalinclude:: ../../../desktop/src/renderer/src/test/fixtures/borehole.ts
   :language: typescript
   :lines: 199-215
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeFixtureBoreholeWithEmptySample

**What this does.** Builds a fixture where the first sample has every kind of lab test emptied out.

**Why it is here.** The docstring says it lets a test target the ``no tests`` fallback rendering in the samples track.

.. CG-EXPLANATION-END id=function:makeFixtureBoreholeWithEmptySample

