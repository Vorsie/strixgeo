groundmodel.domain.services.geotech_span_splitting
==================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_span_splitting.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_span_splitting.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the module that turns an accepted tie spanning
several data-bearing columns into the chain of shorter hops the divide is meant
to leave behind. It sets a millimetre data tolerance and the landing tolerance,
and lists the public names.

**Why it is here.** Owner rulings 2026-08-17 night: a manual span across two
boreholes must never be deleted, but it should be re-expressed as hops wherever
the intervening columns carry data, and stay a span only where a column is too
shallow to speak ("otherwise it is a subTD tie"). A tie is a straight line in
along-section-by-elevation space; at every intermediate column that line has
one interpolated elevation, and where the column carries bands at that depth
the span lands on the nearest packing contact and continues. What the split
leaves standing is then judged again by :func:`crossings_through_banded_range`
(owner 2026-08-24: *"if no hops can be made, you just auto delete the crossing
correlation"*). It is a pure module; the application half, ``DivideBoreholes``,
owns the loads, the row writes and the deletion of the original span.

.. CG-EXPLANATION-END id=module-header

Class ``SpanColumn``
--------------------

.. CG-BLOCK id=class:SpanColumn lines=70-102

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 70-102
   :lineno-match:

.. CG-EXPLANATION-START id=class:SpanColumn

**What this does.** A frozen dataclass for one section column as the splitter
needs to see it: its investigation id, its along-section position, its collar
elevation, every packing contact depth, the deepest band base, and — per
contact — the soil codes of the band above and below the seam.

**Why it is here.** The along-position is the same projection the section view,
the DXF export and the correlation adjacency all use. The per-contact soils
back the soil guard: a landing contact must present the same soils as the
span's own seam, because nearest-by-depth alone once landed a sand span on a
ZAND8-over-KLEI22 seam and wrote SAND-to-CLAY hops the owner had to prune
(dogfeed 2026-08-18). An empty soils tuple means "unknown" and passes
everything at that column.

.. CG-EXPLANATION-END id=class:SpanColumn

Class ``SpanTie``
-----------------

.. CG-BLOCK id=class:SpanTie lines=103-123

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 103-123
   :lineno-match:

.. CG-EXPLANATION-START id=class:SpanTie

**What this does.** A frozen dataclass reducing one accepted tie to its two
(column, depth) endpoints, plus the (above, below) soil codes of the seam each
endpoint sits on.

**Why it is here.** The soils let a landing contact be refused when it sits on
a different seam even though it is the geometrically nearest, which is what
stopped the SAND-to-CLAY hops above. A ``None`` face means the soil is unknown
and does not constrain the landing.

.. CG-EXPLANATION-END id=class:SpanTie

Class ``SpanNode``
------------------

.. CG-BLOCK id=class:SpanNode lines=124-131

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 124-131
   :lineno-match:

.. CG-EXPLANATION-START id=class:SpanNode

**What this does.** A frozen dataclass for one node of a split chain: a contact
depth on a column.

**Why it is here.** The chain is returned as an ordered list of these nodes —
the two original endpoints plus one landed contact per intermediate column that
carries data at the line's depth.

.. CG-EXPLANATION-END id=class:SpanNode

Class ``SpanCrossing``
----------------------

.. CG-BLOCK id=class:SpanCrossing lines=132-139

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 132-139
   :lineno-match:

.. CG-EXPLANATION-START id=class:SpanCrossing

**What this does.** A frozen dataclass for one column a tie passes over inside
that column's own banded range, carrying the elevation the line reaches it at.

**Why it is here.** This is the verdict the auto-delete acts on: a surviving
tie that still runs through a column's banded extent states continuity straight
through data that disagrees with it, and the engineer was deleting those by
hand.

.. CG-EXPLANATION-END id=class:SpanCrossing

Class ``_SpanLine`` — header
----------------------------

.. CG-BLOCK id=class:_SpanLine lines=140-148

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 140-148
   :lineno-match:

.. CG-EXPLANATION-START id=class:_SpanLine

**What this does.** A private frozen dataclass holding the tie as a straight
line between two placed columns: the two columns and the elevation at each end.

**Why it is here.** Reducing the tie to a line lets both public functions ask,
at any column, what elevation the line reaches there and whether the column
lies between the two endpoints — the geometry the split and the crossing test
both need, computed once.

.. CG-EXPLANATION-END id=class:_SpanLine

Method ``_SpanLine``. ``def elevation_at``
------------------------------------------

.. CG-BLOCK id=method:_SpanLine.elevation_at lines=149-153

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 149-153
   :lineno-match:

.. CG-EXPLANATION-START id=method:_SpanLine.elevation_at

**What this does.** Returns the line's elevation at an along-section position
by straight-line interpolation between the two endpoints.

**Why it is here.** At each intermediate column the tie has exactly one
elevation; this is where both the landing test and the crossing test read it.

.. CG-EXPLANATION-END id=method:_SpanLine.elevation_at

Method ``_SpanLine``. ``def spans``
-----------------------------------

.. CG-BLOCK id=method:_SpanLine.spans lines=154-162

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 154-162
   :lineno-match:

.. CG-EXPLANATION-START id=method:_SpanLine.spans

**What this does.** Returns whether an along-position lies STRICTLY between the
two endpoints.

**Why it is here.** A column that is not strictly between the endpoints is not
an intermediate the tie passes over, and the strictness deliberately excludes
the endpoints themselves — a tie says nothing about a column it is anchored on.

.. CG-EXPLANATION-END id=method:_SpanLine.spans

Function ``def _span_line``
---------------------------

.. CG-BLOCK id=function:_span_line lines=163-179

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 163-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:_span_line

**What this does.** Builds the tie's line in along-by-elevation space from the
section's columns, converting each endpoint's depth to an elevation through its
collar; it returns nothing when either endpoint is missing from the section,
the two endpoints are the same column, or they share an along-position.

**Why it is here.** A tie whose endpoints are not both on this section, or that
would be vertical in section space, cannot be placed as a line — returning
nothing lets both callers skip it cleanly rather than divide by zero.

.. CG-EXPLANATION-END id=function:_span_line

Function ``def crossings_through_banded_range``
-----------------------------------------------

.. CG-BLOCK id=function:crossings_through_banded_range lines=180-255

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 180-255
   :lineno-match:

.. CG-EXPLANATION-START id=function:crossings_through_banded_range

**What this does.** Returns every column the tie passes over at an elevation
inside that column's own banded extent, ordered along the section and
optionally restricted to a set of crossable columns. Endpoints, bandless
columns, and columns where the line runs above the top band or below the
deepest base are not crossings.

**Why it is here.** Owner ruling 2026-08-24: a tie left standing that still
runs through a borehole's banded range states continuity through bands that
disagree with it, and he had been deleting these by hand — so this is the
verdict the DELETE runs on. It is asked only of the ties :func:`split_span`
left standing, where no hops could be made. Below the banded extent is the
sub-TD case the earlier ruling protects; above it the column is equally silent,
and silence is never grounds for deleting the engineer's work.

.. CG-EXPLANATION-END id=function:crossings_through_banded_range

Function ``def split_span``
---------------------------

.. CG-BLOCK id=function:split_span lines=256-342

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_span_splitting.py
   :language: python
   :lines: 256-342
   :lineno-match:

.. CG-EXPLANATION-START id=function:split_span

**What this does.** Turns a spanning tie into its chain: for each intermediate
column that has data at the line's depth, it collects the packing contacts
within the landing tolerance whose seam soils match the span's, lands on the
nearest, and adds a node; it returns the two endpoints with the landed nodes in
between, ordered end to end, or nothing when no column splits.

**Why it is here.** "If the borehole has data" — the line must pass through the
column's banded extent; above the first band or below the deepest base the
column cannot speak at that depth and the tie stays sub-TD there. The landing
tolerance of 1.0 m separates the believable chains, measured 0.04 to 0.93 m off
the line on the owner's model, from the wrong ones, his VD ties crossing a
thick homogeneous sand at 1.22 and 3.28 m off; the soil guard rejects a
nearest-but-wrong-seam contact. A column crossed mid-band with no acceptable
contact keeps spanning, and when nothing lands the tie is kept exactly as
drawn.

.. CG-EXPLANATION-END id=function:split_span

