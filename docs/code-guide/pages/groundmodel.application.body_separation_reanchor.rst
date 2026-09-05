groundmodel.application.body_separation_reanchor
================================================

.. CG-PAGE source=src/groundmodel/application/body_separation_reanchor.py complete=true

*Source file:* ``src/groundmodel/application/body_separation_reanchor.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/application/body_separation_reanchor.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the separation re-anchor file. It imports the shared pair-ruling machinery and the separation row, and defines back-compatibility aliases for the separation-flavoured names.

**Why it is here.** A Separate ruling anchors two bands by their layer ids with cascade foreign keys, so a re-subdivide would take it with it unless carried; all the machinery lives in the shared module, and this is the thin separation specialisation whose one difference is that a fused pair is a loss (a body cannot be separated from itself).

.. CG-EXPLANATION-END id=module-header

Function ``def plan_separation_reanchor``
-----------------------------------------

.. CG-BLOCK id=function:plan_separation_reanchor lines=44-65

.. literalinclude:: ../../../src/groundmodel/application/body_separation_reanchor.py
   :language: python
   :lines: 44-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_separation_reanchor

**What this does.** A back-compatibility wrapper that plans a separation re-anchor with the fused case counted as a loss.

**Why it is here.** Callers and tests import the separation-flavoured name; it delegates to the shared planner with the loss flag set.

.. CG-EXPLANATION-END id=function:plan_separation_reanchor

Class ``BodySeparationReanchor``
--------------------------------

.. CG-BLOCK id=class:BodySeparationReanchor lines=66-74

.. literalinclude:: ../../../src/groundmodel/application/body_separation_reanchor.py
   :language: python
   :lines: 66-74
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodySeparationReanchor

**What this does.** The separation specialisation of the shared re-anchor base, setting the separation row, the noun, and the fused-is-loss flag.

**Why it is here.** A fused pair is a loss because a body cannot be separated from itself (debt #278 R5).

.. CG-EXPLANATION-END id=class:BodySeparationReanchor

