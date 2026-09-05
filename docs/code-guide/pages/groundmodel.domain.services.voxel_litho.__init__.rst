groundmodel.domain.services.voxel_litho
=======================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/__init__.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/__init__.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the package that builds the 3-D lithostratigraphic model, and lists the one sub-module it exposes to the outside (``voxel_types``, the input contract). A *voxel* is a small cube-shaped cell of a regular 3-D grid, the way a pixel is a square cell of a flat image. To *label* the grid is to write, into every voxel, the identity of the body that fills that piece of ground. The docstring says the builder works in two steps: first label a voxel grid from the frontend's already-validated 2-D section fill (``computeSectionFill``), then extract each body's outer skin as a *greedy mesh* (many small same-body cell faces merged into a few large rectangles, to keep the triangle count down).

**Why it is here.** The docstring records the design decision that makes this approach trustworthy: the result is *watertight* (a closed surface with no holes or gaps) and faithful *by construction*, because a labelling of space is itself a partition of space, and because any voxel may carry any body, interfingering (two soils that finger into each other) can be drawn honestly. That is contrasted with the retired implicit strat-field builder, which forced the ground into a layer-cake and was deleted 2026-07-12. The 2-D section partition is the single source of truth for interpreted geometry; this package only lifts it into three dimensions.

.. CG-EXPLANATION-END id=module-header

