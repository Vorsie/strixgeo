desktop.renderer.src.utils.depthTolerance
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/depthTolerance.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/depthTolerance.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/depthTolerance.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring introducing this one-value module: the allowance within which two depths on the same column are treated as the same depth.

**Why it is here.** The docstring frames the value that follows — it exists to define one shared depth-rounding allowance in a single place.

.. CG-EXPLANATION-END id=module-header

``const COINCIDENT_DEPTH_TOLERANCE_M``
--------------------------------------

.. CG-BLOCK id=const:COINCIDENT_DEPTH_TOLERANCE_M lines=27-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/depthTolerance.ts
   :language: typescript
   :lines: 27-27
   :lineno-match:

.. CG-EXPLANATION-START id=const:COINCIDENT_DEPTH_TOLERANCE_M

**What this does.** The single shared constant: how far apart two depths may sit and still count as the same depth — just over a millimetre.

**Why it is here.** The docstring records that this is a rounding allowance, not a matching heuristic: the two models store the same boundary at two precisions (the geotech bands round depths to three decimals, litho contacts keep full precision), so the same boundary appears as, for example, 9.581 and 9.581049712235094. The value was measured, not chosen — on the owner's real model, of 322 genuinely coincident boundaries, 255 were bit-identical and 67 differed only within a millimetre, so an exact comparison would misjudge a fifth of them; the extra hair past a millimetre keeps the millimetre itself inside the allowance. It lives here once so tightening it can never quietly change the meaning at one call site but not another.

.. CG-EXPLANATION-END id=const:COINCIDENT_DEPTH_TOLERANCE_M

