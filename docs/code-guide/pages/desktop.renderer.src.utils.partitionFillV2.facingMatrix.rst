desktop.renderer.src.utils.partitionFillV2.facingMatrix
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module holds the facing-column soil lookups the lone-side pinch, onlap and stack routers all share: what soil laterally encloses a pinching unit on the facing side, and whether the facing column carries one continuous soil across a span.

**Why it is here.** The docstring records it was extracted from the lone-pinch file to stay under the 500-line budget (debt #201) and consolidated with a byte-identical copy that lived in the lone-stack file, so there is now one source of truth.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=19-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts
   :language: typescript
   :lines: 19-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function facingMatrixLabel``
------------------------------

.. CG-BLOCK id=function:facingMatrixLabel lines=40-104

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts
   :language: typescript
   :lines: 40-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingMatrixLabel

**What this does.** Returns the facing column's soil at a given elevation — the unit whose span contains it, or the nearest unit as a fallback — optionally restricted to units present in a tie-bounded window.

**Why it is here.** The docstring records the rule that a colour sample may never cross a correlation: the nearest-unit fallback is right for a sample overshooting a collar or TD by a few centimetres, but only among units actually present in the tie-bounded channel the sample belongs to, so a column whose stack ends on a bounding tie cannot name a channel beyond it. Callers that know no window pass none and keep the original behaviour.

.. CG-EXPLANATION-END id=function:facingMatrixLabel

``function enclosingMatrixOfInterval``
--------------------------------------

.. CG-BLOCK id=function:enclosingMatrixOfInterval lines=105-148

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts
   :language: typescript
   :lines: 105-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:enclosingMatrixOfInterval

**What this does.** Returns a lone-stack interval's enclosing soil read from the LONE column's own bracket neighbours — the unit just below the interval, else the unit just above — but only when that soil also appears in the stack.

**Why it is here.** The docstring records this fixes Tie-6 gap0: sampling the facing column at a zero-thickness contact returned the wrong unit (ZAND, not the enclosing KLEI), so the stack could not reduce and SILT flooded full-width, a ruling-8 violation. Reading the enclosing soil from the lone column's own adjacency (v1's belowLith then aboveLith) is correct, and requiring it to be in the stack ensures the reduction can actually strip around it.

.. CG-EXPLANATION-END id=function:enclosingMatrixOfInterval

``function facingCoversSpan``
-----------------------------

.. CG-BLOCK id=function:facingCoversSpan lines=149-163

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/facingMatrix.ts
   :language: typescript
   :lines: 149-163
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingCoversSpan

**What this does.** A yes/no test: does the facing column carry one soil continuously across an elevation span, with no gap? It walks the facing units overlapping the span from the base up and confirms they are all that soil and cover the whole span.

**Why it is here.** The docstring records this is the guard that keeps the lone pinch to the clean lateral-lens case whose flood wedges tile with no gap (v1's facingCarriesMatrix, strengthened to require full coverage).

.. CG-EXPLANATION-END id=function:facingCoversSpan

