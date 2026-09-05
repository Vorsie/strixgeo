groundmodel.application.body_union_reanchor
===========================================

.. CG-PAGE source=src/groundmodel/application/body_union_reanchor.py complete=true

*Source file:* ``src/groundmodel/application/body_union_reanchor.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/application/body_union_reanchor.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the union re-anchor file. It imports the shared pair-ruling machinery and the union row, and aliases the captured-ruling name.

**Why it is here.** A Join ruling is carried across a re-subdivide the same way, so the machinery is shared; this is the thin union specialisation whose one difference is that a fused pair is satisfied, not lost (the two masses already merged, so the must-link is redundant).

.. CG-EXPLANATION-END id=module-header

Function ``def plan_union_reanchor``
------------------------------------

.. CG-BLOCK id=function:plan_union_reanchor lines=37-58

.. literalinclude:: ../../../src/groundmodel/application/body_union_reanchor.py
   :language: python
   :lines: 37-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_union_reanchor

**What this does.** Plans a union re-anchor with the fused case counted as satisfied rather than lost.

**Why it is here.** It delegates to the shared planner with the loss flag cleared.

.. CG-EXPLANATION-END id=function:plan_union_reanchor

Class ``BodyUnionReanchor``
---------------------------

.. CG-BLOCK id=class:BodyUnionReanchor lines=59-68

.. literalinclude:: ../../../src/groundmodel/application/body_union_reanchor.py
   :language: python
   :lines: 59-68
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyUnionReanchor

**What this does.** The union specialisation of the shared re-anchor base, setting the union row, the noun, and the fused-is-not-a-loss flag.

**Why it is here.** A fused pair is satisfied because the two masses merged, so the must-link is redundant (debt #278), reported at info not as a warning loss.

.. CG-EXPLANATION-END id=class:BodyUnionReanchor

