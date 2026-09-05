groundmodel.domain.services.voxel_litho.smooth_body_solids_constants
====================================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/smooth_body_solids_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/smooth_body_solids_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids_constants.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Holds the three tuning numbers for the experimental voxel-solid smoother, each written down with the reason it was chosen: Taubin's lambda and mu smoothing pair, the default number of iterations, and the per-vertex displacement budget.

**Why it is here.** This is a prototype for debt #220 (a non-blocky 3-D litho surface), which the owner has ruled is NOT part of the first release. The smoother trades staircase removal against contact fidelity, so every constant here sits on one side of that trade. The lambda and mu pair (Taubin 1995, 'A signal processing approach to fair surface design') alternates a shrinking step and a slightly larger un-shrinking step, so repeated smoothing does not slowly collapse the body toward its centre; the docstring stresses the two must be tuned together, never independently. The displacement budget is fixed at half a voxel because that is exactly the rounding error the voxel grid introduced, so it is the largest correction the smoother can claim to be recovering rather than inventing, and it also makes a body folding through itself impossible. Twelve iterations is where the real model's staircase stops visibly improving. A pure constants module: it holds values and does not act.

.. CG-EXPLANATION-END id=module-header

