groundmodel.domain.services.geotech_column_sampler
==================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_column_sampler.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_column_sampler.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools: ``Sequence`` (the
type for an ordered list you read but do not change), the ``dataclass`` decorator,
and the section ``RegionInput`` record. It sets two constants: a tiny horizontal
tolerance for deciding whether a polygon edge crosses the sampling line (float
noise, not real geometry), and the minimum vertical span that counts as a band
(one millimetre, the storage grain). The file reads what a section's finished 2-D
partition contains along one column's vertical line.

**Why it is here.** The docstring quotes the owner's ruling: placing a borehole's
correlations is "really a geometry problem". The partition between two CPTs has
already decided, from the engineer's own ties, what lies in the gap — bands that
span it, lenses that pinch out inside it, onlaps that lap a tie line. A borehole
standing in that gap is simply a vertical line through that geometry: what the
line cuts is what the borehole has, and what it misses (a lens that ended before
it) the borehole does not have. This replaces the earlier "donor arithmetic",
which asked which CPT band each borehole band continues and answered it twice —
once per gap — with disagreeing answers, so no chain of ties ever closed across a
borehole. Reading the region the line cuts answers it once, and because the region
NAMES the layers it belongs to, the correlation is read off rather than guessed —
and two boreholes cutting the same region are in the same region for free. It is
pure domain logic; the application layer supplies the same region payload the 3-D
build already receives.

.. CG-EXPLANATION-END id=module-header

Class ``LithoFrame`` — header
-----------------------------

.. CG-BLOCK id=class:LithoFrame lines=51-75

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 51-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoFrame

**What this does.** Defines a read-only record holding a litho unit's own top and
base elevation at both columns of a gap — four elevations in metres above the
Belgian datum (mTAW).

