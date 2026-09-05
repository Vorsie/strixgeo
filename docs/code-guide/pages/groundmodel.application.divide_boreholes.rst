groundmodel.application.divide_boreholes
========================================

.. CG-PAGE source=src/groundmodel/application/divide_boreholes.py complete=true

*Source file:* ``src/groundmodel/application/divide_boreholes.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-231

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1-231
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the "divide boreholes" use case: the standalone step
that runs AFTER "subdivide all bodies" and fills each borehole column with
packing bands borrowed from the CPTs that flank it on a section. It gathers the
many imports — the flank-donor rule, the packing fill, the shared edge
derivation, the tie / separation / union re-anchors, the span-splitting, the
crossing sweep — and defines the depth tolerances and the confidence mapping.

**Why it is here.** A borehole records lithology but no cone resistance, so it
carries no packing class of its own; the packing comes from the CPT to its left
and to its right on the cross-section (owner 2026-08-04), blended in
thickness-fraction space and clipped to each CPT's OWN litho extent, so a sand
transition is never stamped onto clay (the same-lithology clip). The docstring
records why this replaced an older ordinal transition-surface approach that mixed
unrelated class pairs from CPTs hundreds of metres away and degraded a borehole
outside the footprint to the body-wide mean. It is split plan / commit:
everything up to the first write lives in ``plan`` (only ``SELECT``\ s), and
``execute`` transcribes the plan verbatim — so the ghost bands the engineer
previews are exactly the rows the button writes, and a second copy of the rules
that could show one class and commit another is the one defect this feature
cannot tolerate. It persists in one transaction: delete the prior borehole bands,
insert the new ones, re-create every accepted tie that touched a borehole, and
commit once.

.. CG-EXPLANATION-END id=module-header

Class ``_BoreholeAnchored`` — header
------------------------------------

.. CG-BLOCK id=class:_BoreholeAnchored lines=232-243

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 232-243
   :lineno-match:

.. CG-EXPLANATION-START id=class:_BoreholeAnchored

**What this does.** A ``Protocol`` — a structural interface — describing any
captured item that exposes its two anchors' kinds and band identities.

**Why it is here.** Both a captured tie and a captured separation satisfy it
structurally, so one borehole-scope filter serves both. Its members are read-only
properties so the FROZEN dataclasses that implement them match.

.. CG-EXPLANATION-END id=class:_BoreholeAnchored

Method ``_BoreholeAnchored``. ``def anchor_kind_a``
---------------------------------------------------

.. CG-BLOCK id=method:_BoreholeAnchored.anchor_kind_a lines=244-245

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 244-245
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoreholeAnchored.anchor_kind_a

**What this does.** Declares that an item exposes the kind (``"cpt"`` /
``"borehole"``) of its first anchor.

**Why it is here.** Part of the structural contract the scope filter reads — a
declaration only, with no body.

.. CG-EXPLANATION-END id=method:_BoreholeAnchored.anchor_kind_a

Method ``_BoreholeAnchored``. ``def anchor_kind_b``
---------------------------------------------------

.. CG-BLOCK id=method:_BoreholeAnchored.anchor_kind_b lines=246-247

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 246-247
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoreholeAnchored.anchor_kind_b

**What this does.** Declares the kind of the item's second anchor.

**Why it is here.** The other half of the same contract.

.. CG-EXPLANATION-END id=method:_BoreholeAnchored.anchor_kind_b

Method ``_BoreholeAnchored``. ``def identity_a``
------------------------------------------------

.. CG-BLOCK id=method:_BoreholeAnchored.identity_a lines=248-249

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 248-249
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoreholeAnchored.identity_a

**What this does.** Declares that an item exposes the band identity of its first
anchor.

**Why it is here.** The scope filter reads the identity's ``investigation_id`` to
decide whether the anchor's column is in scope.

.. CG-EXPLANATION-END id=method:_BoreholeAnchored.identity_a

Method ``_BoreholeAnchored``. ``def identity_b``
------------------------------------------------

.. CG-BLOCK id=method:_BoreholeAnchored.identity_b lines=250-253

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 250-253
   :lineno-match:

.. CG-EXPLANATION-START id=method:_BoreholeAnchored.identity_b

**What this does.** Declares the band identity of the item's second anchor.

**Why it is here.** The other half of the same contract.

.. CG-EXPLANATION-END id=method:_BoreholeAnchored.identity_b

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=254-256

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 254-256
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines a type variable bound to the ``_BoreholeAnchored``
protocol.

**Why it is here.** So the scope filter returns the SAME concrete type it was
given — ties in, ties out; separations in, separations out — rather than the
general protocol.

.. CG-EXPLANATION-END id=module-statements

Function ``def _filter_by_borehole_scope``
------------------------------------------

.. CG-BLOCK id=function:_filter_by_borehole_scope lines=257-298

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 257-298
   :lineno-match:

