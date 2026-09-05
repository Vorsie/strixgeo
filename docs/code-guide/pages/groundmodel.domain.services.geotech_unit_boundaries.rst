groundmodel.domain.services.geotech_unit_boundaries
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_unit_boundaries.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_unit_boundaries.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_unit_boundaries.py
   :language: python
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools: ``Sequence`` (the
type for "an ordered list you read but do not change"), the ``dataclass``
decorator (a shorthand for a plain holder of named values), and ``replace`` (which
makes a copy of a frozen record with one field changed). It then sets two
constants: the smallest offset that counts as an interior boundary rather than the
unit's own contact (one millimetre, the storage grain), and the half-gap reach a
one-sided construct is drawn over. The file places a litho unit's interior packing
boundaries onto a borehole standing between two CPTs.

**Why it is here.** A borehole has no packing evidence of its own, so where its
interior packing boundaries fall has to be worked out from the two CPTs flanking
it. The docstring quotes the owner's rule verbatim and explains why earlier
attempts failed: they derived the borehole's correlation from something one-sided,
so the chain from CPT to borehole to borehole to CPT never closed. The fix is to
place a boundary FROM the tie itself — a tie names both bands it joins, so the
correspondence on both sides comes for free and the chain closes by construction.
Two rulings are baked in: litho stays authoritative, so a boundary that IS a litho
contact is never interpolated (only boundaries interior to a litho unit are
placed); and a tied boundary lands where the drawn tie LINE crosses the borehole's
column, by elevation, not by a fraction of the unit's thickness (owner:
"go for the mtaw, it'll look better than the fractional"). The half-gap reach
matches the same half-length the 2/1/0 fill draws a lens or onlap with, so the
section and the borehole agree about where a construct ends.

.. CG-EXPLANATION-END id=module-header

Class ``ColumnBoundary``
------------------------

.. CG-BLOCK id=class:ColumnBoundary lines=65-87

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_unit_boundaries.py
   :language: python
   :lines: 65-87
   :lineno-match:

.. CG-EXPLANATION-START id=class:ColumnBoundary

**What this does.** Defines a read-only record for one interior packing boundary
on one CPT column: its elevation in metres above the Belgian datum (mTAW), and the
identifiers of the packing band directly above it and directly below it (either of
which may be empty).

**Why it is here.** The placement works from the flanking CPTs' interior
boundaries, and for each it needs to know two things: where the boundary sits (its
elevation), and which two bands it separates (so the boundary laid on the borehole
can be told which packing bands it corresponds to on that side). Only interior
boundaries are carried here — the unit's own top and base are litho contacts that
belong to the litho model and are never moved.

.. CG-EXPLANATION-END id=class:ColumnBoundary

Class ``PlacedBoundary``
------------------------

.. CG-BLOCK id=class:PlacedBoundary lines=88-129

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_unit_boundaries.py
   :language: python
   :lines: 88-129
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlacedBoundary

**What this does.** Defines a read-only record for a boundary laid on the
borehole: its depth below the collar, its position within the unit (kept only as
provenance), the bands it separates on the left and right columns, a kind tag
(``continuous`` for a tie, ``onlap`` or ``lens`` for a one-sided construct), the
index of the tie it came from (empty for a one-sided construct), and a flag saying
whether it actually lands on the borehole's log.

**Why it is here.** The output has to carry more than a depth. The kind tag records
whether the boundary was a two-sided tie or a one-sided construct; the left and
right band identifiers let the caller classify the intervals the boundary clips;
and the tie index tells the caller which tie to delete once its replacement has
been written. The on-log flag is the subtle part: a tie LINE that crosses the
column outside the unit is kept as off-log context — nothing is drawn there,
because the litho contact bounds the unit — but the line still names which bands
run past the unit, which the caller needs to classify neighbouring intervals.

.. CG-EXPLANATION-END id=class:PlacedBoundary

Function ``def interior_boundary_index``
----------------------------------------

.. CG-BLOCK id=function:interior_boundary_index lines=130-161

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_unit_boundaries.py
   :language: python
   :lines: 130-161
   :lineno-match:

.. CG-EXPLANATION-START id=function:interior_boundary_index

**What this does.** Given which band a tie endpoint names and which surface of it
(top or base), returns the interior seam that endpoint declares — or nothing when
the named surface is the unit's own outer contact.

**Why it is here.** A tie names a band AND a side, and the side decides which seam
is meant. The comment records the bug it fixes (audit P1-2, 2026-08-18): the
placement used to assume every endpoint was a top, so a base-to-base tie — the
only way the deepest band can band to a neighbour — was applied one seam too high,
and a base tie on the deepest band was silently dropped. Returning nothing for a
named outer contact keeps the litho model's contacts untouched. The comment also
notes that one band's base and the next band's top are the same physical seam, so
both map to a single seam index whichever way the tie was stated.

.. CG-EXPLANATION-END id=function:interior_boundary_index

Function ``def place_unit_boundaries``
--------------------------------------

.. CG-BLOCK id=function:place_unit_boundaries lines=162-307

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_unit_boundaries.py
   :language: python
   :lines: 162-307
   :lineno-match:

.. CG-EXPLANATION-START id=function:place_unit_boundaries

**What this does.** Lays one litho unit's interior packing boundaries onto the
borehole between two CPTs. For each tie it puts a ``continuous`` boundary where the
tie LINE crosses the borehole, interpolating the elevation by the borehole's
position across the gap. For each untied boundary it adds a one-sided construct,
but only from the column the borehole stands within half the gap of. It then keeps
the boundaries that land strictly inside the unit, keeps tied lines that fall
outside as off-log context, drops one-sided constructs that fall outside, and
merges any two boundaries closer together than the storage grain.

**Why it is here.** This is the owner's rule executed. A tied boundary is placed by
elevation so the committed contact and the line on screen are the same thing
(the 2026-08-18 mTAW ruling). A one-sided lens or onlap is drawn only within half
the gap of the column that declared it — the same half-length the 2/1/0 fill uses
— and beyond that the matrix wins, so the borehole and the section agree about
where a construct ends. Boundaries landing on the unit's own contact are excluded
because those are the litho model's to draw; a tied line outside the unit is kept
off-log because it still names which bands run past, while a one-sided construct
outside the unit simply does not exist there. The final merge collapses two
boundaries within a millimetre into one, because two contacts finer than the
storage grain cannot make a writable band.

.. CG-EXPLANATION-END id=function:place_unit_boundaries

Function ``def replaced_tie_indices``
-------------------------------------

.. CG-BLOCK id=function:replaced_tie_indices lines=308-327

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_unit_boundaries.py
   :language: python
   :lines: 308-327
   :lineno-match:

.. CG-EXPLANATION-START id=function:replaced_tie_indices

**What this does.** Returns, in order and without repeats, the indices of the ties
whose boundary actually landed on the borehole's log.

**Why it is here.** This is the bookkeeping half of the owner's rule ("then you
delete all the bands you checked and replaced by hops"). A tie whose boundary was
placed on the log has had its replacement written, so it can be deleted; a tie
whose boundary fell on the unit's own contact or outside the unit was not replaced
and must survive. Because the placement wrote the correspondence from the tie
itself, this can be plain bookkeeping — nothing has to prove after the fact that a
replacement exists.

.. CG-EXPLANATION-END id=function:replaced_tie_indices

