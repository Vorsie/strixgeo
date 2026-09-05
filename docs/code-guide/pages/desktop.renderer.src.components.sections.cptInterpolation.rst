desktop.renderer.src.components.sections.cptInterpolation
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/cptInterpolation.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/cptInterpolation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptInterpolation.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it looks up a CPT depth-series value (such as qc or Rf) at an arbitrary depth by linear interpolation between the two nearest samples. It imports nothing.

**Why it is here.** The comment records the history: the same lookup was originally inlined in the hover readout of ``ContactPickBar``, and when the drag interaction in ``ContactsLayer`` needed the same thing, the second use triggered the project's extract-on-the-second-copy rule.

.. CG-EXPLANATION-END id=module-header

``function lookupCptValueAtDepth``
----------------------------------

.. CG-BLOCK id=function:lookupCptValueAtDepth lines=15-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/cptInterpolation.ts
   :language: typescript
   :lines: 15-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:lookupCptValueAtDepth

**What this does.** Returns the interpolated value at a given depth: it clamps a depth below the first or above the last sample to that sample's value, and otherwise finds the two bracketing samples and interpolates linearly between them, skipping nulls.

**Why it is here.** The comment records that the depths are ascending by contract in every CPT plot response, and that a plain linear walk is used rather than a binary search because a CPT has only about a hundred samples and this runs on every hover and drag mouse-move, so extra code is not worth it.

.. CG-EXPLANATION-END id=function:lookupCptValueAtDepth

