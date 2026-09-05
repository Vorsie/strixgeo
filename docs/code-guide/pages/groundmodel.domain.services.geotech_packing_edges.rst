groundmodel.domain.services.geotech_packing_edges
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_packing_edges.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_packing_edges.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_packing_edges.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a pure helper module that aligns the packing
sub-bands of two tests by taking the longest common subsequence — the LCS — of
their NAD packing-class sequences. The LCS is the longest run of classes that
appears in both stacks in the same top-to-bottom order.

**Why it is here.** It is used by the geotech auto-correlation
(``SubdivideAllBodies``): within one litho body, two adjacent tests' packing
sub-band stacks are connected by the LCS of their NAD-class sequences, and any
band with no counterpart stays unconnected — it pinches or onlaps, and the
engineer connects it by hand. A skeleton band, which has no CPT ``qc`` and so
no class (``None``), never matches anything, not even another ``None``, so
skeleton bands are kept out of auto-connection per spec section 8. NAD packing
classes are read from NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=module-header

Function ``def aligned_same_class_pairs``
-----------------------------------------

.. CG-BLOCK id=function:aligned_same_class_pairs lines=17-99

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_packing_edges.py
   :language: python
   :lines: 17-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:aligned_same_class_pairs

**What this does.** Computes the LCS of the two NAD-class sequences and returns
the aligned (left layer id, right layer id) pairs, one per matched position, in
top-to-base order. It fills a table (``dp``) where each cell holds the best LCS
length of the two suffixes from that point down, then walks that table forward
from the top taking every match as early — as shallow — as possible. A ``None``
class never matches.

**Why it is here.** It replaces an earlier match that required the two stacks
to be identical in length and class order, which failed the ordinary real case
where two columns in one litho body share only some classes. The early-match
tie-break is load-bearing (owner refinement 2026-08-06): when equally-long
alignments exist, pairing the two topmost sub-bands is the litho tie restated —
the connection the engineer already approved — so the aligner keeps the tops
together instead of tying a surface band to a deep band, as the older bottom-up
walk did.

.. CG-EXPLANATION-END id=function:aligned_same_class_pairs

Function ``def aligned_pairs_with_forced_top``
----------------------------------------------

.. CG-BLOCK id=function:aligned_pairs_with_forced_top lines=100-147

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_packing_edges.py
   :language: python
   :lines: 100-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:aligned_pairs_with_forced_top

**What this does.** Forces the two stacks' topmost bands together as a pair
regardless of their classes, then LCS-aligns only the bands below that forced
pair; if either top is a skeleton (``None``) band it falls back to the plain
class-matched LCS.

**Why it is here.** The topmost sub-band of each stack owns the very contact
surface the litho tie joins, so for a DIRECT litho pair the restatement pair
must exist even when the two top classes differ (owner ruling 2026-08-13: *"you
have to start from the exact litho geometries"*). Without the force, the
class-equality rule silently dropped the restatement and instead tied the litho
contact to a class-matched band one or more steps deeper, which let the fill
redraw the litho boundary. A skeleton top on either side blocks the forced
pair, the pinned "skeleton-None top blocks restatement" rule.

.. CG-EXPLANATION-END id=function:aligned_pairs_with_forced_top

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=148-150

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_packing_edges.py
   :language: python
   :lines: 148-150
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines the constant ``INTERIOR_MIN_OVERLAP_SHARE`` = 0.25
— the least share of the larger band's fraction extent that an overlap must
cover before an interior pair is proposed.

**Why it is here.** It gates out the sliver-to-deep-band ghosts — a whole-unit
sliver sitting against a thin band at the base of a big unit overlaps almost
none of that big unit — while keeping the genuine body pairs, whose overlap
dominates both extents. The value is tunable; 0.25 was chosen so a body must
overlap at least a quarter of its partner's extent.

.. CG-EXPLANATION-END id=module-statements

Function ``def shadowed_below_lens``
------------------------------------

.. CG-BLOCK id=function:shadowed_below_lens lines=151-200

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_packing_edges.py
   :language: python
   :lines: 151-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:shadowed_below_lens

**What this does.** Returns the layer ids of bands that repeat a class from
above across an intervening lens: a band is shadowed when some band above it in
the same window carries the SAME class with at least one known-different class
strictly between the two. A ``None`` (skeleton) class is no evidence either
way.

**Why it is here.** Owner rule (dogfeed 2026-08-17): *"don't emit auto
correlations ties below a lens if above the lens and below the lens have the
same packing density and litho?"* His scene was S12's silt reading loose silt,
a denser silt lens, then loose silt again, beside S13's single loose silt — the
top pair is already tied by the restatement and the merge step unifies the silt
around the lens, so the machine's extra proposal onto the below-lens repeat is
only noise to delete. Within one litho unit the litho is constant, so the
judgment is class-shape alone. Restatements are unaffected: they carry the
engineer's own litho ties and resolve to contacts, never to interior repeats.

.. CG-EXPLANATION-END id=function:shadowed_below_lens

Function ``def overlap_gated_interior_pairs``
---------------------------------------------

.. CG-BLOCK id=function:overlap_gated_interior_pairs lines=201-269

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_packing_edges.py
   :language: python
   :lines: 201-269
   :lineno-match:

.. CG-EXPLANATION-START id=function:overlap_gated_interior_pairs

**What this does.** Proposes interior same-class pairs by how much their
fraction extents overlap, kept monotone — non-crossing — by an overlap-weighted
LCS: two bands pair only when they share a NAD class and their litho-window
fraction extents overlap by at least ``INTERIOR_MIN_OVERLAP_SHARE`` of the
larger extent.

**Why it is here.** Owner ruling 2026-08-14 (*"auto correlate is fine, its just
a tool to make the users life easier"*): inside a litho-banded pair the
restatement carries only the units' outer contacts, so the big same-class
interior bodies never received a proposal and the engineer had to find and
hand-tie them — the CS1 gap-3 case, a 287 m2 silt hole. This pass proposes them
as pending ghosts. Position-blind class matching was the bug the refinement's
weighted LCS already named, and the share gate keeps the sliver-to-deep-band
ghosts dead; the overlap weighting keeps the ghost ribbons from crossing.

.. CG-EXPLANATION-END id=function:overlap_gated_interior_pairs

