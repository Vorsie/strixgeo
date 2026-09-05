groundmodel.api.schemas.project.stratigraphy_lumping
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/stratigraphy_lumping.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/stratigraphy_lumping.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/stratigraphy_lumping.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining the two-slot lumping storage and why this endpoint replaces rather than merges, then imports the shared lumping shape and the strict base class.

**Why it is here.** The docstring records the decision: the lumping map is one atomic snapshot stamped with its own applied-time, so the write is a whole-value PUT, not a shallow-merge PATCH — merging two applies would produce a map that never existed at any single moment and a lying timestamp (view-state is the opposite, a bag of independent toggles, which is why it merges). Reusing the bundle's lumping shape means the size ceilings that protect the ``.gmproj`` restore path protect this write too.

.. CG-EXPLANATION-END id=module-header

Class ``StratigraphyLumpingStageRequest``
-----------------------------------------

.. CG-BLOCK id=class:StratigraphyLumpingStageRequest lines=26-51

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/stratigraphy_lumping.py
   :language: python
   :lines: 26-51
   :lineno-match:

.. CG-EXPLANATION-START id=class:StratigraphyLumpingStageRequest

**What this does.** The body for writing the staged lumping snapshot: the snapshot itself (or null to clear the slot) and a revision counter.

**Why it is here.** A null snapshot clears the slot to "no lumping map", deliberately distinct from an empty map (the engineer ran Fill from boreholes and grouped nothing). The revision is a monotonic counter written to both the database and the crash-recovery file so recovery compares revisions, not wall-clocks; the endpoint rejects a lower revision with ``409`` but allows an equal one so an idempotent retry still succeeds. A null revision means an older client that does not track revisions, keeping the field additive-optional (see the autosave-recovery design note).

.. CG-EXPLANATION-END id=class:StratigraphyLumpingStageRequest

