groundmodel.application.move_geotech_band_boundary
==================================================

.. CG-PAGE source=src/groundmodel/application/move_geotech_band_boundary.py complete=true

*Source file:* ``src/groundmodel/application/move_geotech_band_boundary.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/application/move_geotech_band_boundary.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the boundary-drag file. It imports the band-edit helpers, the materialiser base and the pure move planner, and its docstring records the ruling behind each part.

**Why it is here.** Both resulting intervals are reclassified from the cone resistance over their new extents, the recalculation is local, drag is only legal on a same-parentage pair with the depth strictly inside, a too-thin survivor warns, and a borehole is refused. The write is an atomic two-row update — never a lone one — because the contiguity trigger and the no-overlap constraint both check at commit.

.. CG-EXPLANATION-END id=module-header

Class ``MoveGeotechBandBoundary`` — header
------------------------------------------

.. CG-BLOCK id=class:MoveGeotechBandBoundary lines=57-69

.. literalinclude:: ../../../src/groundmodel/application/move_geotech_band_boundary.py
   :language: python
   :lines: 57-69
   :lineno-match:

.. CG-EXPLANATION-START id=class:MoveGeotechBandBoundary

**What this does.** The use case that drags the shared boundary of two adjacent bands and re-derives both. It extends the borehole-materialiser base.

**Why it is here.** It inherits the find-or-create helpers so the drag lands on the same formation rows the build would produce.

.. CG-EXPLANATION-END id=class:MoveGeotechBandBoundary

Method ``MoveGeotechBandBoundary``. ``def __init__``
----------------------------------------------------

.. CG-BLOCK id=method:MoveGeotechBandBoundary.__init__ lines=70-73

.. literalinclude:: ../../../src/groundmodel/application/move_geotech_band_boundary.py
   :language: python
   :lines: 70-73
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveGeotechBandBoundary.__init__

**What this does.** Initialises the base with this module's name and the session.

**Why it is here.** Same base-and-logger setup.

.. CG-EXPLANATION-END id=method:MoveGeotechBandBoundary.__init__

Method ``MoveGeotechBandBoundary``. ``async def execute``
---------------------------------------------------------

.. CG-BLOCK id=method:MoveGeotechBandBoundary.execute lines=74-221

.. literalinclude:: ../../../src/groundmodel/application/move_geotech_band_boundary.py
   :language: python
   :lines: 74-221
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveGeotechBandBoundary.execute

**What this does.** Loads the column, requires a CPT anchor, plans the move, takes the partition lock, moves both rows to the rounded new depth and reclassifies each, re-validates their ties, resolves bodies, sweeps orphan formations, and commits.

**Why it is here.** The lock is taken before the first write for the same deadlock reason as split and merge. Both rows move in one transaction because the deferred contiguity and no-overlap checks fire at commit, so a paired write is legal where a lone one would not be. Either side's former class can end up with no bands, so the orphan sweep runs.

.. CG-EXPLANATION-END id=method:MoveGeotechBandBoundary.execute

