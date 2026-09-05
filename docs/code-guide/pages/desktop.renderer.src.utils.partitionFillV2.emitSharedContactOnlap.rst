desktop.renderer.src.utils.partitionFillV2.emitSharedContactOnlap
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitSharedContactOnlap.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitSharedContactOnlap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSharedContactOnlap.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws the unified shared-contact onlap: a minority whose top or base contact rides a tied shared contact is a one-tie unit and must onlap that tie — a pinch tapering from its own column contact to a tip at 0.5 of the gap on the tie line. The space past the tip is closed by the enclosing matrix on the untied side flooding around the onlap notch. It applies whether the facing bracket has real thickness or converges to a point.

**Why it is here.** The docstring cites owner ruling 8a (2026-07-15, on the real S5A|S5 render): a shared tied contact is an anchor, so this one emission dissolves the earlier mixed-bracket-awaiting-ruling and converging-equals-void classes. The tied band keeps its own full-width band and never rises into the interval (routing the below matrix into the base wedge was the symptom of ZAND painting above its tie).

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=40-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSharedContactOnlap.ts
   :language: typescript
   :lines: 40-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function emitSharedContactOnlap``
-----------------------------------

.. CG-BLOCK id=function:emitSharedContactOnlap lines=73-138

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSharedContactOnlap.ts
   :language: typescript
   :lines: 73-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSharedContactOnlap

**What this does.** Draws the shared-contact onlap for one lone-side unit. It finds the convergence point on the facing column and the tip at 0.5 on the tied bracket, draws the onlap pinch (the tied-side edge marked so the face reads as an onlap while keeping its own colour), then draws the two flood-wedge triangles past the tip, both coloured with the enclosing matrix on the untied side.

**Why it is here.** The docstring records that both flood wedges carry the enclosing matrix, never the tied band's own soil, so the tied band keeps its full-width band and the onlap notch is closed by boundary composition — exactly the owner's own traced loop on S5A|S5 (the sand tie up the clay onlap, along the silt top, back).

.. CG-EXPLANATION-END id=function:emitSharedContactOnlap

``function pushLabelled``
-------------------------

.. CG-BLOCK id=function:pushLabelled lines=139-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSharedContactOnlap.ts
   :language: typescript
   :lines: 139-149
   :lineno-match:

.. CG-EXPLANATION-START id=function:pushLabelled

**What this does.** A helper that pushes one closing line and records its colour under the allocated id.

**Why it is here.** Same pairing as the other emitters: every line must register its label so the face it bounds can be coloured.

.. CG-EXPLANATION-END id=function:pushLabelled

