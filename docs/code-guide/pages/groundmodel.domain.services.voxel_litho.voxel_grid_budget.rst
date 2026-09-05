groundmodel.domain.services.voxel_litho.voxel_grid_budget
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/voxel_grid_budget.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/voxel_grid_budget.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_grid_budget.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Sets the largest number of voxels one build may ask for (``MAX_VOXEL_CELLS`` = 50 million) and explains, at length, why a ceiling is needed and how the number was chosen. Recall a voxel is one cube-shaped cell of the 3-D grid. The docstring works a real worst case: a two-kilometre linear alignment (a road, dike or quay) at the finest spacing the settings dialog offers resolves to a grid whose label array alone is two gigabytes, and the mesher then allocates seven more full-grid arrays per body, so the build either exhausts memory and kills the engine or runs for hours with no progress, no cancel and no partial result.

**Why it is here.** The stated rule is: refuse *before* allocating, and say exactly what to change. Nothing had bounded the voxel count before; the only check on either side was that the spacings were positive, and no code multiplied the three grid axes out. The number 50 million is justified arithmetically as roughly a 550 MB peak, which a customer laptop survives while the next power of two does not, and it is put in scale against the owner's own 58-investigation model, which uses only a fifth of the budget. A comment warns that the budget reasons about ONE build, which is safe only because a lock makes a second Build wait rather than run alongside the first.

.. CG-EXPLANATION-END id=module-header

Function ``def check_voxel_grid_budget``
----------------------------------------

.. CG-BLOCK id=function:check_voxel_grid_budget lines=57-95

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_grid_budget.py
   :language: python
   :lines: 57-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:check_voxel_grid_budget

**What this does.** Multiplies the three grid dimensions together and, if the product is within budget, returns quietly. If it is over budget, it raises an error whose message names the resolved grid, the total, the budget, and a coarser horizontal spacing at which the same model would fit; it also carries that suggested spacing back as a plain number the dialog can use.

**Why it is here.** A refusal that only says the grid is too big leaves the engineer halving numbers by trial and error until the app stops hanging; this one turns the retry into a single edit. A comment records two deliberate choices in the suggestion maths. Only the two horizontal axes are scaled, never the vertical one, because vertical spacing is what resolves thin layers and coarsening it would be a modelling loss the engineer did not ask for. And because the cell count falls with the square of the horizontal spacing, the scale factor is a square root, rounded up to a whole centimetre so the suggested value never lands a hair back over the budget it is meant to clear.

.. CG-EXPLANATION-END id=function:check_voxel_grid_budget

