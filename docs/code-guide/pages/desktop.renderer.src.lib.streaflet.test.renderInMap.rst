desktop.renderer.src.lib.streaflet.test.renderInMap
===================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/test/renderInMap.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/test/renderInMap.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/test/renderInMap.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports a testing render helper, several React building blocks and element types, Leaflet under ``L``, and the shared map context. The comment documents the one function below: it renders streaflet children inside a real Leaflet map running under a fake in-memory browser, and hands back the map plus the usual test result.

**Why it is here.** This is a test-only helper, kept out of the shipped app. Its comment records the one gotcha it exists to solve: the fake browser used in tests has no real layout, so the map's box is given a fixed size on purpose — otherwise Leaflet's sizing maths would divide by zero.

.. CG-EXPLANATION-END id=module-header

``function renderInMap``
------------------------

.. CG-BLOCK id=function:renderInMap lines=14-32

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/test/renderInMap.tsx
   :language: tsx
   :lines: 14-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:renderInMap

**What this does.** Sets up a tiny host component that, once mounted, creates a fixed-size page element, builds a real Leaflet map in it centred over Belgium, and then renders the test's children inside that map's context. It returns the created map together with the standard render result, and tears the map down when the test ends.

**Why it is here.** Tests for the map components need a genuine Leaflet map to attach to, not a stand-in, so this gives each test one in a controlled way and cleans it up afterwards. Building the map inside an effect and only rendering children once it exists mirrors how the real ``MapContainer`` behaves (see that page), so components are tested under the same conditions they run in.

.. CG-EXPLANATION-END id=function:renderInMap

