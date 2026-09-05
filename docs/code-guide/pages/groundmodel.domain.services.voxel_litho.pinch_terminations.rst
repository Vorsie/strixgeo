groundmodel.domain.services.voxel_litho.pinch_terminations
==========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/pinch_terminations.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/pinch_terminations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/pinch_terminations.py
   :language: python
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a module that reads, from the 2-D partition, every place a body is measured to pinch out (thin to nothing). It imports the maths helpers, a grouping helper, the frozen-data-class decorator and the partition value objects, and defines two float thresholds: one for what counts as a pinch-out apex, one for how close a polygon point must be to a region edge.

**Why it is here.** A body that dies between two cross-sections has to terminate somewhere, and the builder used to assume that somewhere was the exact midpoint between the two sections (the formula max(0, 2w minus 1) reaches zero halfway). But the tie-sections run between the cross-sections, so the body actually terminates ON a tie, and the 2-D partition already places and classifies that termination; this is measured evidence in the very direction the builder was guessing. The docstring records how far the midline guess was off on the real model: a median of 4.5 m, worst 53.6 m over 39 cases. The apex threshold is a float-noise guard, not a tunable, because the real lens apexes measure exactly zero thickness. Pure geometry, no logging.

.. CG-EXPLANATION-END id=module-header

Class ``Termination``
---------------------

.. CG-BLOCK id=class:Termination lines=45-71

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/pinch_terminations.py
   :language: python
   :lines: 45-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:Termination

**What this does.** A frozen data holder for one measured pinch-out: the body that terminates, the easting and northing of the apex, what the 2-D engine called the region at that spot (a band-like quad, an onlap pinch, a lens, or nothing), and which section it was measured on. A dataclass is a class whose only job is to hold a few named values together; 'frozen' (the ``@dataclass(frozen=True)`` line above) means it cannot be changed after it is made.

**Why it is here.** The termination facts travel together, so bundling them under clear names is safer than passing loose values around. The docstring stresses that the kind describes the REGION at this position, never the body: a body can band in one gap and onlap in the next, which is the per-gap, per-side reading of the 2/1/0 rule (2 tied contacts a band, 1 an onlap, 0 a lens).

.. CG-EXPLANATION-END id=class:Termination

Function ``def pinch_factor``
-----------------------------

.. CG-BLOCK id=function:pinch_factor lines=72-133

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/pinch_terminations.py
   :language: python
   :lines: 72-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:pinch_factor

**What this does.** Works out how much of a one-sided body still survives at a query point, given where the body is measured to die. It keeps the body at full thickness on the section that carries it, drops it to nothing where another section measures it to end, and thins it in a straight line between, using only terminations on OTHER sections and letting the nearest one govern. It returns a factor between 0 and 1, or nothing when no other section measures this body to end.

**Why it is here.** This replaces the old midline formula that always reached zero halfway between sections, which happened only because the builder had no better anchor than geometry. The docstring explains why an apex on the body's OWN section must be excluded: it says where the body ends along that section, which the slicing step already honours, but says nothing about how far the body reaches away from it. Counting it pinned the factor at exactly 0.5 on almost every real occurrence, a genuine defect. Returning nothing is deliberately not the same as returning zero: nothing means no evidence, so the caller must fall back rather than invent a pinch.

.. CG-EXPLANATION-END id=function:pinch_factor

Function ``def _span_thicknesses``
----------------------------------

.. CG-BLOCK id=function:_span_thicknesses lines=134-158

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/pinch_terminations.py
   :language: python
   :lines: 134-158
   :lineno-match:

.. CG-EXPLANATION-START id=function:_span_thicknesses

**What this does.** For one region ring, finds the low and high ends of its horizontal span (its fraction range) and the region's vertical thickness at each of those two ends.

**Why it is here.** A pinch-out is a place where one end of a region tapers to nothing, so the caller needs the thickness at each end to spot an apex. The thickness at an end is the tallest minus the shortest polygon point sitting on that end within a small tolerance; a lone point contributes zero thickness. A private helper used only by the collector below.

.. CG-EXPLANATION-END id=function:_span_thicknesses

Function ``def _world_at``
--------------------------

.. CG-BLOCK id=function:_world_at lines=159-188

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/pinch_terminations.py
   :language: python
   :lines: 159-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:_world_at

**What this does.** Turns a gap-local fraction (0 at a gap's left column, 1 at its right) into a real-world easting and northing on the section's column fence, by straight-line interpolation between the two columns bounding that gap. It returns nothing when the gap index is out of range.

**Why it is here.** A region's fraction is local to its own gap, so the position must interpolate between that gap's two columns, not along the whole section. A private helper for the collector below.

.. CG-EXPLANATION-END id=function:_world_at

Function ``def body_terminations``
----------------------------------

.. CG-BLOCK id=function:body_terminations lines=189-226

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/pinch_terminations.py
   :language: python
   :lines: 189-226
   :lineno-match:

.. CG-EXPLANATION-START id=function:body_terminations

**What this does.** Walks every section and every region, and for each region whose two ends are thin enough to be an apex, records a termination for that region's body at the apex's world position, gathering the results per body. It returns a map from body id to the tuple of places that body was measured to pinch out.

**Why it is here.** The 3-D builder needs, per body, every measured pinch, so it can taper a body toward whichever end is nearest a query point instead of guessing the midline. The docstring is explicit that tie-sections must NOT be filtered out: a body dying between two cross-sections is actually caught on a tie. A region with no body id is skipped, because a never-correlated minority has no identity to gather under, and a body that terminates nowhere simply does not appear.

.. CG-EXPLANATION-END id=function:body_terminations

