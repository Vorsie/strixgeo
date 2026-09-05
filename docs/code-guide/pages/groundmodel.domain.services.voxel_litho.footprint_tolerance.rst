groundmodel.domain.services.voxel_litho.footprint_tolerance
===========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/footprint_tolerance.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/footprint_tolerance.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/footprint_tolerance.py
   :language: python
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a single rule with two readers: how far a grid cell's centre may sit outside the data footprint (the outline of the ground the investigations cover) and still count as inside it. The two readers are the voxel labeller, which gates every grid column on this answer, and the gapless-gate reconciliation, which must sample the model at the very same points the labeller used.

**Why it is here.** The docstring's reason is agreement: if the two readers asked the inside-the-model question with different tolerances, the reconciliation would be comparing two different footprints instead of the same one from two directions, and would report holes that are not there. Keeping the one rule in one module forces both to answer identically.

.. CG-EXPLANATION-END id=module-header

Function ``def footprint_tolerance_m``
--------------------------------------

.. CG-BLOCK id=function:footprint_tolerance_m lines=23-44

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/footprint_tolerance.py
   :language: python
   :lines: 23-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:footprint_tolerance_m

**What this does.** Returns half the diagonal of one grid cell, in metres — the value ``0.5 * horizontal_spacing * sqrt(2)``. That number is handed to the footprint's inside-or-outside test as its slack.

**Why it is here.** The docstring records a numerical instability: a strict inside-or-outside test on the polygon outline is unreliable for a cell centre that lands exactly on, or a hair outside, a footprint edge — about half of those on-edge centres flip to outside even though the cell itself overlaps the data. Allowing half a cell's diagonal of slack admits any cell that actually touches the footprint, while a centre more than a full cell away still stays void (empty). Half the diagonal is the exact distance from a cell's centre to its farthest corner, so it is the smallest slack that guarantees a touching cell is admitted.

.. CG-EXPLANATION-END id=function:footprint_tolerance_m

