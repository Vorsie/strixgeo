desktop.renderer.src.utils.geotechHierarchicalFill.scene.test-helpers
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is a TEST-ONLY helper file — not part of the shipped product — holding four small tools every geotech-fill behavioural test uses: build a column from metre depths, draw a correlation tie, test whether a point lies inside a region, and read the class painted at a point. It imports the correlation-edge, column and region shapes.

**Why it is here.** The docstring records it was extracted once a fourth copy came due (three test files each carried its own), so the pins those tests hold now share one set of tools. It is deliberately named ``test-helpers`` so the test runner's file pattern does not collect it as a test itself. It is documented here honestly as test scaffolding, not runtime code.

.. CG-EXPLANATION-END id=module-header

``interface UnitSpec``
----------------------

.. CG-BLOCK id=interface:UnitSpec lines=20-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts
   :language: typescript
   :lines: 20-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitSpec

**What this does.** The data shape for one band of a test column: a layer id, a formation id, and its top and base in metres below the collar.

**Why it is here.** It is the terse description a test writes a synthetic column's bands in — test scaffolding only.

.. CG-EXPLANATION-END id=interface:UnitSpec

``function column``
-------------------

.. CG-BLOCK id=function:column lines=35-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts
   :language: typescript
   :lines: 35-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:column

**What this does.** Builds a partition column the fill engines accept from an id, a collar elevation, and a list of unit specs given in metres below the collar.

**Why it is here.** It saves every test from spelling out the full column shape by hand, keeping the scenes readable — test scaffolding only.

.. CG-EXPLANATION-END id=function:column

``function tie``
----------------

.. CG-BLOCK id=function:tie lines=57-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts
   :language: typescript
   :lines: 57-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:tie

**What this does.** Builds one correlation edge between two layers, defaulting both ends to the top contact — the side most scene ties use.

**Why it is here.** Most test ties are top-to-top, so the defaults keep the common case to two arguments while still allowing base ties — test scaffolding only.

.. CG-EXPLANATION-END id=function:tie

``function inRegion``
---------------------

.. CG-BLOCK id=function:inRegion lines=67-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts
   :language: typescript
   :lines: 67-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:inRegion

**What this does.** Tests whether a fraction-and-elevation point lies inside a region's outline, by the even-odd ray-cast rule.

**Why it is here.** The behavioural tests assert what is painted where, so they need a plain inside/outside test against a region — test scaffolding only.

.. CG-EXPLANATION-END id=function:inRegion

``function paintAt``
--------------------

.. CG-BLOCK id=function:paintAt lines=91-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/scene.test-helpers.ts
   :language: typescript
   :lines: 91-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:paintAt

**What this does.** Returns the LAST region of one gap that contains a sample point — the region the render would paint there, given its draw order — or nothing.

**Why it is here.** It reproduces the render's own z-order (later regions paint over earlier ones) so a test reads the same class the engineer would see on screen — test scaffolding only.

.. CG-EXPLANATION-END id=function:paintAt