**Why it is here.** This frame is what keeps the litho model authoritative (owner,
2026-08-15: "litho is authoritative still ... we don't need to invent those, only
invent inside existing litho at boreholes"). A geotech boundary drawn at some
absolute elevation does not mean "that elevation" on a neighbouring column — it
means "that far down the unit". Normalising a sampled band against this frame is
the "0 to 1" rescale the owner asked for, applied to the section geometry rather
than to a stack of donor readings.

.. CG-EXPLANATION-END id=class:LithoFrame

Method ``LithoFrame``. ``def bounds_at``
----------------------------------------

.. CG-BLOCK id=method:LithoFrame.bounds_at lines=76-94

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 76-94
   :lineno-match:

.. CG-EXPLANATION-START id=method:LithoFrame.bounds_at

**What this does.** Given a gap-local position (0 at the left column, 1 at the
right), returns the unit's top and base elevation at that position by straight-line
interpolation between the two columns.

**Why it is here.** The sampling line stands somewhere between the two columns, and
the unit's contacts slope from one to the other. Interpolating gives the unit's own
thickness right there — the same straight contact the section itself draws — which
is the denominator the rescale needs.

.. CG-EXPLANATION-END id=method:LithoFrame.bounds_at

Class ``SampledBand``
---------------------

.. CG-BLOCK id=class:SampledBand lines=95-128

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 95-128
   :lineno-match:

.. CG-EXPLANATION-START id=class:SampledBand

**What this does.** Defines a read-only record for one elevation interval the
vertical line cuts out of a region: its top and base elevation, the region's
formation (on the geotech axis this is the NAD-class unit), the litho layer
identifiers the region came from, how the 2-D engine terminated the region
(``quad`` / ``pinch`` / ``lens``), and whether it is an overlay (a lens or onlap
sitting over a main region).

**Why it is here.** The cut has to carry more than two depths. The layer
identifiers are exactly the endpoints of the ties the column earns by standing
here, so they are what lets the correlation be read off. The termination tag is
kept as provenance — a pinch or lens cut is the engineer's own half-length
geometry, not an interpolation. The overlay tag tells the caller this piece
covers whatever main region it sits over, which is how a half-length lens takes
precedence over the matrix behind it.

.. CG-EXPLANATION-END id=class:SampledBand

Function ``def _vertical_spans``
--------------------------------

.. CG-BLOCK id=function:_vertical_spans lines=129-185

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 129-185
   :lineno-match:

.. CG-EXPLANATION-START id=function:_vertical_spans

**What this does.** Walks a region's outline, finds every place a vertical line at
the sampling position crosses an edge, sorts those crossing elevations top to
bottom, and pairs them up into spans — the stretches where the line is inside the
polygon. It drops any span thinner than the storage grain.

**Why it is here.** A vertical line through a closed shape enters and leaves it in
pairs, so pairing consecutive crossings is what "inside the shape" means. The
docstring records why it must pair crossings rather than take the highest and
lowest: an early version assumed every region was a simple top-curve-over-base and
took the outer extremes, but a region that dips back up across the line covers two
separate spans, and treating them as one invents ground between them — on the
owner's model a tall substrate region then swallowed five real bands beneath it.
Edges are tested half-open and a perfectly vertical edge on the line is skipped,
so a shared corner is counted exactly once.

.. CG-EXPLANATION-END id=function:_vertical_spans

Function ``def sample_regions_at_fraction``
-------------------------------------------

.. CG-BLOCK id=function:sample_regions_at_fraction lines=186-262

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 186-262
   :lineno-match:

.. CG-EXPLANATION-START id=function:sample_regions_at_fraction

**What this does.** Cuts one gap's partition with a vertical line at the given
position, collecting every span it crosses. It separates the cuts into main bands
and overlay bands (lenses / onlaps). Where an overlay covers a main band, it
subtracts the overlay's stretch from the main band rather than dropping the main
band, keeping the parts above and below that the overlay does not reach. It returns
everything ordered top to bottom.

**Why it is here.** An overlay covers the main region it sits over, the same
precedence the section draws with, so what this returns is what the engineer
actually sees at that position. Subtracting rather than dropping is the whole point
of a half-length lens: above and below it the matrix is still there, so the column
must keep those pieces. Reading only the regions in the matching gap keeps the cut
local to where the column stands.

.. CG-EXPLANATION-END id=function:sample_regions_at_fraction

Class ``PlacedBand``
--------------------

.. CG-BLOCK id=class:PlacedBand lines=263-287

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 263-287
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlacedBand

**What this does.** Defines a read-only record for a sampled band re-laid inside a
column's own litho unit: its top and base depth below the column's collar, the
geotech formation it carries, the litho layer identifiers behind it, and the
region's termination tag.

**Why it is here.** The sampled band lives in elevation, but the borehole needs its
subdivisions as depths inside its own litho layer. This record is that re-laid
result — always inside the layer it subdivides — carrying forward the layer
identifiers, which are the tie endpoints the band earns.

.. CG-EXPLANATION-END id=class:PlacedBand

Function ``def place_bands_in_litho_layer``
-------------------------------------------

.. CG-BLOCK id=function:place_bands_in_litho_layer lines=288-375

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 288-375
   :lineno-match:

.. CG-EXPLANATION-START id=function:place_bands_in_litho_layer

**What this does.** Re-lays the sampled bands inside one column's own litho layer.
For each band it reads its top and base as a fraction of the litho unit's own
thickness at the sampling position (0 at the unit top, 1 at its base), then places
those same fractions inside the column's actual litho layer depths. It clips each
band to the layer, forces the bands to stay in order without overlapping, and drops
sub-millimetre slivers.

**Why it is here.** This is the "0 to 1" rescale that keeps the litho model
authoritative: the unit's top and base on this column come from the column's own
litho log, and only the subdivision INSIDE it comes from the section geometry
(owner ruling 2026-08-15). The docstring notes that sampling and then warping is
exact, not an approximation, because at a fixed position the warp is a simple
straight-line stretch that commutes with the cut. Gaps are kept — depth the section
leaves unclassified stays unclassified, for the caller to decide about — but
overlaps are not, because a litho column may not overlap itself: the shallower cut
holds its ground and the deeper one starts where it ends. That mirrors the overlay
precedence already applied, and without it the database's contiguity rule would
refuse the whole write (the owner's "5 gap/overlap(s)" report).

.. CG-EXPLANATION-END id=function:place_bands_in_litho_layer

Function ``def locate_column_in_partition``
-------------------------------------------

.. CG-BLOCK id=function:locate_column_in_partition lines=376-415

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_column_sampler.py
   :language: python
   :lines: 376-415
   :lineno-match:

.. CG-EXPLANATION-START id=function:locate_column_in_partition

**What this does.** Given the partition's own columns and a standing column's
distance along the section line, finds which gap the standing column falls in and
where across that gap it sits (0 at the gap's left column, 1 at the next). It
returns nothing when the column is off the end of the partition or the bracketing
gap has no width.

**Why it is here.** The sampling functions above need a gap index and a position
before they can cut anything, and this is what supplies them. It counts the
partition's own column list, in the order the partition indexes them, because the
gap index means nothing against a re-derived order. A column standing exactly on a
partition column is assigned to the gap that STARTS there, which keeps the position
in the half-open range and never reports a zero-width gap.

.. CG-EXPLANATION-END id=function:locate_column_in_partition

