desktop.renderer.src.utils.partitionFillV2.apexOverride
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/apexOverride.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/apexOverride.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/apexOverride.ts
   :language: typescript
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file gives the free-draw tool a way to move the tip of a termination -- the pointed end of an onlap, or the interior tip of a band -- to the spot the engineer dragged it to. A file of code is a module; this one imports (pulls in from another file) a type named ``LensApexOverride`` (a named shape that describes what one saved drag looks like) and a helper ``lensApexOverrideKey`` that builds the lookup name for one. An override here is a saved instruction: for this body, in this gap, put the tip at this spot. A gap is the space between two neighbouring investigation columns on the section; horizontal position inside it is a fraction running 0 at the left column to 1 at the right; vertical position is an elevation in metres TAW (the Belgian height datum, where 0 m is a real height, never a missing marker).

**Why it is here.** The docstring records that the free-draw tool already lets the engineer drag an enclosed lens tip and have every touching body follow; this module extends that same drag-the-point behaviour to onlap and band tips, so moving one shared tip re-draws both the onlap face and the wedge beside it and the tiling stays free of gaps and overlaps by construction (design note section 8). It is a pure module -- it uses no clock, no randomness and touches no files, so the same inputs always give the same answer.

.. CG-EXPLANATION-END id=module-header

``function terminationApexOverride``
------------------------------------

.. CG-BLOCK id=function:terminationApexOverride lines=50-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/apexOverride.ts
   :language: typescript
   :lines: 50-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:terminationApexOverride

**What this does.** A function (a named piece of code that takes inputs and returns a result) that answers where should this tip go. Given the section's saved overrides, a body's identity and the gap, it looks up whether the engineer dragged this body's tip in this gap; if so it returns the dragged spot, clamped to a safe range, and if not it returns nothing (written ``null``) so the caller keeps its own computed default tip unchanged.

**Why it is here.** The docstring is explicit that returning ``null`` on no override keeps the shape byte-for-byte identical to the no-drag case, so adding this feature never disturbs a section nobody has hand-edited.

.. CG-EXPLANATION-END id=function:terminationApexOverride

``function clampApex``
----------------------

.. CG-BLOCK id=function:clampApex lines=62-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/apexOverride.ts
   :language: typescript
   :lines: 62-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampApex

**What this does.** A small helper that pulls a dragged tip's horizontal fraction back inside the range 0.02 to 0.98; the elevation passes through untouched.

**Why it is here.** The inline comment explains the reason: a tip dragged exactly onto or past a column would make its closing line lie along or cross that column, which opens an overlap -- the one thing the owner forbids (drag the point anywhere, never a gap or overlap, owner 2026-07-21). The clamp is only the legality guard, not the 0.45 reach cap, which overrides are allowed to exceed.

.. CG-EXPLANATION-END id=function:clampApex

