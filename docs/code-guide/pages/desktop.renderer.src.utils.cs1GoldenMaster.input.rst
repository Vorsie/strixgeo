desktop.renderer.src.utils.cs1GoldenMaster.input
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the loader for the committed CS1 scene — a frozen, anonymised real cross-section stored as a fixture (a fixture is a fixed piece of test data). It turns that fixture into exactly the inputs the two halves of the golden master consume.

**Why it is here.** The docstring records there is ONE loader used by both halves (the engine snapshot and the on-screen snapshot) so the two can never disagree because their inputs drifted apart — only because of a real regression. A golden master is a frozen reference output that later runs are compared against.

.. CG-EXPLANATION-END id=module-header

``interface FixtureColumn``
---------------------------

.. CG-BLOCK id=interface:FixtureColumn lines=17-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts
   :language: typescript
   :lines: 17-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FixtureColumn

**What this does.** One anonymised column exactly as the fixture file stores it: an investigation id, a surface elevation, and a list of units each with a layer id, top and base depth, soil and body.

**Why it is here.** It names the raw stored shape so the loader can read the fixture in a type-checked way before reshaping it into the engine's own column shape.

.. CG-EXPLANATION-END id=interface:FixtureColumn

``interface Cs1Scene``
----------------------

.. CG-BLOCK id=interface:Cs1Scene lines=30-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts
   :language: typescript
   :lines: 30-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Cs1Scene

**What this does.** Everything the CS1 scene provides in consumer-ready form: the litho columns and edges, the geotech columns and edges, the along-section metres, and four lookup maps — soil-and-class per geotech formation, soil per litho and per geotech formation, and NAD class per geotech formation.

**Why it is here.** The docstring flags the ``packingClassByFormationId`` map as the single translation point behind the owner's 2026-08-21 "one mass one body" rule: the one map is handed to both the fill (as its mass identity) and the render (as its dissolve identity), so the two agree on what counts as the same packing class. NAD refers to the Belgian annex NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=interface:Cs1Scene

``const toColumns``
-------------------

.. CG-BLOCK id=const:toColumns lines=50-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts
   :language: typescript
   :lines: 50-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:toColumns

**What this does.** A small converter that turns the fixture's stored columns into the engine's own column shape, copying each unit so nothing shared is mutated later.

**Why it is here.** The engine expects its own column shape, and copying the units keeps a later run from accidentally editing the loaded fixture in place.

.. CG-EXPLANATION-END id=const:toColumns

``const toEdges``
-----------------

.. CG-BLOCK id=const:toEdges lines=57-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts
   :language: typescript
   :lines: 57-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:toEdges

**What this does.** A small converter that turns the fixture's stored correlation records into the engine's edge shape, carrying each edge's two layer ids and its two contact sides.

**Why it is here.** The fixture stores the sides as plain strings; this narrows them to the top-or-base values the engine's edge shape expects.

.. CG-EXPLANATION-END id=const:toEdges

``function loadCs1Scene``
-------------------------

.. CG-BLOCK id=function:loadCs1Scene lines=72-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/input.ts
   :language: typescript
   :lines: 72-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadCs1Scene

**What this does.** Loads the frozen CS1 scene: it reads the fixture's NAD formation metadata and litho soils, builds the soil and class lookup maps, and returns a fresh scene each call — the columns, edges, along-metres and the four maps, including the packing-class map built from the NAD formations.

**Why it is here.** The docstring stresses the scene is built fresh each call and never shared or mutated, so one run of the gate cannot pollute another. Building the packing-class map here, once, is what keeps the fill and the render on the single mass identity the "one mass one body" rule requires.

.. CG-EXPLANATION-END id=function:loadCs1Scene

