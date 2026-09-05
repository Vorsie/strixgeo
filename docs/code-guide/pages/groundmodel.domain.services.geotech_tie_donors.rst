groundmodel.domain.services.geotech_tie_donors
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_tie_donors.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_tie_donors.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-75

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 1-75
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the tie-informed donor rule for borehole packing
bands. It imports the flanking rule's shapes (``DonorStack``,
``FlankSelection``, ``SectionPlacement``, ``SelectedDonor``) and defines a
minimum blend weight and the ``MODE_TIE_INTERPOLATED`` label.

**Why it is here.** Owner ruling 2026-08-04: the flanking rule guesses which
CPTs a borehole borrows its packing from by who sits beside it, but once the
engineer has ACCEPTED a packing tie whose span crosses the borehole's column
and both endpoints are CPTs in the borehole's body group, that tied pair
BECOMES the donor pair — it is no longer a guess. The tie also supplies the
band correspondence, because it names both endpoints, so the two donors are
reduced to exactly the tied bands and those are paired in depth order. The
flanking rule stays as the fallback wherever no accepted tie spans the borehole
(this module returns nothing then). A tied surface is read as a fraction of
each donor's own litho extent and re-laid at that fraction of the borehole's
extent, so where the body thins the surface rescales with it (owner: *"check if
the ties stay in the litho body otherwise rescale based on the litho
thickness"*); returning the same ``FlankSelection`` shape means it goes through
the same laying-out function. ``MODE_TIE_INTERPOLATED`` sits above the flanking
mode in the evidence ladder, because the engineer drew and accepted this
correlation while the flanks are only adjacency.

.. CG-EXPLANATION-END id=module-header

Class ``AcceptedTie``
---------------------

.. CG-BLOCK id=class:AcceptedTie lines=76-107

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 76-107
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptedTie

**What this does.** A frozen dataclass for one accepted packing correlation as
this rule needs to read it: the two investigations, the tied band's layer id on
each, the section it was drawn on, and which surface (``top`` or ``base``) of
each band the tie names.

**Why it is here.** Geotech correlation edges are section-scoped, and "crosses
the borehole's column" is only meaningful along the section the tie belongs to.
The side defaults to ``top``; audit P1-2 found that dropping the side turned a
base-to-base tie into a top-to-top one at placement time.

.. CG-EXPLANATION-END id=class:AcceptedTie

Class ``_TieCandidate`` — header
--------------------------------

.. CG-BLOCK id=class:_TieCandidate lines=108-133

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 108-133
   :lineno-match:

.. CG-EXPLANATION-START id=class:_TieCandidate

**What this does.** A private frozen dataclass for one donor pair that a set of
accepted ties nominates on one section: the section, the left and right donor
stacks (each reduced to its tied bands), and each donor's along-distance to the
borehole.

**Why it is here.** It is private to this module — the ranking unit, not part
of the rule's vocabulary. "Left" is the donor at the smaller along-position;
the two distances feed both the blend weighting and the choice of the tightest
spanning pair.

.. CG-EXPLANATION-END id=class:_TieCandidate

Method ``_TieCandidate``. ``def sort_key``
------------------------------------------

.. CG-BLOCK id=method:_TieCandidate.sort_key lines=134-150

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 134-150
   :lineno-match:

.. CG-EXPLANATION-START id=method:_TieCandidate.sort_key

**What this does.** Returns a ranking tuple: the total along-distance to the
borehole, then the section id, then the left donor id.

**Why it is here.** The tightest spanning pair wins. The ids come last only so
that two equally tight candidates always resolve the same way run to run,
rather than on the incidental order of a dictionary.

.. CG-EXPLANATION-END id=method:_TieCandidate.sort_key

Function ``def select_tie_informed_donors``
-------------------------------------------

.. CG-BLOCK id=function:select_tie_informed_donors lines=151-262

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 151-262
   :lineno-match:

.. CG-EXPLANATION-START id=function:select_tie_informed_donors

**What this does.** For each section it finds the accepted ties that strictly
span the borehole between two eligible CPT donors, groups them by donor pair so
a pair tied at several depths yields one candidate carrying all its tied bands,
reduces each donor to just its tied bands, drops any pair whose two reduced
class sequences disagree, and returns the tightest candidate's selection — or
nothing when no accepted tie spans the borehole.

**Why it is here.** "Spans" is strict: both endpoints must sit on opposite
sides of the borehole's along-position, because a tie on one side, or one that
starts at the borehole itself, says nothing about what the borehole reads in
between. A tie the engineer drew across two different packing classes is a
surface tie, not a band correspondence — there is no honest way to lay "NAD 7
over there" onto "NAD 13 over here" — so it is left to the flanking fallback
rather than inventing a class. Proposals must never reach this function: an
unaccepted tie is the machine's guess, with no more standing than the flanking
rule's own.

.. CG-EXPLANATION-END id=function:select_tie_informed_donors

Function ``def _reduced``
-------------------------

.. CG-BLOCK id=function:_reduced lines=263-295

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 263-295
   :lineno-match:

.. CG-EXPLANATION-START id=function:_reduced

**What this does.** Reduces a donor stack to only the bands an accepted tie
actually names, sorted top to bottom; it returns nothing when none of the
donor's bands is named.

**Why it is here.** The litho extent is left untouched on purpose, because the
fraction a tied surface is read at is a fraction of the LITHO body, not of the
tied bands.

.. CG-EXPLANATION-END id=function:_reduced

Function ``def _tie_selection``
-------------------------------

.. CG-BLOCK id=function:_tie_selection lines=296-342

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_tie_donors.py
   :language: python
   :lines: 296-342
   :lineno-match:

.. CG-EXPLANATION-START id=function:_tie_selection

**What this does.** Builds the selection for the winning tied pair, weighting
each donor by its along-distance so the nearer donor counts for more; if the
far donor's share of the blend rounds below the minimum blend weight it returns
a single-donor selection carrying only the near one.

**Why it is here.** A donor whose share of the blend rounds to nothing is not a
co-author — below the threshold the near donor speaks alone, exactly as the
flanking rule decided (audit F10). Reusing the ``FlankSelection`` shape means
the tie-informed path lays out its surfaces through the very same function as
the flanking rule.

.. CG-EXPLANATION-END id=function:_tie_selection

