desktop.renderer.src.utils.divideGeometryFlag
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/divideGeometryFlag.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/divideGeometryFlag.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/divideGeometryFlag.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining a single on/off switch: whether the "Divide boreholes" feature reads its bands off the section geometry (the newer path) or off the older donor rule.

**Why it is here.** The docstring records that the switch is off and why: on the owner's real model the geometry path produced worse columns than the donor rule it was meant to replace — most extents sampled a single band where the donor gave four or more, 39 of his accepted correlations came back flagged where he had none, and ten hops were refused. It records the lesson: it was shipped on the strength of unit tests and a fuzz that only proved the columns were gap-free, never that they were as finely subdivided as what they replaced, and band count against the donor rule is the measurement that must go green before it is switched back on.

.. CG-EXPLANATION-END id=module-header

``const DIVIDE_GEOMETRY_ENABLED``
---------------------------------

.. CG-BLOCK id=const:DIVIDE_GEOMETRY_ENABLED lines=21-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/divideGeometryFlag.ts
   :language: typescript
   :lines: 21-21
   :lineno-match:

.. CG-EXPLANATION-START id=const:DIVIDE_GEOMETRY_ENABLED

**What this does.** The switch itself, set to off.

**Why it is here.** The docstring records that flipping it on restores the geometry path in full with nothing else to change — so the switch is the single, reversible control over which path runs.

.. CG-EXPLANATION-END id=const:DIVIDE_GEOMETRY_ENABLED

