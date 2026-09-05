groundmodel.application.merge_geotech_bands
===========================================

.. CG-PAGE source=src/groundmodel/application/merge_geotech_bands.py complete=true

*Source file:* ``src/groundmodel/application/merge_geotech_bands.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-73

.. literalinclude:: ../../../src/groundmodel/application/merge_geotech_bands.py
   :language: python
   :lines: 1-73
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the merge-bands commit file. It imports the same band-edit helpers plus the accepted-edge transfer, and the pure merge planner, and its docstring records the ruling behind each part.

**Why it is here.** The class is re-derived over the union (may differ from every input — that is the point), the recalculation is local, a merge across a litho or geological contact is refused, and a borehole is refused. Two correlation sets are touched under flag-not-drop: the absorbed band's accepted ties are transferred to the survivor and flagged, and the survivor's ties are re-judged against the merged class.

.. CG-EXPLANATION-END id=module-header

Class ``MergeGeotechBands`` — header
------------------------------------

.. CG-BLOCK id=class:MergeGeotechBands lines=74-86

.. literalinclude:: ../../../src/groundmodel/application/merge_geotech_bands.py
   :language: python
   :lines: 74-86
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeGeotechBands

**What this does.** The use case that merges two adjacent bands and re-derives the union's class. It extends the borehole-materialiser base.

**Why it is here.** It inherits the find-or-create helpers so a hand merge lands on the same formation rows the build would have produced.

.. CG-EXPLANATION-END id=class:MergeGeotechBands

Method ``MergeGeotechBands``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:MergeGeotechBands.__init__ lines=87-90

.. literalinclude:: ../../../src/groundmodel/application/merge_geotech_bands.py
   :language: python
   :lines: 87-90
   :lineno-match:

.. CG-EXPLANATION-START id=method:MergeGeotechBands.__init__

**What this does.** Initialises the base with this module's name and the session.

**Why it is here.** Same base-and-logger setup as the other band-edit use cases.

.. CG-EXPLANATION-END id=method:MergeGeotechBands.__init__

Method ``MergeGeotechBands``. ``async def execute``
---------------------------------------------------

.. CG-BLOCK id=method:MergeGeotechBands.execute lines=91-273

.. literalinclude:: ../../../src/groundmodel/application/merge_geotech_bands.py
   :language: python
   :lines: 91-273
   :lineno-match:

.. CG-EXPLANATION-START id=method:MergeGeotechBands.execute

**What this does.** Takes the partition lock, loads the column, requires a CPT anchor, plans the merge, extends the shallowest survivor over the union and reclassifies it, transfers each absorbed band's accepted ties onto the survivor before deleting it, re-validates the survivor's ties, resolves bodies, sweeps orphan formations, and commits.

**Why it is here.** The lock is taken first because the delete and update race the background recompute (owner dogfeed 2026-08-23: a deadlock on the delete). The survivor is the shallowest row because its untouched top keeps its ties attached. Accepted ties are transferred and flagged rather than lost to the foreign-key cascade (owner 2026-08-07: no accepted edge disappears without the engineer deleting it); a transfer that would self-loop or duplicate is dropped and counted separately so the toast can tell the engineer whose work went.

.. CG-EXPLANATION-END id=method:MergeGeotechBands.execute

