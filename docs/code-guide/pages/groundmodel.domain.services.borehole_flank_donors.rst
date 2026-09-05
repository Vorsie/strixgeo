groundmodel.domain.services.borehole_flank_donors
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/borehole_flank_donors.py complete=true

*Source file:* ``src/groundmodel/domain/services/borehole_flank_donors.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-102

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 1-102
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the rule that decides where a borehole's packing bands come from, and sets up its tools. It imports two small typing helpers and the ``dataclass`` decorator (a decorator is a line starting with ``@`` that adds behaviour to the class below it; ``@dataclass`` turns a class into a plain holder of named values). It then names the constants the rule uses: the thinnest band worth writing, the three selection modes in order of how much evidence they rest on, the smallest share a flank may hold before it is dropped, and a fourth mode meaning "no donor at all".

**Why it is here.** A borehole has no cone, so it measures no packing on its own; its NAD packing classes have to be borrowed from nearby CPTs. The long docstring records the owner's ruling in his own words: the packing must come from the CPT to the right and to the left on the cross-section, interpolated between the two, and nothing else. It also records what this replaced and why: the old rule blended the band boundaries of every CPT in a body group, mixing up to ten different class pairs across CPTs as far as 777 m away, so a borehole 4.7 m from a CPT was being told what its sand does by a CPT 777 m off. The module is pure: no database, no file reading, no logging, so every decision can be tested on paper.

.. CG-EXPLANATION-END id=module-header

Class ``PackingSurface``
------------------------

.. CG-BLOCK id=class:PackingSurface lines=103-129

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 103-129
   :lineno-match:

.. CG-EXPLANATION-START id=class:PackingSurface

**What this does.** A frozen data holder for one packing interval laid onto a borehole: its top and base as metres below the borehole's collar, its NAD packing class, and the ids of the donor bands it was copied from. "Frozen" means the values cannot be changed once the holder is made.

**Why it is here.** The result of the rule is a list of these intervals, so bundling the four facts under clear names is safer than passing loose numbers around. Naming the donor band ids on each interval is load-bearing: it records which CPT band on each side this interval stands between, so the later "Divide boreholes" step can write the correlation hop directly instead of guessing the pairing back from depths.

.. CG-EXPLANATION-END id=class:PackingSurface

Class ``DonorBand``
-------------------

.. CG-BLOCK id=class:DonorBand lines=130-155

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 130-155
   :lineno-match:

.. CG-EXPLANATION-START id=class:DonorBand

**What this does.** A frozen holder for one packing band that a donor CPT read inside its own litho extent: its top and base as metres below that CPT's collar, its NAD packing class 1–31, and the band's ``litho_layer`` id as text.

**Why it is here.** The band id is the identity an accepted packing correlation names, so it is carried here for the one reader that needs it — the tie-informed donor rule in the sibling module. The docstring notes the id is appended with a blank default so every older place that builds a ``DonorBand`` keeps working; a band with no id simply never matches a correlation.

.. CG-EXPLANATION-END id=class:DonorBand

Class ``DonorStack`` — header
-----------------------------

.. CG-BLOCK id=class:DonorStack lines=156-185

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 156-185
   :lineno-match:

.. CG-EXPLANATION-START id=class:DonorStack

**What this does.** A frozen holder for one candidate donor CPT: its id and display name, the top and base of its own litho-body extent for this group, the packing bands it read inside that extent (top to bottom), and its straight-line map distance from the borehole.

**Why it is here.** This is the unit the rule reasons over — one CPT's say about the packing in this body. The bands may leave gaps, because an unclassified stretch on the donor must stay unclassified here rather than being invented. The display name is kept so the tooltip can name the donor and the engineer can go and look at the CPT the machine listened to.

.. CG-EXPLANATION-END id=class:DonorStack

Method ``DonorStack``. ``def class_sequence``
---------------------------------------------

.. CG-BLOCK id=method:DonorStack.class_sequence lines=186-197

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 186-197
   :lineno-match:

.. CG-EXPLANATION-START id=method:DonorStack.class_sequence

