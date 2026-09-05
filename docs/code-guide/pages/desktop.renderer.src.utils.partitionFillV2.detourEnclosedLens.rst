desktop.renderer.src.utils.partitionFillV2.detourEnclosedLens
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file reroutes an enclosing minority's own ONLAP flank around an enclosed lens it would cross -- ruling 8g's a lens is a detour in the enclosing band's contour. When a corr-1 minority that wraps one or more enclosed lenses draws its onlap flank, and that straight flank slices a lens's diamond, the lens gets cut in two and mis-painted the matrix; instead the flank rides around the lens apex.

**Why it is here.** The docstring explains the arrangement's own intersection pass can miss the near-apex second crossing (a limitation of the untouchable ``intersect`` module -- the 613-hole trap), so the fix is geometric: keep the flank off the diamond. The same detour is applied to the onlap's flood flank so the lens closes as a hole on both sides (they are twin half-edges). Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A tiny (one-millionth-metre) elevation tolerance for the enclose-extent test.

**Why it is here.** Matches ``drawTermination``'s epsilon so the does-this-matrix-enclose-this-lens test is consistent.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``interface GapTie``
--------------------

.. CG-BLOCK id=interface:GapTie lines=39-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts
   :language: typescript
   :lines: 39-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapTie

**What this does.** A minimal view of a resolved tie for the reach shortener, tagged with its gap index.

**Why it is here.** The detour filters ties to the flank's gap so the diamond is measured with the same reach shorteners the emitter used.

.. CG-EXPLANATION-END id=interface:GapTie

``function detourFlankAroundEnclosedLenses``
--------------------------------------------

.. CG-BLOCK id=function:detourFlankAroundEnclosedLenses lines=69-121

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts
   :language: typescript
   :lines: 69-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:detourFlankAroundEnclosedLenses

**What this does.** Reroutes an onlap flank around any enclosed lens on its own column that it would cross: for each lens the matrix actually encloses, it computes the lens diamond, checks whether the flank crosses both of the diamond's outer flanks, and if so replaces the span between the crossings with cross-in, apex, cross-out; rides are ordered along the flank.

**Why it is here.** The docstring notes it only detours around lenses the matrix genuinely encloses (a lens outside the matrix's own range belongs to a different band), and it reuses the emitter's exact diamond so the ride is collinear with the emitted lens art and the lens closes as a proper hole.

.. CG-EXPLANATION-END id=function:detourFlankAroundEnclosedLenses

``function segIntersect``
-------------------------

.. CG-BLOCK id=function:segIntersect lines=122-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detourEnclosedLens.ts
   :language: typescript
   :lines: 122-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:segIntersect

**What this does.** A 2D line-segment intersection: returns the crossing point and its parameter along the first segment when the two properly cross, else nothing.

**Why it is here.** The docstring notes it is exported so the band-contour detour reuses the same solver and convention -- one solver, one convention across both detours.

.. CG-EXPLANATION-END id=function:segIntersect

