groundmodel.domain.services.plan_enclosed_lens_merges
=====================================================

.. CG-PAGE source=src/groundmodel/domain/services/plan_enclosed_lens_merges.py complete=true

*Source file:* ``src/groundmodel/domain/services/plan_enclosed_lens_merges.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/domain/services/plan_enclosed_lens_merges.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a pure helper that plans body merges around an enclosed lens: a soil unit sandwiched between two units of the same soil above and below. It imports the dataclass and id tools and sets a one-centimetre tolerance for treating two elevations as the same.

**Why it is here.** The docstring records the owner directive of 2026-06-05, the big sand is one body: a sand split on a single column by a thin clay or silt that wedges out toward a neighbour should read as ONE sand. It states the two cases plainly. A same-soil middle unit merges with its own matrix (owner ruling 2026-07-13). A different-soil lens keeps its own body, and its bracketing halves merge only when a neighbour proves the lens truly pinches out, which is the safety rail against merging a genuine continuous interbed.

.. CG-EXPLANATION-END id=module-header

Class ``MergeLayer``
--------------------

.. CG-BLOCK id=class:MergeLayer lines=43-67

.. literalinclude:: ../../../src/groundmodel/domain/services/plan_enclosed_lens_merges.py
   :language: python
   :lines: 43-67
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeLayer

**What this does.** A frozen data holder for one accepted layer on a column, in absolute elevation (metres above datum): its layer id, its anchor investigation, its top and base elevation, and its soil code, which is the axis the merge reasons about.

**Why it is here.** Adjacent investigations sit at different ground levels, so the planner compares depths in absolute elevation rather than depth below surface, and the top and base are stored that way. The soil code is kept because the whole enclosed-lens test turns on which units share a soil and which differ.

.. CG-EXPLANATION-END id=class:MergeLayer

Class ``MergeEdge``
-------------------

.. CG-BLOCK id=class:MergeEdge lines=68-75

.. literalinclude:: ../../../src/groundmodel/domain/services/plan_enclosed_lens_merges.py
   :language: python
   :lines: 68-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:MergeEdge

**What this does.** A frozen data holder for one correlation edge the planner wants created, naming the host layer and the neighbour host layer it should join to.

**Why it is here.** The planner's output is a set of edges to create; once created and re-resolved, the shared edges make the connected-components resolver group the joined layers into one body. This is the shape the application layer consumes to write the merge.

.. CG-EXPLANATION-END id=class:MergeEdge

Function ``def _overlaps``
--------------------------

.. CG-BLOCK id=function:_overlaps lines=76-80

.. literalinclude:: ../../../src/groundmodel/domain/services/plan_enclosed_lens_merges.py
   :language: python
   :lines: 76-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:_overlaps

**What this does.** Reports whether a unit's elevation span overlaps a given elevation window, using the one-centimetre tolerance so boundaries that just touch do not count as overlap.

**Why it is here.** The enclosed-lens test repeatedly asks whether a neighbour's unit covers the lens's depth band; this is that check in one place. The tolerance keeps two boundaries within a centimetre from reading as an overlap they do not really have.

.. CG-EXPLANATION-END id=function:_overlaps

Function ``def plan_enclosed_lens_merges``
------------------------------------------

.. CG-BLOCK id=function:plan_enclosed_lens_merges lines=81-177

.. literalinclude:: ../../../src/groundmodel/domain/services/plan_enclosed_lens_merges.py
   :language: python
   :lines: 81-177
   :lineno-match:

.. CG-EXPLANATION-START id=function:plan_enclosed_lens_merges

**What this does.** Walks each column in section order and inspects every host-lens-host triple. When all three units share a soil, it ties the middle unit to its own hosts so the resolver unions all three into one body. When the hosts share a soil but the lens differs, it looks to the adjacent neighbours: only if the lens soil is ABSENT there and a continuous host unit spans the lens band does it emit edges joining the bracketing hosts to that neighbour. It returns the de-duplicated edges.

**Why it is here.** This implements the owner's two cases directly, per the comments. The same-soil case (2026-07-13) needs no neighbour proof because a same-soil middle unit is already enclosed by its own matrix. The different-soil case demands a neighbour where the lens is missing but the host runs continuously, which is the proof that the lens is a true pinch-out and not a continuous interbed present on every neighbour. One neighbour is enough, so the walk stops at the first that qualifies. NEVER are ties generated to force a body together beyond this evidence-backed merge.

.. CG-EXPLANATION-END id=function:plan_enclosed_lens_merges

