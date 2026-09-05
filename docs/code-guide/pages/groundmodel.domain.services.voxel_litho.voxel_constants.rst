groundmodel.domain.services.voxel_litho.voxel_constants
=======================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/voxel_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/voxel_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_constants.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Sets two tolerances the labelling uses when it reports discrepancies, and explains each. ``PROJECTION_TIE_EPS_M`` says how nearly-equal two gaps' distances to a point must be before the code decides the tie on evidence (which gap actually drew something there) rather than on the order the sections happen to sit in; it is set equal to the 2-D engine's one-millimetre snap grid. ``HAIRLINE_LIMIT_M`` (15 mm) is the tallest empty sliver left inside a finished column stack that is still treated as harmless rounding rather than a real hole.

**Why it is here.** The project convention is that a constant read outside the one function that applies it lives in its own module, not at the top of a class file; the docstring notes both values are read elsewhere (the hairline limit is named by the application layer in the warning it raises), so they belong here. The reasoning is recorded: two consecutive gaps that share a column reach an off-column point through the very same foot, so their distances differ only by float noise of about a millionth of a metre over a 500 m model, and one snap cell is already a generous tie margin. The 15 mm hairline limit sits an order of magnitude above the worst real rounding gap (0.999 mm on the owner's model) and an order of magnitude below anything an engineer would draw on purpose. It is reported, never enforced: a build must not refuse a model because the engineer deliberately left a gap, so the partition is allowed to say the ground there is unknown.

.. CG-EXPLANATION-END id=module-header

