groundmodel.application.split_geotech_band
==========================================

.. CG-PAGE source=src/groundmodel/application/split_geotech_band.py complete=true

*Source file:* ``src/groundmodel/application/split_geotech_band.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../src/groundmodel/application/split_geotech_band.py
   :language: python
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the split-band commit file. It imports the body-partition lock, the band-edit helpers, the borehole-materialiser base, the orphan sweep, the instance resolver and the pure split planner, and defines a millimetre depth rounding. Its docstring records the ruling behind each part.

**Why it is here.** The docstring is the design: the class is re-derived from the cone resistance over each half (not carried), recalculation is local to the edited column, the split depth is refused outside the litho body (the owner overrules the class, not the hierarchy), a too-thin result is committed with a warning not blocked, and a borehole is refused because it has no cone resistance to re-derive from. The original row becomes the upper half so its correlations stay attached, and both edited rows are stamped manual because their depths are the engineer's now.

.. CG-EXPLANATION-END id=module-header

Class ``SplitGeotechBand`` — header
-----------------------------------

.. CG-BLOCK id=class:SplitGeotechBand lines=65-77

.. literalinclude:: ../../../src/groundmodel/application/split_geotech_band.py
   :language: python
   :lines: 65-77
   :lineno-match:

.. CG-EXPLANATION-START id=class:SplitGeotechBand

**What this does.** The use case that splits one packing band in two and re-derives both halves' NAD class. It extends the borehole-materialiser base.

**Why it is here.** It inherits the find-or-create formation helpers so a hand edit lands on the SAME formation rows the build would have produced.

.. CG-EXPLANATION-END id=class:SplitGeotechBand

Method ``SplitGeotechBand``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:SplitGeotechBand.__init__ lines=78-81

.. literalinclude:: ../../../src/groundmodel/application/split_geotech_band.py
   :language: python
   :lines: 78-81
   :lineno-match:

.. CG-EXPLANATION-START id=method:SplitGeotechBand.__init__

**What this does.** Initialises the base with this module's name and the session.

**Why it is here.** The base gives the shared helpers and the session; naming keeps the log lines correct.

.. CG-EXPLANATION-END id=method:SplitGeotechBand.__init__

Method ``SplitGeotechBand``. ``async def execute``
--------------------------------------------------

.. CG-BLOCK id=method:SplitGeotechBand.execute lines=82-244

.. literalinclude:: ../../../src/groundmodel/application/split_geotech_band.py
   :language: python
   :lines: 82-244
   :lineno-match:

.. CG-EXPLANATION-START id=method:SplitGeotechBand.execute

**What this does.** Loads the column, requires a CPT anchor, plans the split, takes the partition lock, resizes the original row to the upper half and inserts a new lower row (both reclassified and stamped manual), re-validates the upper half's ties against its new class, resolves body identity, sweeps orphan formations, and commits.

**Why it is here.** The lock is taken before the first write because the resize and insert race the background recompute that re-stamps the same rows in a different order (owner dogfeed 2026-08-23: a deadlock). Flag-not-drop (owner 2026-08-07): the ties are re-judged not silently deleted — pending mismatches withdraw, accepted mismatches gain a flag, restored matches self-heal. The orphan sweep runs because re-deriving both halves can leave the pre-split class with no bands anywhere.

.. CG-EXPLANATION-END id=method:SplitGeotechBand.execute

