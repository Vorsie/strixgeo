desktop.renderer.src.utils.geotechHierarchicalFill.constructive.facingBottomedOut
=================================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/facingBottomedOut.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/facingBottomedOut.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/facingBottomedOut.ts
   :language: typescript
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module answering one question: is this ground below the facing test's total depth, under the near band's own free base, so that the near test is the only reading of it? It imports the shared reads-the-ground test and the construct types.

**Why it is here.** Owner 2026-08-28, on CS1 gap 14: 'why isn't the closest test on section used?'. The docstring explains that the remainder ladder normally bars a band from ground its own construct has vacated, because the FACING test's statement owns it instead — but below the facing test's total depth there is no facing statement, and the only reading is the near test's. So the guard yields there, and only there. The question is kept out of the ladder so the ladder stays a decision about candidates and this stays a fact about the two tests.

.. CG-EXPLANATION-END id=module-header

``const ON_THE_LINE_EPS``
-------------------------

.. CG-BLOCK id=const:ON_THE_LINE_EPS lines=47-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/facingBottomedOut.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:ON_THE_LINE_EPS

**What this does.** A constant, 1e-6 m — the tolerance for a point standing ON the construct's own base rather than under it.

**Why it is here.** The base comes from the construct's free-contact interpolation and the sample from a ring vertex the arrangement computed, so ground lying exactly against the pinching line differs only by float noise; with contacts stored on the millimetre grid, a micrometre is far below anything real.

.. CG-EXPLANATION-END id=const:ON_THE_LINE_EPS

``interface FacingBottomedOutInput``
------------------------------------

.. CG-BLOCK id=interface:FacingBottomedOutInput lines=50-91

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/facingBottomedOut.ts
   :language: typescript
   :lines: 50-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FacingBottomedOutInput

**What this does.** The one question's inputs bundled together: the candidate band being tested (its column is the near test), that band's own onlap construct, the gap's flank column indices, every column's stack, the loop's elevation extent, and the sample point.

**Why it is here.** It gathers everything needed to answer the fact, without dragging in the remainder ladder's own decision state.

.. CG-EXPLANATION-END id=interface:FacingBottomedOutInput

``function facingTestHasBottomedOut``
-------------------------------------

.. CG-BLOCK id=function:facingTestHasBottomedOut lines=92-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/facingBottomedOut.ts
   :language: typescript
   :lines: 92-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingTestHasBottomedOut

**What this does.** Returns true where the near test is the only reading of this ground. It checks four conditions — the base must be free (untied), the band must stand on a flank of this gap, the facing column must exist and have measured something, and it must have no reading at these levels — and then requires the point to be at or below the band's own free base.

**Why it is here.** The docstring records that every condition is load-bearing: a tied base is ground across a correlation and nothing relaxes that; 'the closest test on section' means a flank column; the facing column must exist so a gap with only one flank does not read as 'the facing test said nothing' and trip the guard on the case it was written against; and the reading test uses the one shared predicate so this answer can never drift from what the constructs decided about the same column.

.. CG-EXPLANATION-END id=function:facingTestHasBottomedOut

