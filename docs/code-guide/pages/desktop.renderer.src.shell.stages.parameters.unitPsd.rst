desktop.renderer.src.shell.stages.parameters.unitPsd
====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/unitPsd.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/unitPsd.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitPsd.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that pools grain-size (PSD, Dutch "korrelverdeling") curves from the borehole samples inside a unit's bands, and imports the borehole type, the shared curve-point builder, and the shared midpoint-in-band rule. A grain-size curve is the cumulative percent-passing distribution against particle diameter.

**Why it is here.** Owner ruling S5 (2026-08-27): "I'm missing all PSD's on one graph." Where the scatter module pools scalar values, this pools the CURVES the same samples carry — one cumulative distribution per grain-size test, built with the very maths the section's sample hover card draws with, so the two surfaces cannot disagree about a curve. Samples are pooled by the SAME midpoint-in-band rule as the scalar pool (imported, not copied, so the two cannot drift). A test with fewer than two usable points cannot draw a curve, so it is skipped and counted rather than silently dropped.

.. CG-EXPLANATION-END id=module-header

``interface UnitPsdCurve``
--------------------------

.. CG-BLOCK id=interface:UnitPsdCurve lines=20-45

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitPsd.ts
   :language: typescript
   :lines: 20-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitPsdCurve

**What this does.** Declares one pooled curve: the grain-size test id (unique, the drawing key), the sample id (the colour key), the borehole id (what a right-click resolves a section from), the cumulative points, and the borehole name, sample number and depth range for the tooltip. An interface names the shape of an object.

**Why it is here.** The sample id is the colour key so two grain-size records of one sample (sieve plus hydrometer) and that sample's scatter dots all wear one colour (owner, 2026-08-28); the borehole id is carried so the right-click "go to the sample on a cross-section" has the hole to resolve a section for; the name, number and depth are carried so the curve's tooltip can identify it.

.. CG-EXPLANATION-END id=interface:UnitPsdCurve

``interface UnitPsdPool``
-------------------------

.. CG-BLOCK id=interface:UnitPsdPool lines=46-69

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitPsd.ts
   :language: typescript
   :lines: 46-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitPsdPool

**What this does.** Declares the pooling result: every drawable curve, plus the count of grain-size tests that were too thin (fewer than two points) to draw. The documentation below it describes the pooling function that follows.

**Why it is here.** The skipped count is carried, not swallowed, so the panel can say some tests could not be drawn rather than silently thinning the pool.

.. CG-EXPLANATION-END id=interface:UnitPsdPool

``function poolUnitPsdCurves``
------------------------------

.. CG-BLOCK id=function:poolUnitPsdCurves lines=70-112

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/unitPsd.ts
   :language: typescript
   :lines: 70-112
   :lineno-match:

.. CG-EXPLANATION-START id=function:poolUnitPsdCurves

**What this does.** Groups the unit's bands by borehole, then for each hole's samples whose midpoint lands in a band, builds a cumulative curve from every grain-size test on the sample. A test that yields at least two points becomes a curve carrying its sample and hole identity; a test with fewer than two points is counted as skipped. It returns the curves and the skipped count.

**Why it is here.** One sieve reading is a single dot, not a distribution, so it cannot be drawn as a curve and is skipped and counted. A hole whose details have not arrived yet contributes nothing rather than erroring. The bands arrive already member-filtered from the caller — the same list the scatter panels pool from — so the curves and the dots always describe the same population.

.. CG-EXPLANATION-END id=function:poolUnitPsdCurves