**What this does.** Returns the ordered list of NAD packing classes this donor reads, top to bottom, as a tuple (a fixed, unchangeable list of values).

**Why it is here.** Two flanking CPTs can only have their band boundaries paired and blended when they read the same sequence of classes in the same order. This method produces that sequence so the two sides can be compared before any blending is attempted.

.. CG-EXPLANATION-END id=method:DonorStack.class_sequence

Class ``SectionPlacement``
--------------------------

.. CG-BLOCK id=class:SectionPlacement lines=198-219

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 198-219
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionPlacement

**What this does.** A frozen holder for one cross-section: its id, its display name, and a dictionary giving the along-section distance (from the section's start) of every investigation the section actually draws. A dictionary is a lookup table from a key to a value — here from an investigation id to its position along the line.

**Why it is here.** The rule ranks donors by where they sit along the section line, not by map distance, so it needs each column's along-position. An investigation missing from this table is simply not on that section and cannot flank anything there — which is exactly how "only the columns drawn on this section count" is expressed in data.

.. CG-EXPLANATION-END id=class:SectionPlacement

Class ``SelectedDonor``
-----------------------

.. CG-BLOCK id=class:SelectedDonor lines=220-245

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 220-245
   :lineno-match:

.. CG-EXPLANATION-START id=class:SelectedDonor

**What this does.** A frozen holder for a donor that was chosen: the donor itself, the side it sits on (``left`` / ``right`` for a flank, ``nearest`` for the map-distance fallback), its along-section distance to the borehole, and its weight — its share of the interpolation from 0 to 1.

**Why it is here.** It records not just which CPT was picked but how much say it has. A lone donor carries the full weight of 1.0; two flanks split the weight inversely to their along-distances, so the nearer one weighs more. That weight is what the blend later uses, and the side and distance are what the hover provenance shows the engineer.

.. CG-EXPLANATION-END id=class:SelectedDonor

Class ``FlankSelection``
------------------------

.. CG-BLOCK id=class:FlankSelection lines=246-272

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 246-272
   :lineno-match:

.. CG-EXPLANATION-START id=class:FlankSelection

**What this does.** A frozen holder for the whole decision: which mode was used, the chosen donors (two for a blended pair with the left one first, one for a single donor or the fallback, none when there is no donor), and the id and name of the section that decided.

**Why it is here.** This is the single answer ``select_flank_donors`` returns. Bundling the mode with the donors and the deciding section keeps the reasoning auditable: the mode tells the reader how much evidence the packing rests on, and the section name tells the engineer where to go to check or change it.

.. CG-EXPLANATION-END id=class:FlankSelection

Class ``_SectionFlanks`` — header
---------------------------------

.. CG-BLOCK id=class:_SectionFlanks lines=273-299

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 273-299
   :lineno-match:

.. CG-EXPLANATION-START id=class:_SectionFlanks

**What this does.** A private frozen holder for the nearest donor on each side of one borehole on ONE section: the section, the left donor and its along-distance, and the right donor and its along-distance. The leading underscore marks it private to this file.

**Why it is here.** A borehole can be drawn on several sections, each offering its own left/right pair, so this is the unit that the several-sections tie-break ranks against each other. The docstring is explicit that it is bookkeeping, not part of the rule's spoken vocabulary.

.. CG-EXPLANATION-END id=class:_SectionFlanks

Method ``_SectionFlanks``. ``def sort_key``
-------------------------------------------

.. CG-BLOCK id=method:_SectionFlanks.sort_key lines=300-316

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 300-316
   :lineno-match:

.. CG-EXPLANATION-START id=method:_SectionFlanks.sort_key

**What this does.** Returns a ranking key for this section as a tuple: 0 when it has a donor on both sides else 1, then the total along-distance of its flanks, then the section id.

**Why it is here.** It encodes the owner-flagged interpretation for choosing between sections: a section with a flanking PAIR beats one with only a lone flank (interpolation between two columns beats extrapolation from one), and among pairs the tightest — the smallest total distance — wins. The section id comes last so two equally tight sections always resolve the same way instead of on unpredictable order.

.. CG-EXPLANATION-END id=method:_SectionFlanks.sort_key

Function ``def _flanks_on_section``
-----------------------------------

.. CG-BLOCK id=function:_flanks_on_section lines=317-375

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 317-375
   :lineno-match:

.. CG-EXPLANATION-START id=function:_flanks_on_section

**What this does.** Finds the nearest eligible donor on each side of the borehole on one section. It looks up the borehole's along-position, then scans every column in along order, keeping the closest donor at a smaller-or-equal position as the left flank and the closest at a larger position as the right flank. It returns nothing when the section does not draw the borehole or draws no eligible donor.

**Why it is here.** This is the per-section flank search the ranking depends on. The scan is done in sorted order so the result is deterministic when two donors share a position. A donor sitting exactly on the borehole is taken as the left flank at zero distance, which lets it carry the whole weight — the right answer for a column drawn on top of the borehole.

.. CG-EXPLANATION-END id=function:_flanks_on_section

Function ``def select_flank_donors``
------------------------------------

.. CG-BLOCK id=function:select_flank_donors lines=376-472

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 376-472
   :lineno-match:

.. CG-EXPLANATION-START id=function:select_flank_donors

**What this does.** The public entry point that chooses which CPT or CPTs a borehole's packing is read from. With no donors it returns the "none" mode. Otherwise it builds the flanks on every section that draws the borehole, ranks them, and takes the best: a two-sided pair becomes a blended selection, a single side becomes a single-donor selection. When no section places the borehole beside any donor, it falls back to the nearest donor by map distance.

**Why it is here.** This is the owner's ruling turned into a decision ladder, from most evidence to least: a flanking pair, then one flank, then the nearest test by map distance, then nothing. The ``preferred_section_id`` argument carries the 2026-08-18 ruling that "the section you are editing wins": when the edited section places the borehole beside a donor, its flanks decide even if another section holds a tighter pair, because the engineer judges the result on the section he is looking at.

.. CG-EXPLANATION-END id=function:select_flank_donors

Function ``def _pair_selection``
--------------------------------

.. CG-BLOCK id=function:_pair_selection lines=473-555

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 473-555
   :lineno-match:

.. CG-EXPLANATION-START id=function:_pair_selection

**What this does.** Builds the selection for a borehole with a donor on each side. When the two flanks do not read the same class sequence it hands the whole weight to the nearer one. When they agree, it weights each side inversely to its distance, and if one side's share rounds below half a percent it drops that side and speaks with the near flank alone; otherwise it returns both flanks with their split weights.

**Why it is here.** There is no honest way to pair two different class lists boundary-for-boundary, so a mismatch falls back to the nearer flank verbatim (the owner's earlier "nearest test that does have packing" ruling). The half-a-percent floor stops the provenance from claiming a two-CPT consensus that numerically does not exist — a flank worth 0.3 % is noise, not a co-author. Coincident columns share the weight equally rather than dividing by zero.

.. CG-EXPLANATION-END id=function:_pair_selection

Function ``def flank_packing_surfaces``
---------------------------------------

.. CG-BLOCK id=function:flank_packing_surfaces lines=556-597

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 556-597
   :lineno-match:

.. CG-EXPLANATION-START id=function:flank_packing_surfaces

**What this does.** Lays the selected donors' packing onto the borehole's litho extent and returns plain ``(top, base, class)`` intervals in the borehole's own depth frame, top to bottom and non-overlapping.

**Why it is here.** It is a thin projection of the richer function below — it just drops the donor ids — so the two can never drift apart, and every geometry test written against this simple tuple form keeps guarding the richer one too. It exists because most callers only need the depths and classes, not the provenance.

.. CG-EXPLANATION-END id=function:flank_packing_surfaces

Function ``def flank_packing_surfaces_with_donors``
---------------------------------------------------

.. CG-BLOCK id=function:flank_packing_surfaces_with_donors lines=598-699

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 598-699
   :lineno-match:

.. CG-EXPLANATION-START id=function:flank_packing_surfaces_with_donors

**What this does.** Lays the selected donors' packing onto the borehole. It expresses each donor boundary as a fraction of that donor's own extent (0 at the top, 1 at the base), blends the two flanks fraction-by-fraction using their weights, then re-lays those fractions on the borehole's extent as real depths. It closes sub-millimetre float gaps between bands and drops anything thinner than the minimum, and it names the donor band or bands each interval stands between.

**Why it is here.** Fractions rather than depths are used because a unit thins and thickens between columns: a boundary 40 % down the sand at one CPT is 40 % down the sand at the borehole, whatever the sand's thickness there. Naming the donor bands is not new information — the pairing zips band *i* with band *i*, which IS the correspondence — but keeping it lets "Divide boreholes" write a consistent correlation hop; without it the gaps left and right of a borehole reconstructed the pairing differently and no chain closed. The sub-millimetre closes are float slack from the fraction round-trip, not real ground, so they must not surface as a packing change that never happened.

.. CG-EXPLANATION-END id=function:flank_packing_surfaces_with_donors

Function ``def _fraction``
--------------------------

.. CG-BLOCK id=function:_fraction lines=700-729

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 700-729
   :lineno-match:

.. CG-EXPLANATION-START id=function:_fraction

**What this does.** Expresses a depth on a donor as a fraction of that donor's litho extent: 0 at the extent top, 1 at its base, clamped to that range. A zero-thickness extent returns 0.

**Why it is here.** This is the single conversion the fraction-space blend rests on. Clamping keeps a boundary that sits just outside the measured extent from producing a fraction beyond 0–1, and a degenerate extent has no proportion to read so it safely returns 0 rather than dividing by zero.

.. CG-EXPLANATION-END id=function:_fraction

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=730-733

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 730-733
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines two distance thresholds, in metres to the nearest donor CPT, that grade how much to trust a borrowed band: high confidence within 50 m, medium within 200 m.

**Why it is here.** The owner's ruling (audit F08) was to "map the confidence honestly, just take distance to nearest cpt as a measure for now". The 50 m rung is the scale of the section projection buffer the owner himself uses to say a test "is here"; 200 m is several tests' worth of extrapolation beyond the typical CPT spacing on the model. The comment marks them as "for now", to be tuned on dogfeed in this one place.

.. CG-EXPLANATION-END id=module-statements

Function ``def confidence_from_donor_distance``
-----------------------------------------------

.. CG-BLOCK id=function:confidence_from_donor_distance lines=734-758

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 734-758
   :lineno-match:

.. CG-EXPLANATION-START id=function:confidence_from_donor_distance

**What this does.** Turns a distance to the nearest donor into a word: "high" within 50 m, "medium" within 200 m, "low" beyond — and "low" when there is no donor at all.

**Why it is here.** The badge on a borrowed band must say honestly how far its evidence sits. A band with no donor (the conservative floor fills) must never read better than the farthest real donor, so a missing distance maps straight to "low".

.. CG-EXPLANATION-END id=function:confidence_from_donor_distance

Function ``def depth_aware_flanks``
-----------------------------------

.. CG-BLOCK id=function:depth_aware_flanks lines=759-829

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_flank_donors.py
   :language: python
   :lines: 759-829
   :lineno-match:

.. CG-EXPLANATION-START id=function:depth_aware_flanks

**What this does.** Finds the flanking CPTs for ONE layer's depth window, walking outward from the borehole along a section and stepping over columns that say nothing in that window. A CPT counts as a flank only if its bands cover more of the window than one writable band; a shorter CPT whose data ends above the window is skipped and the walk continues to the next column over. Boreholes are always stepped over. It returns at most one CPT per side.

**Why it is here.** This carries the owner's 2026-08-18 ruling after a borehole's 8.7 m sand came back as one band: if there is no CPT data below a short test's bottom, you look to the next CPT over. So the flank is judged per layer, not per borehole. A CPT whose bands DO cover the window blocks the walk even when its soil disagrees — data that disagrees is still data, and borrowing from beyond it would fake continuity through ground the near CPT says is something else. The minimum-data threshold stops a 2 cm graze of clay from vetoing an 8.7 m question.

.. CG-EXPLANATION-END id=function:depth_aware_flanks

