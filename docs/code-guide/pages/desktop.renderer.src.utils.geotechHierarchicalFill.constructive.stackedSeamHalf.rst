desktop.renderer.src.utils.geotechHierarchicalFill.constructive.stackedSeamHalf
===============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module decides what each HALF of a both-closed seam looks like. Where two facing stacks of bands both close at the mid-gap seam, each half runs its own test's bands flat across to the seam at constant elevation, and any gap in a half — where a lens pinched away, or the cover reaches past the shallowest or deepest band — is filled with the LEAST DENSE of the bands directly above and below it. It imports the band and column shapes.

**Why it is here.** Owner, 2026-08-25: "why don't we keep thickness horizontally, and then where gaps emerge e.g. the silt lense we fill with the least decent adjacent packing?" corrected in the same breath to "or better even keep mtaw lvl", and "least dense yeah, The different height is acceptable". It is scoped to both packages closed and both stacked (two bands or more each); one-on-one or stack-versus-single keeps whatever the emit law already draws. It is explicitly a FALLBACK, not a correlation — what un-tied stacked packages get until the engineer ties band to band across the gap ("i will prolly tie the dense sand on one column to the dense sand on the second column anyway after this fix"). No correlation-crossing guard is needed because a flat continuation within a contiguous stack can never reach across a tie.

.. CG-EXPLANATION-END id=module-header

``const LEVEL_EPS``
-------------------

.. CG-BLOCK id=const:LEVEL_EPS lines=63-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 63-65
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEVEL_EPS

**What this does.** A constant: an elevation tolerance, a billionth of a metre, for a sample sitting ON a contact rather than past it.

**Why it is here.** Contacts are on a millimetre grid and arrive as surface-minus-depth, so a sample exactly on a shared contact would miss both bands' windows by floating-point noise without this.

.. CG-EXPLANATION-END id=const:LEVEL_EPS

``const STACKED_MIN_BANDS``
---------------------------

.. CG-BLOCK id=const:STACKED_MIN_BANDS lines=66-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 66-68
   :lineno-match:

.. CG-EXPLANATION-START id=const:STACKED_MIN_BANDS

**What this does.** The smallest number of bands, two, that the owner calls a stacked sequence.

**Why it is here.** The ruling scopes itself to a stack of two or more, so this is the threshold that says "stacked".

.. CG-EXPLANATION-END id=const:STACKED_MIN_BANDS

``interface StackedSeam``
-------------------------

.. CG-BLOCK id=interface:StackedSeam lines=69-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 69-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StackedSeam

**What this does.** A data shape for the two stacks a seam stands between: the left test's own bands of this family and the right test's, shallowest first on each side.

**Why it is here.** The rule reasons over both halves' bands, so it carries them together.

.. CG-EXPLANATION-END id=interface:StackedSeam

``function stackedSeamOf``
--------------------------

.. CG-BLOCK id=function:stackedSeamOf lines=85-122

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 85-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:stackedSeamOf

**What this does.** Decides whether a gap is the case the ruling scopes itself to. Given the gap's band constructs and its two banded tests, it returns the two stacks only when both packages are closed (no band emits ``nothing``) and both are stacked; otherwise nothing.

**Why it is here.** A band emitting ``nothing`` is open — it spans the gap and fills through (the SF silt of 2026-08-21) — so one of those on either side means the packages are not both closed and the ruling does not reach this gap. One-on-one, stack-versus-single, and any run-through band all keep the behaviour they already had.

.. CG-EXPLANATION-END id=function:stackedSeamOf

``function nadClassRank``
-------------------------

.. CG-BLOCK id=function:nadClassRank lines=123-140

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 123-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassRank

**What this does.** Reads the NAD packing class number, 1 to 31, out of a mass key of the form soil-then-class, and returns nothing when the key carries no class.

**Why it is here.** The fill compares masses by soil and class, and within one soil family the Belgian NAD table (NBN EN 1997-1 ANB Tabel 2.1) numbers its classes from loosest to densest, so the class number IS the density order the engine reads everywhere, and the colour ramp walks the same order. The docstring flags a known limit — each soil family repeats its density run for its admixed variant, so a clean class reads as looser than an admixed one — and notes that both bands of a hole come from one litho unit's own subdivision, where a variant change across a single contact has not been seen; the day it is, this is the one function to refine.

.. CG-EXPLANATION-END id=function:nadClassRank

``function seamHalfBand``
-------------------------

.. CG-BLOCK id=function:seamHalfBand lines=141-171

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/stackedSeamHalf.ts
   :language: typescript
   :lines: 141-171
   :lineno-match:

.. CG-EXPLANATION-START id=function:seamHalfBand

**What this does.** Answers who owns a sample inside a stacked seam half: the band whose own flat elevation window holds it; where none does — a hole — the least dense of the bands directly above and below it; the only one of the two where the hole is at the top or bottom of the stack; nothing only when the stack is empty.

**Why it is here.** "Keep mtaw lvl" — a band is read flat at its own measured elevations, strict interior first so a sample on a shared contact is not decided by band order (on the contact the shallower band wins, the order the stack arrives in). A hole goes to the LEAST DENSE neighbour — "least dense yeah", the weaker class as the honest floor — and with no class to compare, the mass above closes over the pinching ground, matching the ladder's rule for a wedge an onlap pinches away from (2026-08-22, the owner's S24).

.. CG-EXPLANATION-END id=function:seamHalfBand