.. CG-EXPLANATION-START id=function:_filter_by_borehole_scope

**What this does.** Keeps the captured items whose borehole anchor's column is in
(or out of) a given set.

**Why it is here.** This verb rebuilds only the borehole bands, so only a row
anchored on a rebuilt borehole is at risk of the cascade; a row whose sole touched
anchor's row survives must NOT be re-created, or it would be doubled. Both the tie
and separation captures need the identical filter, differing only in element type,
so it lives here once (extract on the second copy).

.. CG-EXPLANATION-END id=function:_filter_by_borehole_scope

Class ``BandDonor``
-------------------

.. CG-BLOCK id=class:BandDonor lines=299-327

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 299-327
   :lineno-match:

.. CG-EXPLANATION-START id=class:BandDonor

**What this does.** A frozen dataclass naming one CPT a borehole band's packing was
read from — the test's name, which side it flanked from, and how far away it was.

**Why it is here.** This is the provenance the engineer asked to see on hover:
which test spoke, from which side, and how far. Light on purpose — it names the
donor rather than carrying its whole stack.

.. CG-EXPLANATION-END id=class:BandDonor

Class ``PlannedBand``
---------------------

.. CG-BLOCK id=class:PlannedBand lines=328-409

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 328-409
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlannedBand

**What this does.** A frozen dataclass for one packing band the divide WOULD write
on a borehole: its depths, class, provenance source, confidence, geotech body,
litho and geological parents, the mode it was reached by, its donors, the donor
band ids it continues, the section it was read along, and the covering litho
layer.

**Why it is here.** It carries everything the write step needs, so a committed band
is a verbatim transcription of a planned one and the preview cannot drift from the
commit. The ``donor_layer_ids`` field records the correspondence the fraction
rescale established, so the commit writes the borehole hop outright instead of
guessing the pairing back from depths (owner 2026-08-15). The provenance fields
distinguish a tie-backed band from a lone distant flank, so a strong reading and a
weak guess are never indistinguishable rows after commit.

.. CG-EXPLANATION-END id=class:PlannedBand

Function ``def _bands_in_extent``
---------------------------------

.. CG-BLOCK id=function:_bands_in_extent lines=410-438

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 410-438
   :lineno-match:

.. CG-EXPLANATION-START id=function:_bands_in_extent

**What this does.** Returns the packing bands a CPT reads inside its own litho
extent, shallow to deep.

**Why it is here.** The same-lithology clip in one helper: only the CPT's bands
within its litho-body extent for this group are candidates, with a millimetre
tolerance because the bands were cut to that very extent.

.. CG-EXPLANATION-END id=function:_bands_in_extent

Function ``def _interior_boundaries``
-------------------------------------

.. CG-BLOCK id=function:_interior_boundaries lines=439-468

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 439-468
   :lineno-match:

.. CG-EXPLANATION-START id=function:_interior_boundaries

**What this does.** Returns the seams BETWEEN a column's bands, each at its
elevation, excluding the unit's own top and base.

**Why it is here.** The unit's top and base are litho contacts, not packing
boundaries, so only the interior seams are placed onto the borehole. Elevation
(via the collar) is used so two columns' seams can be compared.

.. CG-EXPLANATION-END id=function:_interior_boundaries

Function ``def _bands_between``
-------------------------------

.. CG-BLOCK id=function:_bands_between lines=469-562

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 469-562
   :lineno-match:

.. CG-EXPLANATION-START id=function:_bands_between

**What this does.** Turns a set of placed boundaries into contiguous bands on the
borehole, and records per band which litho layers it continues. Where the two
flanks disagree about a band's class, the NEARER flank names it.

**Why it is here.** The nearer flank wins because the far flank's different class
is an onlap that pinched out before reaching here (owner dogfeed 2026-08-18). Two
boundaries that do not change the class are merged — the columns simply disagree
about where a seam sits inside one packing unit — keeping both correspondences. It
works in the borehole's own unit extent and tiles it exactly, so the database
contiguity rule holds.

.. CG-EXPLANATION-END id=function:_bands_between

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~2 lines=563-581

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 563-581
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~2

**What this does.** Defines the 1 mm depth grain and ``GROWABLE_FRACTION_OF_MINIMUM``
— the fraction of the minimum thickness (a half) below which a thinned band is
merged rather than grown.

**Why it is here.** A band the compression thinned to at least half the minimum was
substantially there and is worth growing to the minimum (the owner's B4 basal
clay); a hairline is not — growing a 2 cm reading to 35 cm invents seventeen times
the thickness it was measured over, a worse lie than dropping it. The docstring
flags that the half is not the owner's number and has not been ruled on.

.. CG-EXPLANATION-END id=module-statements~2

Function ``def layer_donor_picks``
----------------------------------

.. CG-BLOCK id=function:layer_donor_picks lines=582-679

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 582-679
   :lineno-match:

