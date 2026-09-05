desktop.renderer.src.components.sections.partitionFillSampling.testutil
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A test-only toolkit that reads the finished, rendered section fill the way a viewer's eye would, point by point, so a test can check that every point in a window is painted exactly once. A test file is code that only runs during automated checking, never in the shipped app.

**Why it is here.** The header explains that weaker checks are not enough: a rule like some-path-touches-the-gap or the-deepest-vertex-reaches-the-base lets voids, overlaps, and errors that cancel each other out all slip through. Sampling the actual painted points catches them. It is imported only by the overlay's own test files, never by application code.

.. CG-EXPLANATION-END id=module-header

``interface PaintedElement``
----------------------------

.. CG-BLOCK id=interface:PaintedElement lines=13-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 13-23
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PaintedElement

**What this does.** One painted SVG shape reduced to just what a test needs: its fill colour and the list of point-rings its path draws.

**Why it is here.** A shared shape that every sampling helper below reads.

.. CG-EXPLANATION-END id=interface:PaintedElement

``function parseSubpaths``
--------------------------

.. CG-BLOCK id=function:parseSubpaths lines=24-36

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 24-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:parseSubpaths

**What this does.** Splits one SVG path string into its separate rings of screen points, and drops any ring with fewer than three points. An SVG path is a shape written as a string of move and line commands; one path can pack many rings as ``M ... Z M ... Z``.

**Why it is here.** The dissolve pass merges many regions into one element, so a single path string can carry dozens of rings; the sampler needs them separated back out to test them.

.. CG-EXPLANATION-END id=function:parseSubpaths

``function inScreenPoly``
-------------------------

.. CG-BLOCK id=function:inScreenPoly lines=37-53

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 37-53
   :lineno-match:

.. CG-EXPLANATION-START id=function:inScreenPoly

**What this does.** The standard even-odd ray-cast test for whether a screen point lies inside a ring of points.

**Why it is here.** The primitive that the coverage checks below are built on.

.. CG-EXPLANATION-END id=function:inScreenPoly

``function paintedElements``
----------------------------

.. CG-BLOCK id=function:paintedElements lines=54-69

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 54-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:paintedElements

**What this does.** Reads every SVG element in a container that matches a CSS selector and turns each one into a sampleable ``PaintedElement`` carrying its colour and rings.

**Why it is here.** The bridge from the rendered page back to the point sampler.

.. CG-EXPLANATION-END id=function:paintedElements

``function coverageDefects``
----------------------------

.. CG-BLOCK id=function:coverageDefects lines=70-95

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 70-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverageDefects

**What this does.** Samples a screen window on a grid and returns a plain-language list of every point NOT covered by exactly one colour: zero colours is a VOID, more than one is an overlap or blend. A clean fill returns an empty list.

**Why it is here.** The small fractional offsets on each sample keep the points off the fills' shared seams, where the inside test is undefined and would give a false result. The defect strings say exactly where a hole or overlap sits, so a failing test points straight at the spot.

.. CG-EXPLANATION-END id=function:coverageDefects

``function coveredFraction``
----------------------------

.. CG-BLOCK id=function:coveredFraction lines=96-113

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionFillSampling.testutil.ts
   :language: typescript
   :lines: 96-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:coveredFraction

**What this does.** Returns what fraction of a window's sample points are covered by at least one element.

**Why it is here.** A looser measure than ``coverageDefects`` for a test that only needs to assert that most of a window is painted, not that every point is painted exactly once.

.. CG-EXPLANATION-END id=function:coveredFraction

