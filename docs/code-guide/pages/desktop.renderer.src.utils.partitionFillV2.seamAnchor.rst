desktop.renderer.src.utils.partitionFillV2.seamAnchor
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/seamAnchor.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/seamAnchor.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seamAnchor.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module returns a seam endpoint that lies EXACTLY on a bracket line after both have been snapped to the 1 mm integer grid. The imports bring in the point-snapping helper and the grid constant.

**Why it is here.** The docstring records the bug it fixes. The interval seam-tiler emits a vertical seam whose endpoints must attach to the top and base bracket curves so the seam actually partitions the interval. The arrangement snaps every vertex to a 1 mm integer grid and then does exact-integer collinearity tests. A seam endpoint computed by an independent metres-space interpolation almost never lands on the SNAPPED bracket segment when the bracket slopes — a fraction-of-a-millimetre offset makes it neither a crossing nor a collinear T-junction, so the seam DANGLES and does not cut the face (the Tie-section-6 veen full-width band, a strict-2/1/0 ruling-8 violation). Returning a lattice point that is exactly collinear by construction makes the arrangement register it as a proper T-junction.

.. CG-EXPLANATION-END id=module-header

``function gcd``
----------------

.. CG-BLOCK id=function:gcd lines=28-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seamAnchor.ts
   :language: typescript
   :lines: 28-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:gcd

**What this does.** The greatest common divisor of two whole numbers, by the classic repeated-remainder method.

**Why it is here.** It reduces the bracket's integer direction to its smallest step so the collinear lattice points along the bracket can be enumerated exactly.

.. CG-EXPLANATION-END id=function:gcd

``function seamAnchorOnBracket``
--------------------------------

.. CG-BLOCK id=function:seamAnchorOnBracket lines=59-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/seamAnchor.ts
   :language: typescript
   :lines: 59-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamAnchorOnBracket

**What this does.** Given a bracket's two endpoints and a desired seam x, it snaps the endpoints to the grid, reduces the integer direction by its gcd to get the smallest collinear step, and returns the lattice point on that line whose x is nearest the desired seam x, clamped to stay within the bracket span. A vertical or degenerate bracket falls back to the plain interpolation.

**Why it is here.** Because the returned point is the start endpoint plus a whole number of reduced steps, it satisfies the exact-integer collinearity test perfectly, so the arrangement attaches the seam as a grid-exact T-junction. The docstring notes the seam x shifts by at most half a lattice step — sub-centimetre on real sections, below the visual and snap scale — and it never opens a hole because the shared vertex keeps the seam and bracket connected.

.. CG-EXPLANATION-END id=function:seamAnchorOnBracket