.. CG-EXPLANATION-START id=function:layer_donor_picks

**What this does.** Returns the columns a borehole litho layer may borrow its
packing from — the columns its correlations point at, else the columns sharing its
body — under three hard constraints: same soil, must flank the borehole on a
section, and elevation picks the sheet.

**Why it is here.** The candidate pool was once the CPTs in the borehole's (body,
geological band) group, which was wrong twice over: a geological contact can split
one correlation's ends into different groups, and a group can lack any near column
— both bit the owner on B4 (a band he tied to two medium-dense columns 90 m away
took loose sand from a CPT 777 m off). Same-soil is Data Integrity Rule 3 (a silt
donor would put a silt class in a sand unit). The flank constraint is the owner's
ruling given twice, including his acceptance of the starvation trade-off: an honest
conservative floor beats a confident answer from a test that is nowhere near.

.. CG-EXPLANATION-END id=function:layer_donor_picks

Function ``def correlated_donor_picks``
---------------------------------------

.. CG-BLOCK id=function:correlated_donor_picks lines=680-739

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 680-739
   :lineno-match:

.. CG-EXPLANATION-START id=function:correlated_donor_picks

**What this does.** Returns the columns the engineer's litho correlations tie this
unit to.

**Why it is here.** Donors are otherwise grouped by (body, geological band), and a
geological contact can put the two ends of one hand-drawn correlation in different
groups — the owner's B4, whose sand he had tied to two medium-dense columns while
the group held neither. A tie is his statement that two layers are the same sheet,
so it outranks a grouping the engine derived (owner 2026-08-11: *"the user's ties
will define this"*).

.. CG-EXPLANATION-END id=function:correlated_donor_picks

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~3 lines=740-751

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 740-751
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~3

**What this does.** Defines the provenance tags for "no column spoke for this band"
(``body_min``, ``absolute_min``) and the tag for a band raised to its own column's
loosest measured class (``column_min``).

**Why it is here.** ``body_min`` is the weakest class seen anywhere in the body and
``absolute_min`` the NAD table's floor for the soil — both are guesses made when
the donor rule came back empty, not readings, which is why the column-floor pass
replaces them wherever it can.

.. CG-EXPLANATION-END id=module-statements~3

Function ``def apply_column_floor``
-----------------------------------

.. CG-BLOCK id=function:apply_column_floor lines=752-819

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 752-819
   :lineno-match:

.. CG-EXPLANATION-START id=function:apply_column_floor

**What this does.** Raises an unanswered band to the loosest class ITS OWN column
measured for that soil — never lowering a class.

**Why it is here.** The NAD table's floor is a fictional answer, not a conservative
one: a loose-sand band dropped into a column whose every measured sand reads
medium-dense or better is a layer the site shows nowhere there, and packing density
feeds strength, so inventing one can drive a design on data that does not exist
(owner 2026-08-16). It runs after the donor rule has answered everything it can,
reading those answers, and keeps the band at ``low`` confidence because the
interval still was not read.

.. CG-EXPLANATION-END id=function:apply_column_floor

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~4 lines=820-823

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 820-823
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~4

**What this does.** Orders the provenance tags weakest-first, for a merge that must
not upgrade a class.

**Why it is here.** When two touching same-class bands merge, the survivor takes
the WEAKER provenance, so a merge never claims evidence for ground no donor
answered.

.. CG-EXPLANATION-END id=module-statements~4

Function ``def merge_geo_split_bands``
--------------------------------------

.. CG-BLOCK id=function:merge_geo_split_bands lines=824-893

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 824-893
   :lineno-match:

.. CG-EXPLANATION-START id=function:merge_geo_split_bands

**What this does.** Collapses two touching bands of one class inside one litho unit
into a single band, keeping the shallower piece's geological parent and the weaker
piece's provenance.

**Why it is here.** Two touching litho layers of the same formation classify
independently and can land on the same class, producing a contact that marks no
packing change — and each piece then earns its own correlation, which is how one
litho tie became two geotech ties. It began as the repair for the old geological
cut (deleted 2026-08-26) but is kept as the invariant's guard: one class, one litho
unit, one band, whatever route produced the duplication. It merges only when the
class AND the litho unit match and the two bands touch — the litho model owns its
own boundaries whatever the classes are.

.. CG-EXPLANATION-END id=function:merge_geo_split_bands

Function ``def coarsen_to_minimum_thickness``
---------------------------------------------

.. CG-BLOCK id=function:coarsen_to_minimum_thickness lines=894-1017

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 894-1017
   :lineno-match:

.. CG-EXPLANATION-START id=function:coarsen_to_minimum_thickness

**What this does.** Merges away bands the model's minimum thickness says cannot
exist: a near-minimum band GROWS at the expense of a neighbour that can spare the
thickness and still stand; where none can, the slivers merge and the survivor takes
the LOOSEST class of the run.

**Why it is here.** Rescaling a donor onto a thinner unit compresses its structure,
so a thin unit receives a squeezed copy (owner's B5 got seven sub-bands in a
0.465 m tail). Growing beats absorbing because the band is a reading a flanking
column actually made, and deleting it loses a layer the neighbours have (owner's B4
basal clay). Merging never makes a band denser (owner 2026-08-11, audit F05): the
survivor takes the loosest of the pair. A pass cap backstops against a future rule
change reintroducing a non-terminating loop.

.. CG-EXPLANATION-END id=function:coarsen_to_minimum_thickness

Function ``def clip_bands_to_slice``
------------------------------------

.. CG-BLOCK id=function:clip_bands_to_slice lines=1018-1052

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1018-1052
   :lineno-match:

.. CG-EXPLANATION-START id=function:clip_bands_to_slice

**What this does.** Keeps the part of a layer's derivation that falls inside one
slice, trimmed to it.

**Why it is here.** A geological contact cuts a litho layer into pieces that are
planned separately, but the packing is derived once across the whole layer, so each
piece takes its own window out of that one answer instead of reading the
neighbouring column again — which on the owner's B9 produced the flank's sand
succession twice over.

.. CG-EXPLANATION-END id=function:clip_bands_to_slice

Function ``def flank_pick_for_unit``
------------------------------------

.. CG-BLOCK id=function:flank_pick_for_unit lines=1053-1101

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1053-1101
   :lineno-match:

.. CG-EXPLANATION-START id=function:flank_pick_for_unit

**What this does.** Chooses which of a column's intervals in this body flanks the
borehole's unit, by elevation overlap — the largest overlap winning — and nothing
when nothing overlaps.

**Why it is here.** A body split by an enclosed lens owns more than one interval per
column, so "the flank column's layer in this body" is not a single thing; keying by
investigation once kept whichever came last and read every shallow unit off the deep
interval (the owner saw a very dense sand appear 3 m too shallow on CS1). Elevation,
not list position, says which interval is the same sheet — and answering "nearest"
when nothing overlaps let a guess be treated as evidence, so with no overlap the
unit falls to the column floor instead.

.. CG-EXPLANATION-END id=function:flank_pick_for_unit

Function ``def litho_contact_tie_pairs``
----------------------------------------

.. CG-BLOCK id=function:litho_contact_tie_pairs lines=1102-1206

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1102-1206
   :lineno-match:

.. CG-EXPLANATION-START id=function:litho_contact_tie_pairs

**What this does.** Finds the accepted CPT-to-CPT ties that declare the BASE CONTACT
of one shared litho unit, with a borehole between their columns.

**Why it is here.** Owner's step 1 (2026-08-16): if a CPT-to-CPT contact is a litho
contact, every borehole between the two columns already carries it in its own log,
so dividing the borehole re-expresses the tie and the tie is deleted with the rest.
His framing is encoded exactly — read the unit ABOVE, not the bands the tie names —
so a cross-facies-looking tie is recognised as one silt body's base, with the facies
changing beneath it. Both clauses matter: topmost-of-its-own-unit makes the surface
a litho contact on each column, and one-unit-above makes it the SAME contact
laterally.

.. CG-EXPLANATION-END id=function:litho_contact_tie_pairs

Function ``def _tiles_extent``
------------------------------

.. CG-BLOCK id=function:_tiles_extent lines=1207-1235

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1207-1235
   :lineno-match:

.. CG-EXPLANATION-START id=function:_tiles_extent

**What this does.** Checks whether a set of bands covers an extent exactly, with no
gap or overlap, on the stored millimetre grid.

**Why it is here.** It is the same property the database contiguity trigger
enforces, checked before the write so a defect degrades one column instead of
aborting the whole divide — the trigger refuses the WHOLE transaction on any gap.

.. CG-EXPLANATION-END id=function:_tiles_extent

Class ``UnitTiePlacement``
--------------------------

.. CG-BLOCK id=class:UnitTiePlacement lines=1236-1263

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1236-1263
   :lineno-match:

.. CG-EXPLANATION-START id=class:UnitTiePlacement

**What this does.** A frozen dataclass for one litho unit's bands laid on a borehole
from the ties: the bands, their per-band correspondence, the tie pairs it
re-expressed, the section, and the gap width.

**Why it is here.** The replaced-tie pairs are what the caller deletes (owner
2026-08-16: *"then you delete all the bands you checked and replaced by hops"*); the
correspondences let the hops be written outright.

.. CG-EXPLANATION-END id=class:UnitTiePlacement

Class ``GeometrySampling``
--------------------------

.. CG-BLOCK id=class:GeometrySampling lines=1264-1293

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1264-1293
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeometrySampling

**What this does.** A frozen dataclass for what a borehole's vertical line read out
of a section partition: the bands rescaled into the borehole's extent, their
correspondence, the section, the two bracketing columns, and the gap width.

**Why it is here.** The section-geometry path is one of the ways a borehole can be
filled; this carries its result plus the bracket it was read in, so the tightest
bracket wins when several sections draw the borehole.

.. CG-EXPLANATION-END id=class:GeometrySampling

Class ``PlannedBoreholeSegment``
--------------------------------

.. CG-BLOCK id=class:PlannedBoreholeSegment lines=1294-1317

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1294-1317
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlannedBoreholeSegment

**What this does.** A frozen dataclass for one borehole's planned bands WITHIN one
body group.

**Why it is here.** A borehole spanning several bodies produces one segment per
group; keeping the segments flat — rather than pre-aggregating per borehole — makes
the commit's write order identical to the plan's order.

.. CG-EXPLANATION-END id=class:PlannedBoreholeSegment

Class ``PlannedBoreholeColumn``
-------------------------------

.. CG-BLOCK id=class:PlannedBoreholeColumn lines=1318-1339

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1318-1339
   :lineno-match:

.. CG-EXPLANATION-START id=class:PlannedBoreholeColumn

**What this does.** A frozen dataclass for every planned band on one borehole,
across all of its body groups.

**Why it is here.** The shape the preview endpoint reports: the engineer thinks in
columns, not in body groups.

.. CG-EXPLANATION-END id=class:PlannedBoreholeColumn

Class ``DivideBoreholePlan`` — header
-------------------------------------

.. CG-BLOCK id=class:DivideBoreholePlan lines=1340-1391

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1340-1391
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholePlan

**What this does.** A frozen dataclass for what the verb would write, computed
without writing it: the model, the planned segments in write order, the summary
counts, the CPT layer index, the borehole names, the tie pairs it re-expressed, and
the boreholes it skipped.

**Why it is here.** It is produced by ``plan`` and consumed by BOTH ``execute``
(which persists it) and the preview endpoint (which reports it), so there is exactly
one planner — a divergence between the two would be indistinguishable from the
machine lying about the geology. It carries the CPT layer index because the commit's
tie re-anchor and edge derivation both need it, and re-reading it would be a second
source of truth.

.. CG-EXPLANATION-END id=class:DivideBoreholePlan

Method ``DivideBoreholePlan``. ``def columns``
----------------------------------------------

.. CG-BLOCK id=method:DivideBoreholePlan.columns lines=1392-1417

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1392-1417
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholePlan.columns

**What this does.** Aggregates the flat segments into one entry per borehole column,
each with its bands sorted top to bottom.

**Why it is here.** The preview reports columns, not body groups; this is the
segment-to-column fold.

.. CG-EXPLANATION-END id=method:DivideBoreholePlan.columns

Class ``DivideBoreholeResult``
------------------------------

.. CG-BLOCK id=class:DivideBoreholeResult lines=1418-1497

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1418-1497
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholeResult

**What this does.** A frozen dataclass for the verb's outcome: the model, the
divided and single-band counts, the layer count, the created formations, the tie
re-anchor results (carried, needs-review, and lost with reasons and labels), and the
four housekeeping counts — superseded jump ties, skipped-existing boreholes, deleted
crossing ties, and replaced / deleted spans.

**Why it is here.** Each count answers a question the engineer would otherwise have
to discover for himself; the lost-tie labels name both columns and depths because a
count alone cannot be acted on (audit 2026-08-02). The crossing, supersession and
span counts each cite the owner ruling that produced the deletion, so a silent
removal of his correlation is always reported.

.. CG-EXPLANATION-END id=class:DivideBoreholeResult

Class ``SpanPassCounts``
------------------------

.. CG-BLOCK id=class:SpanPassCounts lines=1498-1514

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1498-1514
   :lineno-match:

.. CG-EXPLANATION-START id=class:SpanPassCounts

**What this does.** A frozen dataclass for what the span pass did in its two halves:
how many spans were replaced by chains, and how many surviving ties were deleted for
crossing a banded borehole.

**Why it is here.** The span pass has two halves — the split (owner 2026-08-17) then
the crossing sweep (owner 2026-08-24) — and each is reported separately.

.. CG-EXPLANATION-END id=class:SpanPassCounts

Class ``DivideBoreholes`` — header
----------------------------------

.. CG-BLOCK id=class:DivideBoreholes lines=1515-1535

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1515-1535
   :lineno-match:

.. CG-EXPLANATION-START id=class:DivideBoreholes

**What this does.** The use-case class header. It extends the shared materialiser
base and documents the litho-confined fill, the idempotent delete-then-insert, and
the flank interpolation.

**Why it is here.** It inherits the formation find-or-create from the materialiser
base. This is the ONLY borehole packing-division path — "subdivide all bodies"
materialises CPT bands only.

.. CG-EXPLANATION-END id=class:DivideBoreholes

Method ``DivideBoreholes``. ``def __init__``
--------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes.__init__ lines=1536-1539

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1536-1539
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes.__init__

**What this does.** Initialises the shared base with this module's name.

**Why it is here.** So the log lines read as coming from this use case, not from the
base class.

.. CG-EXPLANATION-END id=method:DivideBoreholes.__init__

Method ``DivideBoreholes``. ``async def _scoped_borehole_ids``
--------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._scoped_borehole_ids lines=1540-1603

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1540-1603
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._scoped_borehole_ids

**What this does.** Folds a ``section_id`` scope into the ``borehole_ids`` subset: a
section resolves to its member boreholes and drives the subset path that already
exists.

**Why it is here.** Owner ruling 2026-08-15 asked for divide-boreholes to be section
scoped too; rather than a second mechanism, a section becomes its boreholes, so the
delete, the untouched-column seeding and the tie capture are all scoped by the
identical set. An EMPTY set is a real answer — a section with no borehole divides
nothing, which is not the same as dividing everything.

.. CG-EXPLANATION-END id=method:DivideBoreholes._scoped_borehole_ids

Method ``DivideBoreholes``. ``async def plan``
----------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes.plan lines=1604-2493

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 1604-2493
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes.plan

**What this does.** Computes every band the verb would write WITHOUT writing
anything — the whole engine up to the mutations. It loads and scope-guards the litho
model, finds the geotech child (404 if missing), optionally excludes hand-edited
boreholes, geo-labels and groups the picks, reads the CPT geotech layers and the
section column orders, borrows each borehole's packing from its flanking CPTs
(correlations first, then body), assigns each band its class, provenance and body,
then across the whole borehole merges geologically-split same-class bands and raises
unanswered bands to their column floor. It returns the plan; only ``SELECT``\ s are
issued.

**Why it is here.** It is the single source of the band geometry and classes, called
by both ``execute`` and the preview, so what the engineer previews is what commits.
The membership filter excludes off-section boreholes (they cannot be drawn or
corrected). The skip is keyed on HAND evidence, not on any prior band, because a
borehole's first pass is necessarily planned against a thinner tie set than the one
the engineer ends up approving (owner 2026-08-23), so freezing the machine's first
guess was itself the bug.

.. CG-EXPLANATION-END id=method:DivideBoreholes.plan

Method ``DivideBoreholes``. ``async def _resolve_spanning_ties``
----------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._resolve_spanning_ties lines=2494-2784

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 2494-2784
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._resolve_spanning_ties

**What this does.** Splits accepted spanning ties at the columns that now have data
— writing the chain of hops and deleting the span — then deletes whatever still
crosses a banded borehole. Both passes judge the post-split model.

**Why it is here.** Two owner rulings in sequence: the split (2026-08-17) turns a
span over a column with data into the chain that column expresses; the sweep
(2026-08-24) deletes what the split left still passing through a borehole's own
banded range, because it welds one body across bands that disagree with it and the
fill draws that weld. Sub-TD spans survive both — there the borehole says nothing at
that depth, so the span is the only way the statement can be made. A chain piece
landing on a slot held by a pending proposal PROMOTES it rather than colliding, and
a span only dies once every hop ends accepted, so approved information never rides
on pending rows.

.. CG-EXPLANATION-END id=method:DivideBoreholes._resolve_spanning_ties

Method ``DivideBoreholes``. ``async def _delete_ties_crossing_banded_boreholes``
--------------------------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._delete_ties_crossing_banded_boreholes lines=2785-2923

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 2785-2923
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._delete_ties_crossing_banded_boreholes

**What this does.** Deletes every surviving CPT-to-CPT tie that crosses a banded
borehole inside its own banded range, on the tie's own section, naming each deletion
by borehole name and elevation.

**Why it is here.** Owner 2026-08-24: after divide-boreholes, no accepted
CPT-to-CPT tie may pass through a borehole's own banded data — it welds one body
across bands that disagree with it. The edges are re-read post-split, so a chain
piece that itself jumps a borehole it could not land on is judged like any other
tie. It only judges a borehole THIS press could have divided, and sub-TD ties are
untouched — where the bands stop above the line the span is the only statement
available. Names, not ids, in the warnings, so the engineer can find the lost tie
without a database round-trip.

.. CG-EXPLANATION-END id=method:DivideBoreholes._delete_ties_crossing_banded_boreholes

Method ``DivideBoreholes``. ``async def _load_section_placements``
------------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._load_section_placements lines=2924-2974

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 2924-2974
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._load_section_placements

**What this does.** Loads every section's along-positions once, per section, for the
flanking rule.

**Why it is here.** "The CPT to the left and to the right" is only meaningful along a
section line. It uses the SAME projection the section view, the DXF export and the
correlation adjacency use, so a borehole the engineer sees between two CPTs is the
borehole this rule sees between them.

.. CG-EXPLANATION-END id=method:DivideBoreholes._load_section_placements

Method ``DivideBoreholes``. ``async def _load_accepted_tie_rows``
-----------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._load_accepted_tie_rows lines=2975-3010

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 2975-3010
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._load_accepted_tie_rows

**What this does.** Loads every ACCEPTED correlation edge of the geotech model, with
its two sides.

**Why it is here.** Only what the engineer accepted may steer where a borehole's
packing comes from, so proposals are excluded by the query. The sides travel too,
because a base-to-base tie names a different seam than a top-to-top one between the
same bands, and dropping the side re-declared his correlation one contact up (audit
P1-2).

.. CG-EXPLANATION-END id=method:DivideBoreholes._load_accepted_tie_rows

Method ``DivideBoreholes``. ``def _accepted_cpt_ties``
------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._accepted_cpt_ties lines=3011-3050

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 3011-3050
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._accepted_cpt_ties

**What this does.** Keeps the accepted ties whose BOTH endpoints are CPT packing
bands, expressed in the domain rule's own vocabulary.

**Why it is here.** The tie-informed donor ruling names a CPT pair; an endpoint on a
borehole is dropped. It is a static method — pure filtering.

.. CG-EXPLANATION-END id=method:DivideBoreholes._accepted_cpt_ties

Method ``DivideBoreholes``. ``async def preview_tie_carry``
-----------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes.preview_tie_carry lines=3051-3101

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 3051-3101
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes.preview_tie_carry

**What this does.** Says what a commit of a plan would do to the accepted borehole
ties, by running the SAME pure matcher against the bands the plan would write —
capturing nothing and writing nothing.

**Why it is here.** The matcher keys on (investigation, depth interval, NAD class),
none of which depends on a row id, so the counts here are the counts the commit
produces even though the planned bands carry placeholder ids. It passes
``borehole_bands_are_final=True`` for the same reason ``execute`` does — THIS verb is
the step a deferred borehole endpoint was waiting for.

.. CG-EXPLANATION-END id=method:DivideBoreholes.preview_tie_carry

Method ``DivideBoreholes``. ``async def execute``
-------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes.execute lines=3102-3900

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 3102-3900
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes.execute

**What this does.** Persists exactly what ``plan`` computed, in one transaction. It
scopes the run, plans it, short-circuits on an empty model, takes the body-partition
lock before any write, seeds the layer index (including the untouched boreholes on a
subset run), sweeps self-ties, captures the accepted ties, separations and unions
that touch a borehole, deletes the prior borehole bands, writes the planned
segments, re-anchors the captured work, derives the borehole-mediated edges (born
accepted) and supersedes the jump ties they replace, splits and sweeps the spanning
ties, re-resolves the bodies, assigns samples to bands, drops the duplicate and
crossing ties, sweeps orphan formations, stamps the litho provenance, and commits.

**Why it is here.** The whole point is that the commit transcribes the plan verbatim,
so the preview cannot drift from what lands. The lock is taken before the first
write because the delete-then-insert used to race the background body recompute into
a deadlock (owner dogfeed 2026-08-23). Accepted ties are captured before the delete
because the cascade takes them silently, and re-anchored after with
``borehole_bands_are_final=True`` because this verb IS the step the subdivide
deferred its borehole endpoints to. The borehole-mediated edges are born accepted
because they re-express, through the borehole just divided, correlations the engineer
already drew — making him re-accept them turned one press into press-accept-press
(owner 2026-08-15). The duplicate sweep removes the copy the re-anchor and the
derivation both produced for one correlation, which he was deleting by hand after
every press.

.. CG-EXPLANATION-END id=method:DivideBoreholes.execute

Method ``DivideBoreholes``. ``def _plan_borehole_bands_litho_confined``
-----------------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._plan_borehole_bands_litho_confined lines=3901-4395

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 3901-4395
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._plan_borehole_bands_litho_confined

**What this does.** Computes one borehole's litho-confined bands, reading and writing
nothing. It collects each CPT's bands within its own litho extent (the same-lithology
clip), builds the donor stacks, chooses the donors (a spanning tie names the pair
outright, else the flanking CPTs), lays their packing onto the borehole in fraction
space, coarsens to the minimum thickness, and fills any uncovered depth
conservatively. It then tries two stronger paths in priority order — the tie-driven
placement, then the section-geometry sampler — and returns the first that tiles the
extent, else the donor fill.

