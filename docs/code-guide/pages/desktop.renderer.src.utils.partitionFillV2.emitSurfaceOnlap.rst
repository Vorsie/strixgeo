desktop.renderer.src.utils.partitionFillV2.emitSurfaceOnlap
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws the top-band-anchored onlap: a first unit whose top sits on the top-band line (the first litho boundary, not the ground surface) and whose base is tied to a band renders as an onlap — a pinch whose top rides the top-band and whose tip sits at 0.5 with a rising apex, the facing matrix claiming the rest. The rising apex is the point of the module: it lifts the tip above a dipping base band so the pinch stays a clean triangle.

**Why it is here.** The docstring cites ruling 5-revised (2026-07-14 evening, the strip above the top-band stays empty) and explains why the plain onlap default cannot be reused: on a steeply dipping base band its apex would land on the band line and the tracer would merge the pinch into a full-width band (the B6 gap2 defect), so it ports v1's rising apex (the midpoint of the unit's own drilled top and the convergence point).

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=40-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts
   :language: typescript
   :lines: 40-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function facingBaseElevOf``
-----------------------------

.. CG-BLOCK id=function:facingBaseElevOf lines=43-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts
   :language: typescript
   :lines: 43-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingBaseElevOf

**What this does.** Returns the facing column's base-bracket elevation for a given lone side.

**Why it is here.** A one-line helper so the surface-onlap code reads the facing bracket without repeating the left/right swap.

.. CG-EXPLANATION-END id=function:facingBaseElevOf

``function facingTopElevOf``
----------------------------

.. CG-BLOCK id=function:facingTopElevOf lines=48-80

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts
   :language: typescript
   :lines: 48-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingTopElevOf

**What this does.** The same helper for the facing column's top-bracket elevation.

**Why it is here.** Same shape as the helper above, for the top bracket instead of the base.

.. CG-EXPLANATION-END id=function:facingTopElevOf

``function surfaceExtendedUnit``
--------------------------------

.. CG-BLOCK id=function:surfaceExtendedUnit lines=81-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts
   :language: typescript
   :lines: 81-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:surfaceExtendedUnit

**What this does.** Decides whether a lone unit is a top-band-anchored first unit that onlaps, and returns the effective unit whose top rides the top-band line. It fires when the interval top is the top-band line (not an anchor and equal to the column's first litho top) and the unit is the column's first unit.

**Why it is here.** The docstring records that for a first unit the drilled top IS the top-band line (ruling 5-revised), so the effective unit keeps the interval top unchanged and the onlap's top re-anchors to the unit's own drilled top — no invented fill above the first data point.

.. CG-EXPLANATION-END id=function:surfaceExtendedUnit

``function emitSurfaceOnlap``
-----------------------------

.. CG-BLOCK id=function:emitSurfaceOnlap lines=127-182

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitSurfaceOnlap.ts
   :language: typescript
   :lines: 127-182
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitSurfaceOnlap

**What this does.** Draws the surface-anchored onlap for a base-tied first unit. It computes the rising apex (midpoint of the unit's own drilled top and the facing convergence point), clamps it a hair below the top-band line so the pinch top cannot run collinear with the top-band, samples the descending matrix at the facing bracket, and drives the lone-pinch emitter with that rising apex, then draws any enclosed lenses.

**Why it is here.** The docstring records the rising apex keeps the pinch a strictly simple triangle above a dipping base band, and the clamp below the top-band fixes the CS2 g10 SILT case where a convergence near the top-band drove the apex onto the top-band line and collapsed the pinch to a full-width band.

.. CG-EXPLANATION-END id=function:emitSurfaceOnlap

