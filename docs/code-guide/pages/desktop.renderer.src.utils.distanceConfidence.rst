desktop.renderer.src.utils.distanceConfidence
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/distanceConfidence.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/distanceConfidence.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/distanceConfidence.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing what this module computes: a confidence signal for the litho model based on horizontal distance to the nearest investigation — high on top of a test, low far from every test — and the import of the geological confidence and alpha helpers it reuses.

**Why it is here.** The comment records the reasoning: the geological terrain model derives confidence from triangle edge length, but the litho model is built from voxel solids with no such triangles, so its natural "how well-constrained is the model here" signal is distance to the nearest borehole or CPT; mapping that onto the exact same confidence and alpha scale geology uses makes the fade read identically across both model levels.

.. CG-EXPLANATION-END id=module-header

``const CONFIDENCE_FALLOFF_M``
------------------------------

.. CG-BLOCK id=const:CONFIDENCE_FALLOFF_M lines=21-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/distanceConfidence.ts
   :language: typescript
   :lines: 21-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONFIDENCE_FALLOFF_M

**What this does.** The default falloff distance, fifty metres: a point this far or further from every investigation renders at the lowest confidence.

**Why it is here.** The comment records it was chosen so the middle of a wide gap between tests reads as interpolated while closely spaced tests keep their fill solid, and notes it is tunable later via a preference if needed.

.. CG-EXPLANATION-END id=const:CONFIDENCE_FALLOFF_M

``function distanceConfidence``
-------------------------------

.. CG-BLOCK id=function:distanceConfidence lines=35-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/distanceConfidence.ts
   :language: typescript
   :lines: 35-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:distanceConfidence

**What this does.** Maps a distance to the nearest investigation to a confidence between the floor and one: full confidence on top of a test, falling linearly to the floor at the falloff distance and staying there beyond. A non-positive falloff returns full confidence.

**Why it is here.** The docstring records that a caller can pass zero to switch the fade off without branching, and the linear falloff to a floor is what matches the geological scale.

.. CG-EXPLANATION-END id=function:distanceConfidence

``function distanceAlphaMultiplier``
------------------------------------

.. CG-BLOCK id=function:distanceAlphaMultiplier lines=50-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/distanceConfidence.ts
   :language: typescript
   :lines: 50-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:distanceAlphaMultiplier

**What this does.** A convenience that turns a distance directly into a render transparency multiplier by feeding the distance confidence through geology's alpha curve.

**Why it is here.** The docstring records that this makes the litho model fade on the exact same transparency curve as the geological terrain model, so the two look consistent.

.. CG-EXPLANATION-END id=function:distanceAlphaMultiplier

``function nearestDistance2D``
------------------------------

.. CG-BLOCK id=function:nearestDistance2D lines=63-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/distanceConfidence.ts
   :language: typescript
   :lines: 63-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearestDistance2D

**What this does.** Returns the smallest horizontal distance from a query point to any point in a list of positions, or infinity for an empty list.

**Why it is here.** The docstring records that infinity for no data means "no data anywhere", which the confidence function maps to the floor — so an empty investigation set fades everything to the lowest confidence rather than erroring.

.. CG-EXPLANATION-END id=function:nearestDistance2D