**Why it is here.** It is pure with respect to the database — every input is already
in memory — which is what lets the preview run the real engine instead of a
re-statement of it. The tie path is tried first because a tie names BOTH bands it
joins, so its hops reach both CPTs and the chain closes; the geometry path is tried
next because the partition between two CPTs already decided what the gap contains
from the engineer's own ties; the donor fill answers wherever neither reaches. If
the geometry path produces a non-contiguous column it logs an error and falls back
to the donor rule, because a borehole divided by the older rule beats a press that
writes nothing — the database refuses the whole transaction on any gap.

.. CG-EXPLANATION-END id=method:DivideBoreholes._plan_borehole_bands_litho_confined

Method ``DivideBoreholes``. ``def _plan_bands_from_unit_ties``
--------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._plan_bands_from_unit_ties lines=4396-4688

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 4396-4688
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._plan_bands_from_unit_ties

**What this does.** Lays one litho unit's packing boundaries on the borehole from the
TIES: a litho contact is already on the borehole and is never interpolated; a tied
interior boundary lands where the drawn tie line crosses the column in elevation; a
lens or onlap only when the borehole stands within half the gap of the column that
declared it. It returns the bands, their correspondence and the ties they replaced,
or nothing when no section brackets the borehole with two picks of this group.

**Why it is here.** The ties already say what is continuous, and each one NAMES the
two bands it joins, which is what makes the hop two-sided and the chain
CPT-to-borehole-to-borehole-to-CPT close by construction. A tie straddling the
borehole names the pair outright and outranks the nearest flanks (owner 2026-08-11).
A tie endpoint band of another soil never places a boundary here (Data Integrity Rule
3), and the neighbouring band each boundary names is the nearest SAME-SOIL one — a
cross-soil interbed is a lens inside the mass, not what continues past the line. An
uncorrelated pair is the engineer's own choice to leave uncorrelated, not something
to invent across.

.. CG-EXPLANATION-END id=method:DivideBoreholes._plan_bands_from_unit_ties

Method ``DivideBoreholes``. ``def _plan_bands_from_section_geometry``
---------------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._plan_bands_from_section_geometry lines=4689-4859

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 4689-4859
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._plan_bands_from_section_geometry

**What this does.** Reads the borehole's bands off the section partition it stands in:
it casts the borehole's vertical line through the geometry between its two bracketing
CPTs, rescales what the line cuts into the borehole's own litho extent, and reports
which layers each cut corresponds to. It returns nothing when the geometry cannot
answer.

**Why it is here.** Owner 2026-08-15: the borehole is a geometry problem — check
whether its column intersects a lens or onlap, litho stays authoritative, and only
invent inside existing litho at boreholes. Nothing is interpolated, so a lens that
pinched out before the borehole is simply absent. A cut whose class belongs to a
DIFFERENT soil family is dropped (owner 2026-08-26): the 2-D fill legitimately floods
a neighbouring soil across a gap when a conflict suspends the ties there, but that
flood is a statement about the OTHER soil, so it is left to the column floor.

.. CG-EXPLANATION-END id=method:DivideBoreholes._plan_bands_from_section_geometry

Method ``DivideBoreholes``. ``def _build_donor_stacks``
-------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._build_donor_stacks lines=4860-4991

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 4860-4991
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._build_donor_stacks

**What this does.** Turns the body group's CPT picks into candidate donor stacks —
one per eligible CPT, carrying its litho extent and the bands it read inside it —
choosing, when a CPT holds several picks in one group, the one that overlaps the
borehole most in ELEVATION.

**Why it is here.** A CPT qualifies only when it reads packing inside its own litho
extent for this group — a CPT whose bands all sit in a different lithology has
nothing to say about this unit. The elevation overlap picks the same geological
interval; merging the picks instead would stretch the donor's extent across the gap
between them and distort every fraction read from it. There is no distance gate — the
candidate set is already only the flanking tests, and a flank is a flank however far
away it is.

.. CG-EXPLANATION-END id=method:DivideBoreholes._build_donor_stacks

Method ``DivideBoreholes``. ``async def _persist_planned_segment``
------------------------------------------------------------------

.. CG-BLOCK id=method:DivideBoreholes._persist_planned_segment lines=4992-5102

.. literalinclude:: ../../../src/groundmodel/application/divide_boreholes.py
   :language: python
   :lines: 4992-5102
   :lineno-match:

.. CG-EXPLANATION-START id=method:DivideBoreholes._persist_planned_segment

**What this does.** Writes one planned segment's bands as ``litho_layer`` rows,
deciding nothing: every depth, class, provenance and body id comes off the plan
unchanged; the only thing resolved here is the band's geotech formation
(find-or-create on the plan's (class, litho parent, geo parent) triple).

**Why it is here.** It is the transcription half of the plan / commit split — the
plan is the single source of the geometry and classes. It appends the freshly-written
borehole bands to the layer index so the tie re-anchor and the borehole-mediated edge
derivation can see them, and accumulates the per-borehole bands for the Phase-9 sample
assignment. The formation, not the plan, is the authority on the class actually
stamped, because the materialiser's soil-family clamp can turn a foreign class into a
skeleton.

.. CG-EXPLANATION-END id=method:DivideBoreholes._persist_planned_segment

